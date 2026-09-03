// Offscreen document handles clipboard, DOM-parser, and SSE-relay messages.
//
// WHY THIS FILE EXISTS (MV3 lifecycle):
// Service workers are terminated after ~30s of inactivity, which forcefully
// aborts any in-flight fetch — including a long-lived SSE stream. An offscreen
// document is a real page context and is NOT subject to that idle timeout, so
// the Mail.tm (Mercure) stream is hosted here. When an event arrives we message
// the background worker, which wakes it up to run the normal inbox pipeline.

// ─────────────────────────────────────────────────────────────
// SSE Relay (Mail.tm / Mercure)
// ─────────────────────────────────────────────────────────────

const SSE_RECONNECT_BASE_MS = 800;
const SSE_RECONNECT_MAX_MS = 20_000;
const SSE_MAX_RECONNECTS = 8;

interface SseRelayState {
  controller: AbortController | null;
  accountId: string | null;
  url: string | null;
  token: string | null;
  connected: boolean;
  /** Bumped on every stop/start so stale reader loops can detect they're dead. */
  generation: number;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  lastEventAt: number;
  eventsReceived: number;
}

const sseRelay: SseRelayState = {
  controller: null,
  accountId: null,
  url: null,
  token: null,
  connected: false,
  generation: 0,
  reconnectAttempts: 0,
  reconnectTimer: null,
  lastEventAt: 0,
  eventsReceived: 0,
};

/**
 * Pokes the service worker. If it is suspended this wakes it up.
 * Never throws — a missing receiver just means the worker is going away.
 */
