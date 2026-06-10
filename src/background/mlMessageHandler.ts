import { createLogger } from '../utils/logger';
import { ensureOffscreenDocument } from './offscreenManager';

const log = createLogger('MLMessageHandler');

/**
 * Pure proxy helper: forwards a field-classification request to the offscreen
 * document and returns a normalized response.
 *
 * IMPORTANT: This module intentionally does NOT register its own
 * chrome.runtime.onMessage listener anymore.
 *
 * CLASSIFY_FIELD / CHECK_ML are already handled by the single canonical router
 * in messageHandler.ts (see `case 'CLASSIFY_FIELD'`). Registering a *second*
 * async listener that also returns `true` and calls sendResponse() makes Chrome
 * message delivery non-deterministic: Chrome resolves the first listener that
 * responds and the other response is dropped. serviceWorker.ts explicitly warns
 * against exactly this. The previous `registerMLMessageHandler()` installed that
 * duplicate listener, so it has been neutralized.
 *
 * If the router needs offscreen ML classification, call
 * `classifyFieldViaOffscreen()` from the single messageHandler.ts listener.
 */
export async function classifyFieldViaOffscreen(
  action: 'CLASSIFY_FIELD' | 'CHECK_ML',
  payload: { features?: unknown; context?: unknown } | undefined
): Promise<{ success: boolean; prediction: unknown; status?: unknown; error?: unknown }> {
  const { features, context } = payload ?? {};
  try {
    await ensureOffscreenDocument();
    const msgType = action === 'CHECK_ML' ? 'CHECK_ML' : 'CLASSIFY_FIELD';
    const response = (await chrome.runtime.sendMessage({
      target: 'offscreen-doc',
      type: msgType,
      payload: { features, context },
    })) as
      | { success?: boolean; prediction?: unknown; status?: unknown; error?: unknown }
      | undefined;

    if (response?.success) {
      return { success: true, prediction: response.prediction, status: response.status };
    }
    log.error(`ML offscreen ${msgType} returned failure`, response?.error);
    return { success: false, prediction: null, error: response?.error };
  } catch (err) {
    log.error('ML proxy classify failed', err);
    return { success: false, prediction: null };
  }
}

/**
 * @deprecated No-op retained for backward compatibility.
 *
 * The duplicate `chrome.runtime.onMessage` listener this used to install has
 * been removed to prevent double-sendResponse races on CLASSIFY_FIELD /
 * CHECK_ML. Calling this function now does nothing except log a debug line.
 */
export function registerMLMessageHandler(): void {
  log.debug(
    'registerMLMessageHandler() is now a no-op; CLASSIFY_FIELD/CHECK_ML are handled by messageHandler.ts. Use classifyFieldViaOffscreen() instead.'
  );
}
