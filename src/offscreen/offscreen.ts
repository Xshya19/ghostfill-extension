// Removed console.error override previously used for ONNX warnings

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
      const { features, context } = message.payload;
      classifyField(features, context)
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
    } catch (e) {
      throw new Error(`Clipboard copy failed: ${e}`);
    }
  } else {
    throw new Error('Clipboard API not available');
  }
}
