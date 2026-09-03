/**
 * SSE (Server-Sent Events) Manager for Mail.tm
 *
 * Connects to Mail.tm's Mercure hub for real-time email push notifications.
 * Eliminates polling for Mail.tm accounts — emails arrive instantly (0-1s).
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Service Worker                                             │
 * │  ┌───────────────────────────────────────────────────────┐  │
 * │  │  SSEManager                                           │  │
 * │  │  ┌─────────────────────────────────────────────────┐  │  │
 * │  │  │  fetch + ReadableStream → mercure.mail.tm       │  │  │
 * │  │  │  Topic: /accounts/{id}                          │  │  │
 * │  │  │  Auth: Bearer <JWT> (via fetch header)          │  │  │
 * │  │  │  On event → trigger inbox check → process       │  │  │
 * │  │  └─────────────────────────────────────────────────┘  │  │
 * │  └───────────────────────────────────────────────────────┘  │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Fallback: If SSE fails, automatically switches to polling.
 */

import { mailTmService, emailService } from '../services/emailServices';
import { EmailAccount } from '../types';
import { createLogger, diag } from '../utils/logger';
import { ensureOffscreenDocument } from './offscreenManager';

const log = createLogger('SSEManager');

// Mercure hub URL for Mail.tm
const MERCURE_HUB_URL = 'https://mercure.mail.tm/.well-known/mercure';

// Reconnection settings — aggressive recovery for real-time inbox
const RECONNECT_BASE_DELAY_MS = 800;
const RECONNECT_MAX_DELAY_MS = 20_000;
const RECONNECT_MULTIPLIER = 1.7;
const MAX_RECONNECT_ATTEMPTS = 8;

// Circuit breaker for persistent server errors (502/503/504)
const CIRCUIT_BREAKER_THRESHOLD = 4;
const CIRCUIT_BREAKER_COOLDOWN_MS = 90 * 1000; // recover faster

// Connection health check
const HEALTH_CHECK_INTERVAL_MS = 20_000;
const MAX_SILENT_MS = 60_000;

/**
 * Which execution context is currently holding the stream open.
 * - 'offscreen': stream lives in the offscreen document (survives SW suspension)
 * - 'sw': stream lives in this service worker (dies when the worker sleeps)
 * - 'none': not connected
 */
type SSETransport = 'none' | 'offscreen' | 'sw';

interface SSEState {
  connected: boolean;
  transport: SSETransport;
  accountId: string | null;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  lastEventTime: number;
  healthCheckTimer: ReturnType<typeof setInterval> | null;
  totalEventsReceived: number;
  totalReconnects: number;
  streamReader: ReadableStreamDefaultReader<Uint8Array> | null;
  // Circuit breaker state
  consecutiveServerErrors: number;
  circuitBreakerUntil: number;
  hasNotifiedOutage: boolean;
}

class SSEManager {
  private currentAbortController: AbortController | null = null;
  private connectionGeneration = 0;

  private state: SSEState = {
    connected: false,
    transport: 'none',
    accountId: null,
    reconnectAttempts: 0,
    reconnectTimer: null,
    lastEventTime: 0,
    healthCheckTimer: null,
    totalEventsReceived: 0,
    totalReconnects: 0,
    streamReader: null,
    consecutiveServerErrors: 0,
    circuitBreakerUntil: 0,
    hasNotifiedOutage: false,
  };

  private onEmailReceived: ((accountId: string) => void) | null = null;

  /**
   * Latched once the offscreen transport proves unusable so we stop paying its
   * setup cost on every reconnect cycle.
   */
  private offscreenUnavailable = false;