function notifyBackground(type: string, payload: Record<string, unknown> = {}): void {
  try {
    const p = chrome.runtime.sendMessage({ type, ...payload }) as unknown;
    if (p && typeof (p as Promise<unknown>).catch === 'function') {
      (p as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // Background not listening; nothing actionable here.
  }
}

function clearRelayReconnectTimer(): void {
  if (sseRelay.reconnectTimer) {
    clearTimeout(sseRelay.reconnectTimer);
    sseRelay.reconnectTimer = null;
  }
}

function stopSseRelay(): void {
  sseRelay.generation++;
  clearRelayReconnectTimer();

  if (sseRelay.controller) {
    sseRelay.controller.abort();
    sseRelay.controller = null;
  }

  sseRelay.connected = false;
  sseRelay.accountId = null;
  sseRelay.url = null;
  sseRelay.token = null;
  sseRelay.reconnectAttempts = 0;
}

function scheduleRelayReconnect(): void {
  const { url, token, accountId, reconnectAttempts } = sseRelay;
  if (!url || !token || !accountId) {
    return;
  }

  if (reconnectAttempts >= SSE_MAX_RECONNECTS) {
    console.warn('[offscreen] SSE relay gave up after', reconnectAttempts, 'attempts');
    notifyBackground('SSE_RELAY_FAILED', { accountId, attempts: reconnectAttempts });
    return;
  }

  const delay = Math.min(
    SSE_RECONNECT_BASE_MS * Math.pow(1.7, reconnectAttempts),
    SSE_RECONNECT_MAX_MS
  );
  sseRelay.reconnectAttempts++;

  clearRelayReconnectTimer();
  sseRelay.reconnectTimer = setTimeout(() => {
    sseRelay.reconnectTimer = null;
    if (sseRelay.url && sseRelay.token && sseRelay.accountId) {
      void runSseRelay(sseRelay.url, sseRelay.token, sseRelay.accountId);
    }
  }, delay);
}

async function runSseRelay(url: string, token: string, accountId: string): Promise<void> {
  const generation = ++sseRelay.generation;
  const controller = new AbortController();
  sseRelay.controller = controller;
  sseRelay.url = url;
  sseRelay.token = token;
  sseRelay.accountId = accountId;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      signal: controller.signal,
    });

    if (generation !== sseRelay.generation) {
      return;
    }

    if (!response.ok) {
      throw new Error(`SSE relay HTTP ${response.status} ${response.statusText}`);
    }
    if (!response.body) {
      throw new Error('SSE relay response has no body');
    }

    sseRelay.connected = true;
    sseRelay.reconnectAttempts = 0;
    sseRelay.lastEventAt = Date.now();
    console.info('[offscreen] SSE relay connected');
    notifyBackground('SSE_RELAY_OPEN', { accountId });

    // A successful stream means Mercure is healthy — tell the worker so it can
    // drop any polling-only degradation state.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (generation === sseRelay.generation && !controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) {
          continue;
        }
        sseRelay.lastEventAt = Date.now();
        sseRelay.eventsReceived++;
        if (generation !== sseRelay.generation) {
          return;
        }
        notifyBackground('SSE_EMAIL_EVENT', { accountId });
      }
    }

    if (generation !== sseRelay.generation) {
      return;
    }

    sseRelay.connected = false;
    console.warn('[offscreen] SSE relay stream ended');
    notifyBackground('SSE_RELAY_CLOSED', { accountId, reason: 'stream-ended' });
    scheduleRelayReconnect();
  } catch (error) {
    if (generation !== sseRelay.generation) {
      return;
    }

    if ((error as Error)?.name === 'AbortError') {
      return; // intentional stop
    }

    sseRelay.connected = false;
    const reason = error instanceof Error ? error.message : String(error);
    console.warn('[offscreen] SSE relay error:', reason);
    notifyBackground('SSE_RELAY_CLOSED', { accountId, reason });
    scheduleRelayReconnect();
  }
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // SECURITY FIX: Verify message origin
  if (sender.id !== chrome.runtime.id) {
    console.warn('Blocked message from unauthorized sender:', sender.id);
    return false;
  }

  try {
    // ---- Keep-alive Ping ----
    if (message.target === 'offscreen-doc' && message.type === 'HEALTH_PING') {
      sendResponse({ status: 'pong' });
      return true;
    }

    // ---- Clipboard Copy ----
    if (message.target === 'offscreen-doc' && message.type === 'COPY_TO_CLIPBOARD') {
      handleClipboardCopy(message.data)
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;
    }

    // ---- SSE Relay: start ----
    if (message.target === 'offscreen-doc' && message.type === 'SSE_CONNECT') {
      const { url, token, accountId } = message;
      if (typeof url !== 'string' || typeof token !== 'string') {
        sendResponse({ success: false, error: 'SSE_CONNECT requires url and token' });
        return true;
      }

      // Already streaming for this account — no-op success (idempotent).
      if (sseRelay.connected && sseRelay.accountId === accountId) {
        sendResponse({ success: true, alreadyConnected: true });
        return true;
      }

      stopSseRelay();
      void runSseRelay(url, token, accountId ?? null);
      sendResponse({ success: true });
      return true;
    }

    // ---- SSE Relay: stop ----
    if (message.target === 'offscreen-doc' && message.type === 'SSE_DISCONNECT') {
      stopSseRelay();
      sendResponse({ success: true });
      return true;
    }

    // ---- SSE Relay: status probe (used by the SW after it wakes up) ----
    if (message.target === 'offscreen-doc' && message.type === 'SSE_STATUS') {
      sendResponse({
        success: true,
        connected: sseRelay.connected,
        accountId: sseRelay.accountId,
        lastEventAt: sseRelay.lastEventAt,
        eventsReceived: sseRelay.eventsReceived,
        reconnectAttempts: sseRelay.reconnectAttempts,
      });
      return true;
    }

    // ---- Handle unrecognized messages gracefully ----
    // Do not log warning for messages without target='offscreen-doc' as they might be for other listeners
    if (message.target === 'offscreen-doc') {
      console.warn('Unrecognized message action in offscreen document:', message);
      sendResponse({ success: false, error: 'Unrecognized action' });
      return true;
    }
  } catch (error) {
    console.error('Error handling offscreen message:', error);
    sendResponse({ success: false, error: String(error) });
  }

  return false;
});

async function handleClipboardCopy(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (e) {
      if (copyWithSelection(text)) {
        return;
      }
      throw new Error(`Clipboard copy failed: ${e}`);
    }
  }

  if (copyWithSelection(text)) {
    return;
  }

  throw new Error('Clipboard API not available');
}

function copyWithSelection(text: string): boolean {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}
