// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    // ---- Keep-alive Ping ----
    if (message.action === 'HEALTH_PING') {
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

    // ---- Handle unrecognized messages gracefully ----
    console.warn('Unrecognized message action in offscreen document:', message);
    sendResponse({ success: false, error: 'Unrecognized action' });
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
