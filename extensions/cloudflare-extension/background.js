// CloudFlare Bypass Extension Background Service Worker
// Sends HTML content to backend after Cloudflare challenge is solved

// Default proxy URL - can be overridden via chrome.storage or environment injection
const DEFAULT_PROXY_URL = 'http://localhost:3000/api/evidence/html';

let PROXY_URL = DEFAULT_PROXY_URL;

// Try to get custom URL from storage (can be set by Playwright)
chrome.storage.local.get(['proxyUrl'], (result) => {
  if (result.proxyUrl) {
    PROXY_URL = result.proxyUrl;
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'cloudflare-bypassed') {
    handleCloudflareBypass(request.data, sender.tab)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
  
  if (request.action === 'get-proxy-url') {
    sendResponse({ proxyUrl: PROXY_URL });
    return true;
  }
});

// Handle Cloudflare bypass completion
async function handleCloudflareBypass(data, tab) {
  try {
    const { url, html, timestamp } = data;
    
    // Send HTML to backend endpoint
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url,
        html: html,
        timestamp: timestamp || new Date().toISOString(),
        tabId: tab?.id
      })
    });

    if (!response.ok) {
      throw new Error(`Backend responded with status: ${response.status}`);
    }

    const result = await response.json();
    console.log('[CloudFlare Bypass] HTML sent to backend:', result);
    
    return result;
  } catch (error) {
    console.error('[CloudFlare Bypass] Error sending HTML to backend:', error);
    throw error;
  }
}

// Extension installed
chrome.runtime.onInstalled.addListener(() => {
  console.log('CloudFlare Bypass extension installed');
});

