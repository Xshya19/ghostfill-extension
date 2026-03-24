import { createLogger } from '../utils/logger';
import { ensureOffscreenDocument } from './offscreenManager';
import type { RawFieldFeatures } from '../content/extractor';

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
      if (message.action !== 'CLASSIFY_FIELD') {
        return;
      }

      const features = message.payload;

      (async () => {
        try {
          // 1. Ensure offscreen document exists and is ready
          await ensureOffscreenDocument();

          // 2. Forward the classification request to the offscreen document
          const response = await chrome.runtime.sendMessage({
            target: 'offscreen-doc',
            type: 'CLASSIFY_FIELD',
            payload: features
          });

          if (response?.success) {
            sendResponse({ success: true, prediction: response.prediction });
          } else {
            log.error('ML offscreen classify returned failure', response?.error);
            sendResponse({ success: false, prediction: null });
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



