// CloudFlare Bypass Extension Content Script
// Detects when Cloudflare challenge is solved and sends HTML to backend

(function() {
  'use strict';

  let hasBypassed = false;
  let checkInterval = null;
  const CHECK_INTERVAL_MS = 1000; // Check every second
  const MAX_WAIT_TIME = 60000; // Maximum 60 seconds to wait
  const startTime = Date.now();

  // Cloudflare challenge indicators
  const CLOUDFLARE_INDICATORS = [
    'checking your browser',
    'just a moment',
    'please wait',
    'cf-browser-verification',
    'cf-wrapper',
    'cf-ray',
    'cloudflare'
  ];

  // Check if page is showing Cloudflare challenge
  function isCloudflareChallenge() {
    const bodyText = (document.body?.innerText || document.body?.textContent || '').toLowerCase();
    const title = (document.title || '').toLowerCase();
    const html = document.documentElement.innerHTML.toLowerCase();

    // Check for Cloudflare indicators
    for (const indicator of CLOUDFLARE_INDICATORS) {
      if (bodyText.includes(indicator) || title.includes(indicator) || html.includes(indicator)) {
        // Check if challenge elements exist
        const cfWrapper = document.getElementById('cf-wrapper') || 
                         document.querySelector('.cf-wrapper') ||
                         document.querySelector('[class*="cf-"]');
        
        if (cfWrapper) {
          return true;
        }
      }
    }

    return false;
  }

  // Check if Cloudflare challenge has been solved
  function isChallengeSolved() {
    // If we previously detected a challenge, check if it's gone
    if (hasBypassed) {
      return true;
    }

    // Check if challenge page is still present
    const isChallenge = isCloudflareChallenge();
    
    if (!isChallenge) {
      // Challenge is not present - either solved or never existed
      // Wait a bit to ensure page is fully loaded
      return document.readyState === 'complete' && 
             !document.querySelector('#cf-wrapper, .cf-wrapper, [class*="cf-browser-verification"]');
    }

    return false;
  }

  // Send HTML to backend
  async function sendHtmlToBackend() {
    if (hasBypassed) {
      return; // Already sent
    }

    try {
      // Get proxy URL from background script
      const response = await chrome.runtime.sendMessage({ action: 'get-proxy-url' });
      const proxyUrl = response?.proxyUrl || 'http://localhost:3000/api/evidence/html';

      const html = document.documentElement.outerHTML;
      const url = window.location.href;
      const timestamp = new Date().toISOString();

      // Send to background script which will forward to backend
      const result = await chrome.runtime.sendMessage({
        action: 'cloudflare-bypassed',
        data: {
          url: url,
          html: html,
          timestamp: timestamp
        }
      });

      if (result?.success) {
        hasBypassed = true;
        console.log('[CloudFlare Bypass] HTML sent successfully:', result.result);
        
        // Store flag in window for Playwright to detect
        window.cloudflareBypassComplete = true;
        window.cloudflareBypassResult = result.result;
      } else {
        console.error('[CloudFlare Bypass] Failed to send HTML:', result?.error);
      }
    } catch (error) {
      console.error('[CloudFlare Bypass] Error sending HTML:', error);
    }
  }

  // Main monitoring function
  function monitorCloudflareChallenge() {
    // Check if we've exceeded max wait time
    if (Date.now() - startTime > MAX_WAIT_TIME) {
      console.log('[CloudFlare Bypass] Max wait time exceeded, stopping monitoring');
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
      return;
    }

    // Check if challenge was detected initially
    const wasChallenge = isCloudflareChallenge();
    
    if (wasChallenge) {
      // Challenge detected, wait for it to be solved
      if (isChallengeSolved()) {
        console.log('[CloudFlare Bypass] Challenge solved, sending HTML...');
        sendHtmlToBackend();
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
      }
    } else {
      // No challenge detected, but check if page is fully loaded
      if (document.readyState === 'complete') {
        // Page loaded without challenge, mark as complete
        hasBypassed = true;
        window.cloudflareBypassComplete = true;
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
      }
    }
  }

  // Start monitoring when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Wait a bit for Cloudflare challenge to appear
      setTimeout(() => {
        checkInterval = setInterval(monitorCloudflareChallenge, CHECK_INTERVAL_MS);
        monitorCloudflareChallenge(); // Initial check
      }, 500);
    });
  } else {
    // DOM already ready
    setTimeout(() => {
      checkInterval = setInterval(monitorCloudflareChallenge, CHECK_INTERVAL_MS);
      monitorCloudflareChallenge(); // Initial check
    }, 500);
  }

  // Also monitor on page load
  window.addEventListener('load', () => {
    setTimeout(() => {
      if (!hasBypassed && isChallengeSolved()) {
        sendHtmlToBackend();
      }
    }, 1000);
  });

  // Expose status for Playwright
  window.cloudflareBypassStatus = {
    isComplete: () => hasBypassed || window.cloudflareBypassComplete,
    getResult: () => window.cloudflareBypassResult
  };
})();

