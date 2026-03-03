// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // ---- Keep-alive Ping ----
    if (message.action === 'HEALTH_PING') {
        sendResponse({ status: 'pong' });
        return true;
    }
});
