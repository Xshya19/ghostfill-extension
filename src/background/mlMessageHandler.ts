import { createLogger } from '../utils/logger';
import { ensureOffscreenDocument } from './offscreenManager';

const log = createLogger('MLMessageHandler');

/**
 * Registers a chrome.runtime.onMessage listener for CLASSIFY_FIELD.
 * The background script acts as a proxy, forwarding the request to the offscreen document.
 */
export function registerMLMessageHandler(): void {
  chrome.runtime.onMessage.addListener(
    (
      message: { action: string; payload?: any },
      _sender,
      sendResponse: (response: unknown) => void
    ): boolean | undefined => {
      if (message.action !== 'CLASSIFY_FIELD' && message.action !== 'CHECK_ML') {
        return;
      }

      const { features, context } = message.payload || {};

      void (async () => {
        try {
          // 1. Ensure offscreen document exists and is ready
          await ensureOffscreenDocument();

          // 2. Forward the classification request to the offscreen document
          const msgType = message.action === 'CHECK_ML' ? 'CHECK_ML' : 'CLASSIFY_FIELD';
          const response: any = await chrome.runtime.sendMessage({
            target: 'offscreen-doc',
            type: msgType,
            payload: { features, context },
          });

          if (response?.success) {
            sendResponse({
              success: true,
              prediction: response.prediction,
              status: response.status,
            });
          } else {
            log.error(`ML offscreen ${msgType} returned failure`, response?.error);
            sendResponse({ success: false, prediction: null, error: response?.error });
          }
        } catch (err) {
          log.error('ML proxy classify failed', err);
          sendResponse({ success: false, prediction: null });
        }
      })();

      return true; // Keep channel open for async sendResponse
    }
  );

  log.debug('ML message handler registered (Proxy to Offscreen)');
}
