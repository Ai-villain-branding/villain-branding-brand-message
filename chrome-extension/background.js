// Screenshot Stabilizer Background Service Worker
// Handles extension lifecycle and permissions

chrome.runtime.onInstalled.addListener(() => {
    console.log('Screenshot Stabilizer extension installed');
});

// Handle any permission requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'stabilize') {
        // Extension is ready
        sendResponse({ success: true });
    }
    return true;
});





