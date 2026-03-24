// Suppress ONNX internal image.png error - harmless and expected for non-image models
const _originalError = console.error.bind(console);
console.error = function (...args: unknown[]) {
  const msg = String(args[0] || '');
  if (msg.includes('image.png') && msg.includes('does not support image input')) {
    console.warn('[GhostFill Offscreen]: ONNX model type check (expected):', msg);
    return;
  }
  _originalError(...args);
};

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
      classifyField(message.payload)
        .then((prediction) => sendResponse({ success: true, prediction }))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;
    }

    // ---- Warm-up Inference Engine ----
    if (message.target === 'offscreen-doc' && message.type === 'WARM_UP_ML') {
      initInferenceEngine()
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
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
  const textElement = document.createElement('textarea');
  textElement.value = text;
  document.body.appendChild(textElement);
  textElement.select();

  const success = document.execCommand('copy');
  document.body.removeChild(textElement);

  if (!success) {
    throw new Error('execCommand(copy) failed');
  }
}
