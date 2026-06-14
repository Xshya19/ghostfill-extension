// Offscreen document handles clipboard and DOM-parser helper messages.

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
