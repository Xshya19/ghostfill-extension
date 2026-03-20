/**
 * mlMessageHandler.ts
 * ──────────────────────────────────────────────────────────────────
 * Handles the CLASSIFY_FIELD message from the content script.
 * The background service worker receives field features extracted by
 * extractor.ts, runs them through the local ONNX model, and returns
 * the ML prediction.
 *
 * Message:  { action: 'CLASSIFY_FIELD', payload: RawFieldFeatures }
 * Response: { success: true, prediction: MLPrediction | null }
 */

import { createLogger } from '../utils/logger';
import { classifyField } from './inferenceEngine';
import type { RawFieldFeatures } from '../content/extractor';

const log = createLogger('MLMessageHandler');

/**
 * Registers a chrome.runtime.onMessage listener for CLASSIFY_FIELD.
 * Returns true (keeps the message channel open for async response).
 */
export function registerMLMessageHandler(): void {
  chrome.runtime.onMessage.addListener(
    (
      message: { action: string; payload?: unknown },
      _sender,
      sendResponse: (response: unknown) => void
    ): boolean | undefined => {
      if (message.action !== 'CLASSIFY_FIELD') {
        return; // Let other handlers process it
      }

      const features = message.payload as Omit<RawFieldFeatures, 'element'>;

      classifyField(features)
        .then((prediction) => {
          sendResponse({ success: true, prediction });
        })
        .catch((err) => {
          log.error('ML classify failed', err);
          sendResponse({ success: false, prediction: null });
        });

      return true; // Keep channel open for async sendResponse
    }
  );

  log.debug('ML message handler registered (CLASSIFY_FIELD)');
}