  constructor() {
    // Receive notifications from the offscreen SSE relay. Registered on the
    // singleton so the listener exists for the worker's whole lifetime.
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
      chrome.runtime.onMessage.addListener((message, sender) => {
        if (sender?.id && sender.id !== chrome.runtime.id) {
          return false;
        }
        this.handleRelayMessage(message as { type?: string; accountId?: string; reason?: string });
        return false;
      });
    }
  }

  /**
   * Handles notifications pushed by the offscreen SSE relay.
   *
   * This typically arrives on a *fresh* worker invocation — the stream is not
   * running in this context, which is exactly the point.
   */
  private handleRelayMessage(message: {
    type?: string;
    accountId?: string;
    reason?: string;
  }): void {
    if (!message || typeof message.type !== 'string') {
      return;
    }

    switch (message.type) {
      case 'SSE_EMAIL_EVENT': {
        this.state.lastEventTime = Date.now();
        this.state.totalEventsReceived++;
        const accountId = message.accountId ?? this.state.accountId;
        log.debug('📨 SSE relay event received', { accountId });
        if (this.onEmailReceived && accountId) {
          this.onEmailReceived(accountId);
        }
        break;
      }

      case 'SSE_RELAY_OPEN': {
        this.state.transport = 'offscreen';
        this.state.connected = true;
        this.state.reconnectAttempts = 0;
        this.state.lastEventTime = Date.now();
        this.state.consecutiveServerErrors = 0;
        log.info('✅ SSE relay connected (offscreen) — survives worker suspension');
        break;
      }

      case 'SSE_RELAY_CLOSED': {
        this.state.connected = false;
        this.state.transport = 'none';
        log.warn('SSE relay closed', { reason: message.reason });
        break;
      }

      case 'SSE_RELAY_FAILED': {
        this.state.connected = false;
        this.state.transport = 'none';
        log.error('SSE relay exhausted reconnects — relying on polling fallback');
        break;
      }

      default:
        break;
    }
  }

  /**
   * Opens the stream inside the offscreen document so it is not killed when this
   * worker sleeps. Returns false on any failure so the caller can fall back to
   * the in-worker stream.
   */
  private async connectViaOffscreen(
    url: string,
    token: string,
    accountId: string
  ): Promise<boolean> {
    if (this.offscreenUnavailable) {
      return false;
    }

    try {
      if (typeof chrome === 'undefined' || !chrome.offscreen) {
        this.offscreenUnavailable = true;
        return false;
      }

      await ensureOffscreenDocument();

      const response = (await chrome.runtime.sendMessage({
        target: 'offscreen-doc',
        type: 'SSE_CONNECT',
        url,
        token,
        accountId,
      })) as { success?: boolean } | undefined;

      if (!response?.success) {
        return false;
      }

      this.state.transport = 'offscreen';
      this.state.connected = true;
      this.state.reconnectAttempts = 0;
      this.state.lastEventTime = Date.now();
      this.state.consecutiveServerErrors = 0;
      log.info('✅ SSE stream hosted in offscreen document');
      return true;
    } catch (e) {
      log.debug('Offscreen SSE unavailable — falling back to in-worker stream', e);
      this.offscreenUnavailable = true;
      return false;
    }
  }

  /**
   * Re-attaches to an existing offscreen stream after this worker wakes up.
   * Returns true if a healthy stream is already running there.
   */
  async syncWithOffscreen(): Promise<boolean> {
    if (this.offscreenUnavailable || typeof chrome === 'undefined' || !chrome.offscreen) {
      return false;
    }

    try {
      const status = (await chrome.runtime.sendMessage({
        target: 'offscreen-doc',
        type: 'SSE_STATUS',
      })) as { success?: boolean; connected?: boolean; accountId?: string } | undefined;

      if (status?.success && status.connected) {
        this.state.transport = 'offscreen';
        this.state.connected = true;
        this.state.accountId = status.accountId ?? this.state.accountId;
        this.state.lastEventTime = Date.now();
        return true;
      }
    } catch {
      // No offscreen document listening — caller falls back.
    }

    if (this.state.transport === 'offscreen') {
      this.state.connected = false;
      this.state.transport = 'none';
    }
    return false;
  }

  /**
   * Set callback for when a new email arrives via SSE
   */
  setOnEmailReceived(callback: (accountId: string) => void): void {
    this.onEmailReceived = callback;
  }

  /**
   * Start SSE connection for a Mail.tm account
   */
  async connect(account: EmailAccount): Promise<boolean> {
    const flowId = diag.startFlow(
      'sse',
      'SSE Connect',
      `Account: ${account.id?.substring(0, 8)}...`
    );

    // Push is mail.tm-only: the transport below is hardcoded to the
    // mercure.mail.tm hub with a mail.tm JWT topic. mailcx was listed here
    // but has no push transport — those accounts burned 8 reconnects, then
    // fell back to polling anyway. Gate honestly so mailcx skips straight
    // to polling.
    const pushCapable: Record<string, boolean> = { mailtm: true };
    if (!pushCapable[account.service]) {
      diag.step(flowId, 'sse', 'Service check', `No push for ${account.service}`);
      diag.endFlow(flowId, 'sse', 'SSE Connect', false, `No push transport for ${account.service}`);
      return false;
    }

    if (!account.id || account.id === 'undefined' || account.id === 'null') {
      diag.log(
        'error',
        'sse',
        'Invalid account ID',
        `ID: ${account.id}`,
        { accountId: account.id, fullEmail: account.fullEmail },
        flowId,
        1
      );
      log.error('Cannot connect to SSE: account.id is missing or invalid', {
        accountId: account.id,
        fullEmail: account.fullEmail,
        hasToken: Boolean(account.token),
      });
      diag.endFlow(flowId, 'sse', 'SSE Connect', false, 'Account ID missing or invalid');
      return false;
    }

    if (this.state.connected && this.state.accountId === account.id) {
      diag.step(flowId, 'sse', 'Already connected', `Account: ${account.id}`);
      log.debug('Already connected to SSE for this account');
      diag.endFlow(flowId, 'sse', 'SSE Connect', true, 'Already connected');
      return true;
    }

    // Disconnect existing connection
    diag.step(flowId, 'sse', 'Disconnecting existing', '');
    const generation = ++this.connectionGeneration;
    this.disconnect(false);

    this.state.accountId = account.id;

    try {
      // Ensure we have a valid token
      diag.step(flowId, 'sse', 'Ensuring authenticated', '');
      await mailTmService.ensureAuthenticated?.();

      const token = mailTmService.getToken();
      if (!token) {
        diag.log('error', 'sse', 'No auth token', 'Falling back to polling', undefined, flowId, 2);
        log.error('No auth token available for SSE — falling back to polling');
        diag.endFlow(flowId, 'sse', 'SSE Connect', false, 'No auth token');
        return false;
      }

      // Build SSE URL with topic subscription
      const topic = `/accounts/${account.id}`;
      const sseUrl = `${MERCURE_HUB_URL}?topic=${encodeURIComponent(topic)}`;
      diag.step(flowId, 'sse', 'Connecting', `Topic: ${topic}`, { url: sseUrl });
      log.info('🔌 Connecting to Mail.tm SSE stream', { accountId: account.id, topic });

      // Prefer the offscreen relay — it is the only transport that survives
      // service-worker suspension, which is what caused missed OTP pushes.
      const relayUp = await this.connectViaOffscreen(sseUrl, token, account.id);

      if (generation !== this.connectionGeneration) {
        diag.endFlow(flowId, 'sse', 'SSE Connect', false, 'Connection superseded');
        return false;
      }

      if (relayUp) {
        this.startHealthCheck();
        diag.endFlow(flowId, 'sse', 'SSE Connect', true, 'Connected via offscreen relay');
        return true;
      }

      // Fallback: stream inside this worker (lost on suspension).
      await this.connectWithAuth(sseUrl, token, generation);

      if (generation !== this.connectionGeneration) {
        diag.endFlow(flowId, 'sse', 'SSE Connect', false, 'Connection superseded');
        return false;
      }

      diag.endFlow(flowId, 'sse', 'SSE Connect', true, 'Connected successfully');
      return true;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      diag.log('error', 'sse', 'SSE connection failed', errMsg, { error }, flowId, 4);
      log.error('Failed to connect to SSE', error);
      this.scheduleReconnect(account);
      diag.endFlow(flowId, 'sse', 'SSE Connect', false, `Connection failed: ${errMsg}`);
      return false;
    }
  }

  /**
   * Connect to SSE with authentication using fetch + ReadableStream
   * (EventSource doesn't support custom headers)
   */
  private async connectWithAuth(url: string, token: string, generation: number): Promise<void> {
    // Cancel any existing stream
    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }
    const abortController = new AbortController();
    this.currentAbortController = abortController;

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        signal: abortController.signal,
      });

      if (!response.ok) {
        const status = response.status;
        diag.log('error', 'sse', `SSE HTTP ${status}`, response.statusText, {
          status,
          statusText: response.statusText,
        });
        // Detect server errors that indicate infrastructure issues
        const isServerError = status >= 500 && status <= 599;
        if (isServerError) {
          this.state.consecutiveServerErrors++;
          diag.state(
            'sse',
            'Server error count',
            `${this.state.consecutiveServerErrors} consecutive errors`,
            { consecutiveErrors: this.state.consecutiveServerErrors }
          );
          log.warn(
            `SSE server error ${status} (consecutive: ${this.state.consecutiveServerErrors})`
          );

          // Activate circuit breaker after threshold
          if (this.state.consecutiveServerErrors >= CIRCUIT_BREAKER_THRESHOLD) {
            this.state.circuitBreakerUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
            this.state.consecutiveServerErrors = 0;
            this.state.hasNotifiedOutage = false;
            diag.state(
              'sse',
              'Circuit breaker ACTIVATED',
              `Cooldown: ${CIRCUIT_BREAKER_COOLDOWN_MS / 60000}min`
            );
            log.error(
              `SSE circuit breaker activated — Mercure hub appears down. Cooldown: ${CIRCUIT_BREAKER_COOLDOWN_MS / 60000}min`
            );
          }
        } else {
          // Non-server errors reset the counter
          this.state.consecutiveServerErrors = 0;
        }
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        diag.log('error', 'sse', 'SSE no body', 'Response has no body stream');
        throw new Error('SSE response has no body');
      }

      if (generation !== this.connectionGeneration) {
        return;
      }

      this.state.connected = true;
      this.state.transport = 'sw';
      this.state.reconnectAttempts = 0;
      this.state.lastEventTime = Date.now();
      this.state.consecutiveServerErrors = 0;
      diag.state('sse', 'SSE Connected', 'Real-time email push active', {
        accountId: this.state.accountId,
      });
      log.info('✅ SSE connected — real-time email push active');
      this.startHealthCheck();

      // Trigger immediate inbox check to catch any emails that arrived during outage
      emailService
        .getCurrentEmail()
        .then((account) => {
          if (account && account.service === 'mailtm') {
            log.info('📬 Running immediate inbox check after SSE reconnection');
            emailService.checkInbox(account).catch(() => {});
          }
        })
        .catch(() => {});

      // Read the stream
      const reader = response.body.getReader();
      this.state.streamReader = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      while (!abortController.signal.aborted && generation === this.connectionGeneration) {
        const { done, value } = await reader.read();
        if (done) {
          log.info('SSE stream ended');
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          this.processSSELine(line.trim());
        }
      }

      // Stream closed, attempt reconnection
      if (generation !== this.connectionGeneration) {
        return;
      }

      this.state.connected = false;
      this.state.streamReader = null;
      log.warn('SSE stream closed, reconnecting...');

      const currentEmail = await emailService.getCurrentEmail();
      if (currentEmail && currentEmail.service === 'mailtm' && currentEmail.id) {
        this.scheduleReconnect(currentEmail);
      } else {
        log.warn('Cannot reconnect after stream close — account invalid or missing id', {
          service: currentEmail?.service,
          hasId: Boolean(currentEmail?.id),
        });
      }
    } catch (error) {
      this.state.connected = false;
      this.state.streamReader = null;

      if ((error as Error).name === 'AbortError') {
        log.debug(
          generation === this.connectionGeneration
            ? 'SSE connection aborted (intentional)'
            : 'SSE connection superseded'
        );
        return;
      }

      if (generation !== this.connectionGeneration) {
        log.debug('Ignoring stale SSE connection error after newer connection started');
        return;
      }

      log.error('SSE connection error', error);

      // Check if circuit breaker is active
      if (this.state.circuitBreakerUntil > Date.now()) {
        const remaining = Math.round((this.state.circuitBreakerUntil - Date.now()) / 60000);
        if (!this.state.hasNotifiedOutage) {
          this.state.hasNotifiedOutage = true;
          log.warn(
            `⚠️ Mail.tm real-time notifications unavailable (Mercure hub down). Using polling fallback for ~${remaining}min.`
          );
        } else {
          log.debug(`Circuit breaker active — skipping reconnect (${remaining}min remaining)`);
        }
        return; // Don't schedule reconnect while circuit breaker is active
      }

      // Reset circuit breaker on successful connection after cooldown
      if (this.state.circuitBreakerUntil > 0 && Date.now() > this.state.circuitBreakerUntil) {
        this.state.circuitBreakerUntil = 0;
        this.state.consecutiveServerErrors = 0;
        this.state.hasNotifiedOutage = false;
        this.state.reconnectAttempts = 0; // allow fresh reconnect cycle
        log.info('Circuit breaker reset — attempting SSE reconnection');
      }

      const currentEmail = await emailService.getCurrentEmail();
      if (currentEmail && currentEmail.service === 'mailtm' && currentEmail.id) {
        this.scheduleReconnect(currentEmail);
      } else {
        log.warn('Cannot schedule SSE reconnect — account invalid or missing id', {
          service: currentEmail?.service,
          hasId: Boolean(currentEmail?.id),
          accountId: currentEmail?.id,
        });
      }
    }
  }

  /**
   * Process a single SSE line
   */
  private processSSELine(line: string): void {
    if (!line || line.startsWith(':')) {
      return; // Skip comments and empty lines
    }

    if (line.startsWith('data:')) {
      try {
        const data = JSON.parse(line.substring(5).trim());
        this.handleSSEEvent(data);
      } catch {
        log.debug('Failed to parse SSE data', { line: line.substring(0, 100) });
      }
    }
  }

  /**
   * Handle an SSE event (new email notification)
   * Mercure sends the full Account resource with updated "used" property
   */
  private handleSSEEvent(data: unknown): void {
    this.state.lastEventTime = Date.now();
    this.state.totalEventsReceived++;

    log.debug('📨 SSE event received', {
      accountId: this.state.accountId,
      data: JSON.stringify(data).substring(0, 200),
    });

    // Trigger inbox check to fetch the new email
    if (this.onEmailReceived && this.state.accountId) {
      this.onEmailReceived(this.state.accountId);
    }
  }

  /**
   * Schedule reconnection with exponential backoff using alarms (MV3 safe)
   */
  private scheduleReconnect(account: EmailAccount): void {
    if (this.state.reconnectTimer) {
      clearTimeout(this.state.reconnectTimer);
      this.state.reconnectTimer = null;
    }

    if (this.state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      diag.log(
        'error',
        'sse',
        'SSE max reconnects reached',
        `Falling back to polling after ${MAX_RECONNECT_ATTEMPTS} attempts`
      );
      log.error(
        `SSE max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached — falling back to polling`
      );
      this.state.connected = false;
      return;
    }

    this.state.totalReconnects++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(RECONNECT_MULTIPLIER, this.state.reconnectAttempts),
      RECONNECT_MAX_DELAY_MS
    );

    this.state.reconnectAttempts++;
    diag.state(
      'sse',
      'SSE reconnect scheduled',
      `Attempt ${this.state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`,
      { delay, attempt: this.state.reconnectAttempts }
    );
    log.info(
      `🔄 SSE reconnect scheduled in ${delay}ms (attempt ${this.state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
    );

    // MV3 FIX: Register alarm so reconnect survives Service Worker suspension
    if (typeof chrome !== 'undefined' && chrome.alarms?.create) {
      try {
        chrome.alarms.create('sse-reconnect', { when: Date.now() + delay });
      } catch (e) {
        log.debug('Failed to set sse-reconnect alarm', e);
      }
    }

    this.state.reconnectTimer = setTimeout(async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.alarms?.clear) {
          chrome.alarms.clear('sse-reconnect').catch(() => {});
        }
        await this.reconnectAccount(account);
      } catch (e) {
        log.error('SSE reconnect failed', e);
      }
    }, delay);
  }

  /**
   * Reconnect to active Mail.tm account (called by timer or alarm)
   */
  async reconnect(): Promise<void> {
    try {
      // After a worker restart the offscreen relay may already be streaming —
      // re-attach instead of tearing down a perfectly good connection.
      if (await this.syncWithOffscreen()) {
        return;
      }

      const account = await emailService.getCurrentEmail();
      if (account && account.service === 'mailtm' && account.id) {
        await this.reconnectAccount(account);
      }
    } catch (e) {
      log.error('SSE reconnect failed', e);
    }
  }

  private async reconnectAccount(account: EmailAccount): Promise<void> {
    if (account.service === 'mailtm' && account.fullEmail && account.password) {
      try {
        await mailTmService.authenticate(account.fullEmail, account.password);
        const freshToken = mailTmService.getToken();
        if (freshToken) {
          account.token = freshToken;
        }
      } catch (e) {
        log.warn('SSE reconnect: token refresh failed, using existing token', e);
      }
    }
    await this.connect(account);
  }

  /**
   * Check connection health (called periodically by alarms or timer)
   */
  checkHealth(): void {
    const silentTime = Date.now() - this.state.lastEventTime;
    if (silentTime <= MAX_SILENT_MS || !this.state.connected) {
      return;
    }

    // Silence on the offscreen relay is usually just "no new email" — Mercure
    // sends keepalive comment frames that we intentionally ignore. Only tear
    // down when the relay reports the stream is genuinely gone.
    if (this.state.transport === 'offscreen') {
      void this.syncWithOffscreen()
        .then((alive) => {
          if (alive) {
            this.state.lastEventTime = Date.now();
            return;
          }
          log.warn('SSE relay is gone — reconnecting', { silentTime });
          this.disconnect();
          return this.reconnect();
        })
        .catch((e) => log.error('SSE health reconnect failed', e));
      return;
    }

    log.warn('SSE silent for too long, reconnecting...', { silentTime });
    this.disconnect();
    this.reconnect().catch((e) => log.error('SSE health reconnect failed', e));
  }

  /**
   * Start health check to detect silent disconnections
   */
  private startHealthCheck(): void {
    this.stopHealthCheck();

    this.state.healthCheckTimer = setInterval(() => {
      this.checkHealth();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Stop health check
   */
  private stopHealthCheck(): void {
    if (this.state.healthCheckTimer) {
      clearInterval(this.state.healthCheckTimer);
      this.state.healthCheckTimer = null;
    }
  }

  /**
   * Disconnect SSE
   */
  disconnect(bumpGeneration = true): void {
    if (bumpGeneration) {
      this.connectionGeneration++;
    }

    // Tear down the offscreen relay as well (best-effort; it may already be gone).
    if (this.state.transport === 'offscreen' && typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime
        .sendMessage({ target: 'offscreen-doc', type: 'SSE_DISCONNECT' })
        .catch(() => undefined);
    }

    if (this.state.reconnectTimer) {
      clearTimeout(this.state.reconnectTimer);
      this.state.reconnectTimer = null;
    }

    this.stopHealthCheck();

    // Abort the fetch stream
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }

    // Close stream reader
    if (this.state.streamReader) {
      this.state.streamReader.releaseLock();
      this.state.streamReader = null;
    }

    this.state.connected = false;
    this.state.transport = 'none';
    this.state.accountId = null;
    this.state.reconnectAttempts = 0;

    log.info('🔌 SSE disconnected');
  }

  /**
   * Check if SSE circuit breaker is active (Mercure hub down)
   */
  isCircuitBreakerActive(): boolean {
    return this.state.circuitBreakerUntil > Date.now();
  }

  /**
   * Get time remaining until circuit breaker cooldown expires (ms)
   */
  getCircuitBreakerRemainingMs(): number {
    const remaining = this.state.circuitBreakerUntil - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Check if SSE is active and connected
   */
  isConnected(): boolean {
    return this.state.connected;
  }

  /**
   * Get SSE metrics for debugging
   */
  getMetrics(): object {
    return {
      connected: this.state.connected,
      transport: this.state.transport,
      accountId: this.state.accountId,
      reconnectAttempts: this.state.reconnectAttempts,
      totalEventsReceived: this.state.totalEventsReceived,
      totalReconnects: this.state.totalReconnects,
      lastEventTime: this.state.lastEventTime,
      circuitBreakerActive: this.state.circuitBreakerUntil > Date.now(),
      consecutiveServerErrors: this.state.consecutiveServerErrors,
    };
  }

  /**
   * Reset state (called on email session change)
   */
  reset(): void {
    this.disconnect();
    this.state.totalEventsReceived = 0;
    this.state.totalReconnects = 0;
    this.state.consecutiveServerErrors = 0;
    this.state.circuitBreakerUntil = 0;
    this.state.hasNotifiedOutage = false;
  }
}

// Export singleton
export const sseManager = new SSEManager();
