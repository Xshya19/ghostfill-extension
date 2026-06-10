// Removed console.error override previously used for ONNX warnings

import { RawFieldFeatures } from '../content/extractor';
import { PageContext } from '../types/form.types';
import { classifyField, initInferenceEngine } from './inferenceEngine';

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

    // ---- ML Classification ----
    if (message.target === 'offscreen-doc' && message.type === 'CLASSIFY_FIELD') {
      if (!message.payload || typeof message.payload !== 'object') {
        sendResponse({ success: false, error: 'Missing or invalid payload' });
        return true;
      }
      const { features, context } = message.payload as {
        features?: Omit<RawFieldFeatures, 'element'>;
        context?: unknown;
      };
      // FIX: features was typed as unknown, causing TS2345. Cast after null check
      // from the outer guard (typeof message.payload !== 'object') above.
      classifyField(features as Omit<RawFieldFeatures, 'element'>, context as PageContext)
        .then((prediction) => sendResponse({ success: true, prediction }))
        .catch((error: Error) => sendResponse({ success: false, error: String(error) }));
      return true;
    }

    // ---- Check ML Engine Health ----
    if (message.target === 'offscreen-doc' && message.type === 'CHECK_ML') {
      import('./inferenceEngine')
        .then(({ getEngineStatus }) => getEngineStatus())
        .then((status) => sendResponse({ success: true, status }))
        .catch((error: Error) => sendResponse({ success: false, error: String(error) }));
      return true;
    }

    // ---- Warm-up Inference Engine ----
    if (message.target === 'offscreen-doc' && message.type === 'WARM_UP_ML') {
      initInferenceEngine()
        .then(() => sendResponse({ success: true }))
        .catch((error: Error) => sendResponse({ success: false, error: String(error) }));
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
