const { chromium } = require('playwright');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const ConsentNeutralizer = require('./consentNeutralizer');
const {
    generateRandomFingerprint,
    generateHeaders,
    applyFingerprintEvasion,
    proxyManager,
    rateLimiter,
} = require('./antiDetection');

class ScreenshotService {
    constructor() {
        this.browser = null;
        this.minWidth = 800;
        this.minHeight = 600;
        this.defaultWidth = parseInt(process.env.SCREENSHOT_WIDTH) || 1440;
        this.defaultHeight = parseInt(process.env.SCREENSHOT_HEIGHT) || 900;
        // Initialize consent neutralizer for bypassing cookie consent popups
        this.consentNeutralizer = new ConsentNeutralizer({ loggingLevel: 'info' });
        // Track current fingerprint and proxy for the session
        this.currentFingerprint = null;
        this.currentProxy = null;
    }

    // Initialize browser
    async init() {
        try {
            // Check if browser exists and is connected
            if (this.browser) {
                try {
                    // Try to get browser version to check if it's still alive
                    await this.browser.version();
                    return; // Browser is alive, no need to recreate
                } catch (e) {
                    // Browser is dead, need to recreate
                    console.warn('Browser connection lost, recreating...');
                    this.browser = null;
                }
            }

            // Get absolute path to chrome extension directory
            const extensionPath = path.resolve(__dirname, '..', '..', '..', 'extensions', 'chrome-extension');

            // Verify extension directory exists
            if (!fs.existsSync(extensionPath)) {
                console.warn(`Chrome extension directory not found at ${extensionPath}, will use direct script injection instead`);
            }

            // Launch new browser with resource limits for Railway and Chrome extension loaded
            // Note: Extensions may not work in headless mode, so we'll also inject the script directly
            this.browser = await chromium.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage', // Use /tmp instead of /dev/shm
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    ...(fs.existsSync(extensionPath) ? [`--load-extension=${extensionPath}`] : []), // Load Chrome extension if it exists
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-features=TranslateUI',
                    '--disable-ipc-flooding-protection',
                ],
                timeout: 30000 // 30 second timeout
            });
        } catch (error) {
            console.error('Failed to initialize browser:', error);
            // Reset browser to null so next attempt will try again
            this.browser = null;
            throw error;
        }
    }

    // Close browser
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    // Detect if the page is an error/blocked page
    async detectErrorPage(page) {
        try {
            const result = await page.evaluate(() => {
                const bodyText = (document.body.innerText || document.body.textContent || '').toLowerCase();
                const title = (document.title || '').toLowerCase();
                const url = window.location.href.toLowerCase();
                const html = document.documentElement.outerHTML || '';

                // Common error page indicators (excluding Cloudflare challenge which we handle separately)
                const errorPatterns = [
                    'access denied',
                    'access forbidden',
                    '403 forbidden',
                    '404 not found',
                    'page not found',
                    'forbidden',
                    'unauthorized',
                    'blocked',
                    'you don\'t have permission',
                    'reference #', // Cloudflare error pages
                    'errors.edgesuite.net', // Akamai error pages
                    'this site can\'t be reached',
                    'err_',
                    'bot detected',
                    'captcha',
                    'robot',
                    'automated access',
                    'unusual traffic',
                    'please verify',
                    'security check',
                    'are you a robot',
                    'prove you\'re human',
                    'distil',  // Distil Networks bot protection
                    'datadome', // DataDome bot protection
                    'perimeterx', // PerimeterX bot protection
                    'akamai', // Akamai bot manager
                ];

                // Check title, body text, and URL for error indicators
                for (const pattern of errorPatterns) {
                    if (title.includes(pattern) || bodyText.includes(pattern) || url.includes(pattern)) {
                        return { blocked: true, reason: `Matched pattern: ${pattern}` };
                    }
                }

                // Check for challenge/captcha elements
                const captchaElements = [
                    'iframe[src*="recaptcha"]',
                    'iframe[src*="hcaptcha"]',
                    'iframe[src*="captcha"]',
                    '.g-recaptcha',
                    '.h-captcha',
                    '[data-sitekey]',
                    '#px-captcha',
                    '#ddg-challenge',
                    '.challenge-form',
                ];

                for (const selector of captchaElements) {
                    if (document.querySelector(selector)) {
                        return { blocked: true, reason: `Captcha element found: ${selector}` };
                    }
                }

                // Check for very short content (blocked pages are often minimal)
                const textLength = bodyText.trim().length;
                if (textLength < 500) {
                    // If content is very short, it's likely a blocked page
                    return { blocked: true, reason: `Content too short: ${textLength} chars` };
                }

                // Check if HTML is suspiciously small (less than 5KB is unusual for modern sites)
                if (html.length < 5000) {
                    return { blocked: true, reason: `HTML too small: ${html.length} chars` };
                }

                return { blocked: false };
            });

            if (result.blocked) {
                console.warn(`[detectErrorPage] Page appears blocked: ${result.reason}`);
            }
            return result.blocked;
        } catch (error) {
            // If detection fails, assume it's not an error page (better to try than to skip)
            return false;
        }
    }

    // Detect and wait for Cloudflare challenge to complete
    async waitForCloudflareChallenge(page, maxWaitTime = 30000) {
        try {
            const isCloudflareChallenge = await page.evaluate(() => {
                const bodyText = (document.body.innerText || document.body.textContent || '').toLowerCase();
                const title = (document.title || '').toLowerCase();

                // Cloudflare challenge indicators
                const challengePatterns = [
                    'verifying you are human',
                    'checking your browser',
                    'just a moment',
                    'please wait',
                    'ddos protection',
                    'cf-browser-verification',
                    'cf_chl_opt',
                    'checking if the site connection is secure',
                    'needs to review the security',
                    'ray id',
                    'performance & security by cloudflare'
                ];

                for (const pattern of challengePatterns) {
                    if (bodyText.includes(pattern) || title.includes(pattern)) {
                        return true;
                    }
                }

                // Also check for Cloudflare challenge elements
                const cfElements = document.querySelector('#cf-wrapper') ||
                    document.querySelector('.cf-browser-verification') ||
                    document.querySelector('#challenge-running') ||
                    document.querySelector('[data-cf-settings]') ||
                    document.querySelector('#challenge-form');
                return !!cfElements;
            });

            if (!isCloudflareChallenge) {
                return true; // No challenge detected, page is ready
            }

            console.log('[Cloudflare] Challenge detected, waiting for it to complete...');

            const startTime = Date.now();
            const checkInterval = 2000; // Check every 2 seconds

            while (Date.now() - startTime < maxWaitTime) {
                // Wait for some time
                await page.waitForTimeout(checkInterval);

                // Check if challenge is still present
                const stillChallenged = await page.evaluate(() => {
                    const bodyText = (document.body.innerText || document.body.textContent || '').toLowerCase();
                    const challengePatterns = [
                        'verifying you are human',
                        'checking your browser',
                        'just a moment',
                        'checking if the site connection is secure',
                        'needs to review the security'
                    ];

                    for (const pattern of challengePatterns) {
                        if (bodyText.includes(pattern)) {
                            return true;
                        }
                    }

                    const cfElements = document.querySelector('#cf-wrapper') ||
                        document.querySelector('#challenge-running') ||
                        document.querySelector('#challenge-form');
                    return !!cfElements;
                });

                if (!stillChallenged) {
                    console.log('[Cloudflare] Challenge completed successfully!');
                    // Wait a bit more for the page to fully load after challenge
                    await page.waitForTimeout(2000);
                    return true;
                }

                console.log(`[Cloudflare] Still waiting... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
            }

            console.warn('[Cloudflare] Challenge did not complete within timeout');
            return false;
        } catch (error) {
            console.warn('[Cloudflare] Error checking challenge:', error.message);
            return false;
        }
    }

    // Detect Akamai Bot Manager challenge
    async detectAkamaiBotChallenge(page) {
        try {
            return await page.evaluate(() => {
                const bodyText = (document.body.innerText || document.body.textContent || '').toLowerCase();
                const akamaiPatterns = [
                    'access denied',
                    'reference #',
                    'errors.edgesuite.net',
                    'your request has been blocked'
                ];

                for (const pattern of akamaiPatterns) {
                    if (bodyText.includes(pattern)) {
                        return true;
                    }
                }
                return false;
            });
        } catch (error) {
            return false;
        }
    }

    // Simulate human-like mouse movements
    async simulateHumanBehavior(page) {
        try {
            const viewport = page.viewportSize() || { width: 1366, height: 768 };
            const width = viewport.width;
            const height = viewport.height;

            // Move mouse to random positions with non-linear paths
            for (let i = 0; i < 5; i++) {
                const targetX = Math.floor(Math.random() * width);
                const targetY = Math.floor(Math.random() * height);

                // Use more steps for smoother, more human-like movement
                // Add some "jitter" to the movement
                await page.mouse.move(targetX, targetY, {
                    steps: Math.floor(Math.random() * 20) + 10
                });

                // Random pause after movement
                await page.waitForTimeout(Math.random() * 200 + 100);

                // Occasionally perform a small micro-movement (jitter)
                if (Math.random() > 0.7) {
                    await page.mouse.move(
                        targetX + (Math.random() * 10 - 5),
                        targetY + (Math.random() * 10 - 5),
                        { steps: 5 }
                    );
                }
            }

            // Random scroll
            if (Math.random() > 0.5) {
                const scrollAmount = Math.floor(Math.random() * 300) + 100;
                await page.mouse.wheel(0, scrollAmount);
                await page.waitForTimeout(Math.random() * 500 + 200);
            }

        } catch (e) {
            // Ignore errors during simulation
        }
    }

    // Scroll page naturally like a human
    async naturalScroll(page) {
        try {
            const totalHeight = await page.evaluate(() => document.body.scrollHeight);
            const viewportHeight = page.viewportSize()?.height || 800;
            let currentScroll = 0;

            // Don't always scroll to the very bottom, sometimes humans stop early or read sections
            const targetScroll = Math.random() > 0.1 ? totalHeight : totalHeight * (0.7 + Math.random() * 0.3);

            while (currentScroll < targetScroll) {
                // Random scroll amount (simulating a mouse wheel or trackpad flick)
                const scrollAmount = Math.floor(Math.random() * 400) + 150;
                currentScroll += scrollAmount;

                // Perform the scroll
                await page.mouse.wheel(0, scrollAmount);

                // Human-like pauses: longer pauses occasionally (simulating reading)
                const rand = Math.random();
                if (rand > 0.95) {
                    // Long reading pause
                    await page.waitForTimeout(Math.random() * 2000 + 1000);
                } else if (rand > 0.8) {
                    // Medium pause
                    await page.waitForTimeout(Math.random() * 800 + 400);
                } else {
                    // Short pause between scrolls
                    await page.waitForTimeout(Math.random() * 200 + 50);
                }

                // Occasionally scroll back up a bit (very human behavior - "wait, what was that?")
                if (Math.random() > 0.92 && currentScroll > 500) {
                    const scrollBack = Math.floor(Math.random() * 200) + 50;
                    await page.mouse.wheel(0, -scrollBack);
                    currentScroll -= scrollBack;
                    await page.waitForTimeout(Math.random() * 500 + 200);
                }

                // Re-calculate height in case of lazy loading
                const newHeight = await page.evaluate(() => document.body.scrollHeight);
                if (newHeight > totalHeight) {
                    // Page grew, continue scrolling
                }
            }
        } catch (e) {
            // Ignore errors
        }
    }

    // Scroll page to reveal content that might be below the fold
    async scrollPageToRevealContent(page) {
        try {
            // Use natural scrolling instead of instant jump
            await this.naturalScroll(page);

            // Ensure we reached the bottom
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
        } catch (error) {
            console.warn('[Playwright] Error scrolling page:', error.message);
        }
    }

    // Close popups, modals, cookie banners, etc.
    async closePopups(page) {
    try {
        // Priority 0: Forcefully hide OneTrust via DOM manipulation (most reliable)
        await page.evaluate(() => {
            // Hide OneTrust consent SDK entirely
            const otConsentSdk = document.getElementById('onetrust-consent-sdk');
            if (otConsentSdk) {
                otConsentSdk.style.display = 'none';
                otConsentSdk.style.visibility = 'hidden';
                console.log('[Popup Close] OneTrust consent SDK hidden via DOM');
            }

            // Hide OneTrust banner
            const otBanner = document.getElementById('onetrust-banner-sdk');
            if (otBanner) {
                otBanner.style.display = 'none';
                otBanner.style.visibility = 'hidden';
                console.log('[Popup Close] OneTrust banner hidden via DOM');
            }

            // Hide any OneTrust overlay
            const otOverlay = document.querySelector('.onetrust-pc-dark-filter');
            if (otOverlay) {
                otOverlay.style.display = 'none';
                console.log('[Popup Close] OneTrust overlay hidden via DOM');
            }

            // Restore body scroll
            document.body.style.overflow = 'auto';
            document.body.style.position = 'static';
            document.body.classList.remove('onetrust-consent-sdk-modal-open');
        }).catch(() => { });

        // Priority 1: Try clicking OneTrust "Allow All" button (matches screenshot)
        try {
            const allowAllBtn = await page.$('#onetrust-pc-btn-handler, .ot-pc-refuse-all-handler, #accept-recommended-btn-handler');
            if (allowAllBtn && await allowAllBtn.isVisible()) {
                console.log('Found OneTrust Allow All button, clicking...');
                await allowAllBtn.click();
                await page.waitForTimeout(500);
            }
        } catch (e) { }

        // Priority 2: Try the standard accept button
        const oneTrustBtn = await page.$('#onetrust-accept-btn-handler');
        if (oneTrustBtn && await oneTrustBtn.isVisible()) {
            console.log('Found OneTrust accept button, clicking...');
            await oneTrustBtn.click();
            await page.waitForTimeout(1000); // Wait for animation
        }

        // Priority 3: Try clicking any button with "Allow All" text
        try {
            const allowAllByText = await page.getByRole('button', { name: /allow all/i }).first();
            if (await allowAllByText.isVisible().catch(() => false)) {
                console.log('Found "Allow All" button by text, clicking...');
                await allowAllByText.click();
                await page.waitForTimeout(500);
            }
        } catch (e) { }

        // Strategy 0: Press Escape key (often closes modals)
        try {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
        } catch (e) {
            // Ignore key press errors
        }

        // Common selectors for popups, modals, and cookie banners
        const popupSelectors = [
            // Priority 1: OneTrust / CookiePro
            '#onetrust-banner-sdk .save-preference-btn-handler',
            '#onetrust-close-btn-container button',
            '#onetrust-accept-btn-handler',

            // Cookie consent banners
            '[id*="cookie"] button',
            '[class*="cookie"] button',
            '[id*="consent"] button',
            '[class*="consent"] button',
            '[id*="gdpr"] button',
            '[class*="gdpr"] button',
            '[id*="privacy"] button',
            '[class*="privacy"] button',

            // Common close buttons
            'button[aria-label*="close" i]',
            'button[aria-label*="dismiss" i]',
            'button[aria-label*="accept" i]',
            'button[aria-label*="decline" i]',

            // Modal close buttons
            '.modal-close',
            '.close-modal',
            '.popup-close',
            '.close-popup',
            '[class*="close-button"]',
            '[class*="close-btn"]',

            // Accept/Close buttons in cookie banners (including bain.com style)
            'button:has-text("Accept")',
            'button:has-text("Accept All")',
            'button:has-text("Accept All Cookies")',
            'button:has-text("ACCEPT ALL COOKIES")',
            'button:has-text("I Accept")',
            'button:has-text("Agree")',
            'button:has-text("I Agree")',
            'button:has-text("Got it")',
            'button:has-text("Okay")',
            'button:has-text("Allow all")',
            'button:has-text("Allow")',
            'button:has-text("Allow All")',
            'button:has-text("Allow Cookies")',
            'button:has-text("OK")',
            'button:has-text("Close")',
            'button:has-text("Continue")',
            'button:has-text("×")',
            'button:has-text("✕")',
            'div[role="button"]:has-text("×")',
            'div[role="button"]:has-text("✕")',
            'span:has-text("×")',
            'span:has-text("✕")',

            // Contact/Newsletter popups
            '[aria-label="Close"]',
            '[aria-label="close"]',
            '.close-icon',
            '.icon-close',
            'svg[data-icon="close"]',
            'button:has-text("No thanks")',
            'button:has-text("Not now")',
            'button:has-text("Maybe later")',
            'a:has-text("No thanks")',

            // Generic overlay/modal close buttons
            '[class*="overlay"] .close',
            '[class*="modal"] .close',
            '[class*="popup"] .close',
            '[class*="dialog"] .close',
            '[class*="banner"] .close',
            '[class*="overlay"] [class*="close"]',
            '[class*="modal"] [class*="close"]',
            '[class*="popup"] [class*="close"]',
            '[class*="dialog"] [class*="close"]',
            '[class*="banner"] [class*="close"]',

            // Aggressive generic close buttons (last resort)
            '.close',
            '[class*="close"]'
        ];

        // Try to find and click close buttons
        for (const selector of popupSelectors) {
            try {
                const elements = await page.$$(selector);
                for (const element of elements) {
                    const isVisible = await element.isVisible().catch(() => false);
                    if (isVisible) {
                        const text = await element.textContent().catch(() => '');
                        const lowerText = text.toLowerCase();

                        // Check if it's a close/accept button
                        if (lowerText.includes('accept') ||
                            lowerText.includes('allow') ||
                            lowerText.includes('agree') ||
                            lowerText.includes('close') ||
                            lowerText.includes('dismiss') ||
                            lowerText.includes('got it') ||
                            lowerText.includes('ok') ||
                            lowerText === '×' ||
                            lowerText === '✕' ||
                            lowerText === 'x') {
                            await element.click({ timeout: 1000 }).catch(() => { });
                            await page.waitForTimeout(500); // Wait for animation
                        }
                    }
                }
            } catch (e) {
                // Continue to next selector
            }
        }

        // Also try to find cookie banners by common text patterns
        const cookieBannerTexts = [
            'cookie',
            'privacy',
            'consent',
            'gdpr',
            'we value your privacy',
            'accept all cookies',
            'manage choices'
        ];

        for (const text of cookieBannerTexts) {
            try {
                // Look for buttons with these texts
                const button = page.getByRole('button', { name: new RegExp(text, 'i') });
                const count = await button.count();
                if (count > 0) {
                    const firstButton = button.first();
                    const buttonText = await firstButton.textContent().catch(() => '');
                    const lowerButtonText = buttonText.toLowerCase();

                    // Click accept/close buttons, but not "manage choices" or "decline"
                    if (lowerButtonText.includes('accept') ||
                        lowerButtonText.includes('allow') ||
                        lowerButtonText.includes('agree') ||
                        lowerButtonText.includes('got it') ||
                        lowerButtonText.includes('ok') ||
                        lowerButtonText.includes('close')) {
                        await firstButton.click({ timeout: 1000 }).catch(() => { });
                        await page.waitForTimeout(500);
                    }
                }
            } catch (e) {
                // Continue
            }
        }

        // Try pressing Escape key to close modals
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        // Scroll to top in case popup was at bottom
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(300);

    } catch (error) {
        console.warn('Error closing popups:', error.message);
        // Continue even if popup closing fails
    }
}

    // Find element containing text with multiple strategies
    async findElementWithText(page, text) {
    const cleanText = text.trim().replace(/\s+/g, ' ');
    const normalizedText = cleanText.toLowerCase();

    // Also create a version with common punctuation removed for better matching
    const normalizedTextNoPunct = normalizedText.replace(/[.,;:!?'"()\-]/g, ' ').replace(/\s+/g, ' ').trim();

    // Strategy 1: Custom script to find the smallest element containing the full text
    // This handles case-insensitive matching and finds the most specific element
    try {
        const handle = await page.evaluateHandle(({ targetText, normalizedTarget, normalizedTargetNoPunct }) => {
            // Get all text-containing elements, including those in shadow DOM if possible
            const elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, div, a, li, button, label, strong, em, b, i, article, section, blockquote, cite');
            let bestMatch = null;
            let minArea = Infinity;
            let bestScore = 0;

            for (const el of elements) {
                const elText = (el.innerText || el.textContent || '').trim();
                if (!elText) continue;

                const normalizedElText = elText.toLowerCase().replace(/\s+/g, ' ');
                const normalizedElTextNoPunct = normalizedElText.replace(/[.,;:!?'"()\-]/g, ' ').replace(/\s+/g, ' ').trim();

                // Check if element contains the target text (case-insensitive, with or without punctuation)
                const containsText = normalizedElText.includes(normalizedTarget) ||
                    normalizedElTextNoPunct.includes(normalizedTargetNoPunct);

                if (containsText) {
                    const rect = el.getBoundingClientRect();
                    const area = rect.width * rect.height;

                    // Score based on how well the text matches
                    let score = 0;
                    if (normalizedElText === normalizedTarget || normalizedElTextNoPunct === normalizedTargetNoPunct) {
                        score = 100; // Exact match
                    } else if (normalizedElText.startsWith(normalizedTarget) || normalizedElText.endsWith(normalizedTarget)) {
                        score = 80; // Starts or ends with
                    } else if (normalizedElTextNoPunct.includes(normalizedTargetNoPunct)) {
                        score = 70; // Match without punctuation
                    } else {
                        score = 60; // Contains
                    }

                    // Prefer smaller elements (more specific)
                    // Prefer visible elements
                    if (rect.width > 0 && rect.height > 0 &&
                        area > 0 &&
                        (score > bestScore || (score === bestScore && area < minArea))) {
                        minArea = area;
                        bestScore = score;
                        bestMatch = el;
                    }
                }
            }
            return bestMatch;
        }, { targetText: cleanText, normalizedTarget: normalizedText, normalizedTargetNoPunct: normalizedTextNoPunct });

        if (handle && handle.asElement()) {
            return handle.asElement();
        }
    } catch (error) {
        console.warn('Strategy 1 failed:', error.message);
    }

    // Strategy 2: Try to find text that might be split across multiple elements
    try {
        const element = await page.evaluateHandle(({ targetText, normalizedTarget, normalizedTargetNoPunct }) => {
            // Get all text nodes and check if their combined text contains the target
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                null
            );

            let node;
            const textNodes = [];
            while (node = walker.nextNode()) {
                const text = node.textContent.trim();
                if (text) {
                    textNodes.push({ node, text });
                }
            }

            // Check individual nodes
            for (const { node, text } of textNodes) {
                const normalizedText = text.toLowerCase().replace(/\s+/g, ' ');
                const normalizedTextNoPunct = normalizedText.replace(/[.,;:!?'"()\-]/g, ' ').replace(/\s+/g, ' ').trim();

                if (normalizedText.includes(normalizedTarget) || normalizedTextNoPunct.includes(normalizedTargetNoPunct)) {
                    // Find the parent element
                    let parent = node.parentElement;
                    while (parent && parent !== document.body) {
                        // Prefer semantic elements
                        const tag = parent.tagName.toLowerCase();
                        if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'div', 'a', 'li', 'article', 'section'].includes(tag)) {
                            return parent;
                        }
                        parent = parent.parentElement;
                    }
                    return node.parentElement;
                }
            }

            // Check if text is split across adjacent text nodes
            for (let i = 0; i < textNodes.length - 1; i++) {
                const combinedText = (textNodes[i].text + ' ' + textNodes[i + 1].text).trim();
                const normalizedCombined = combinedText.toLowerCase().replace(/\s+/g, ' ');
                const normalizedCombinedNoPunct = normalizedCombined.replace(/[.,;:!?'"()\-]/g, ' ').replace(/\s+/g, ' ').trim();

                if (normalizedCombined.includes(normalizedTarget) || normalizedCombinedNoPunct.includes(normalizedTargetNoPunct)) {
                    // Return the parent container of both nodes
                    let parent1 = textNodes[i].node.parentElement;
                    let parent2 = textNodes[i + 1].node.parentElement;

                    // Find common ancestor
                    while (parent1 && parent1 !== document.body) {
                        if (parent1.contains(parent2) || parent1 === parent2) {
                            return parent1;
                        }
                        parent1 = parent1.parentElement;
                    }

                    // Fallback to first node's parent
                    return textNodes[i].node.parentElement;
                }
            }

            return null;
        }, { targetText: cleanText, normalizedTarget: normalizedText, normalizedTargetNoPunct: normalizedTextNoPunct });

        if (element && element.asElement()) {
            return element.asElement();
        }
    } catch (error) {
        console.warn('Strategy 2 failed:', error.message);
    }

    // Strategy 3: Playwright's getByText as fallback
    try {
        const element = page.getByText(cleanText, { exact: false });
        if (await element.count() > 0) return element.first();
    } catch (error) {
        console.warn('Strategy 3 failed:', error.message);
    }

    // Strategy 4: Try searching in iframes
    try {
        const frames = page.frames();
        for (const frame of frames) {
            if (frame === page.mainFrame()) continue; // Skip main frame, already searched
            try {
                const frameElement = await frame.evaluateHandle(({ targetText, normalizedTarget }) => {
                    const elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, div, a, li');
                    for (const el of elements) {
                        const elText = (el.innerText || el.textContent || '').trim();
                        const normalizedElText = elText.toLowerCase().replace(/\s+/g, ' ');
                        if (normalizedElText.includes(normalizedTarget)) {
                            return el;
                        }
                    }
                    return null;
                }, { targetText: cleanText, normalizedTarget: normalizedText });

                if (frameElement && frameElement.asElement()) {
                    return frameElement.asElement();
                }
            } catch (frameError) {
                // Continue to next frame
            }
        }
    } catch (error) {
        console.warn('Strategy 4 (iframe search) failed:', error.message);
    }

    // Strategy 5: Try partial text match (first 30 characters)
    if (cleanText.length > 30) {
        try {
            const partialText = cleanText.substring(0, 30).trim();
            const element = page.getByText(partialText, { exact: false });
            if (await element.count() > 0) {
                console.log(`Found partial match for text (first 30 chars): "${partialText}"`);
                return element.first();
            }
        } catch (error) {
            // Ignore partial match errors
        }
    }

    return null;
}

    // Calculate bounding box with context
    async calculateBoundingBox(element, page) {
    const box = await element.boundingBox();
    if (!box) return null;

    // Try to get a reasonable parent container for context, but be more selective
    let contextBox = box;

    try {
        const result = await element.evaluate(el => {
            const elBox = el.getBoundingClientRect();
            let current = el.parentElement;
            let depth = 0;
            let bestParent = null;
            let bestScore = 0;

            // Look for a parent that provides good context but isn't too large
            while (current && depth < 5) {
                const rect = current.getBoundingClientRect();
                const classes = current.className.toLowerCase();
                const tag = current.tagName.toLowerCase();

                // Skip if parent is too large (likely contains multiple cards/sections)
                if (rect.height > 800 || rect.width > 1400) {
                    current = current.parentElement;
                    depth++;
                    continue;
                }

                // Check if this parent contains multiple similar elements (like multiple cards)
                const children = Array.from(current.children || []);
                const similarElements = children.filter(child => {
                    const childRect = child.getBoundingClientRect();
                    // Check if child has similar dimensions (likely a card or similar component)
                    return childRect.height > 200 && childRect.width > 200 &&
                        Math.abs(childRect.height - rect.height / children.length) < rect.height * 0.3;
                });

                // If parent has multiple similar children, it's likely a grid/list of cards - skip it
                if (similarElements.length > 1) {
                    current = current.parentElement;
                    depth++;
                    continue;
                }

                // Prefer specific containers that are likely to be individual cards/sections
                let score = 0;
                if (classes.includes('card') || tag === 'article') {
                    score = 10; // High preference for cards/articles
                } else if (classes.includes('hero') || classes.includes('banner')) {
                    score = 8;
                } else if (tag === 'section' && rect.height < 600) {
                    score = 5; // Only small sections
                } else if (classes.includes('container') && rect.height < 500) {
                    score = 3; // Only small containers
                }

                // Prefer parents that are not much larger than the element
                const sizeRatio = (rect.width * rect.height) / (elBox.width * elBox.height);
                if (sizeRatio > 10) {
                    score = 0; // Too large, don't use
                } else if (sizeRatio < 3) {
                    score += 2; // Bonus for tight parents
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestParent = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                }

                current = current.parentElement;
                depth++;
            }

            return bestParent;
        });

        if (result) {
            const scrollY = await page.evaluate(() => window.scrollY);
            const scrollX = await page.evaluate(() => window.scrollX);
            contextBox = {
                x: result.x + scrollX,
                y: result.y + scrollY,
                width: result.width,
                height: result.height
            };
        }
    } catch (error) {
        console.warn('Error calculating parent box, using element box:', error.message);
    }

    // Use more conservative padding - focus on the element itself
    const padding = 40; // Reduced from 100
    const finalBox = {
        x: Math.max(0, contextBox.x - padding),
        y: Math.max(0, contextBox.y - padding),
        width: contextBox.width + (padding * 2),
        height: contextBox.height + (padding * 2)
    };

    // Ensure reasonable bounds but don't force minimums that are too large
    const viewport = page.viewportSize();

    // Don't exceed viewport dimensions
    finalBox.width = Math.min(viewport.width, finalBox.width);
    finalBox.height = Math.min(viewport.height, finalBox.height);

    // Ensure minimum reasonable size, but not too large
    finalBox.width = Math.max(300, Math.min(finalBox.width, 1200));
    finalBox.height = Math.max(200, Math.min(finalBox.height, 800));

    // Adjust x if width was capped
    if (finalBox.x + finalBox.width > viewport.width) {
        finalBox.x = Math.max(0, viewport.width - finalBox.width);
    }

    // Adjust y if height was capped
    if (finalBox.y + finalBox.height > viewport.height) {
        finalBox.y = Math.max(0, viewport.height - finalBox.height);
    }

    return finalBox;
}

    // Inject content script directly into page (fallback when extension doesn't load)
    async injectStabilizerScript(page) {
    try {
        const contentScriptPath = path.resolve(__dirname, '..', '..', '..', 'extensions', 'chrome-extension', 'content.js');

        if (fs.existsSync(contentScriptPath)) {
            const contentScript = fs.readFileSync(contentScriptPath, 'utf8');
            // Inject script before page loads using addInitScript
            await page.addInitScript(contentScript);
            console.log('Screenshot stabilizer script injected directly into page');
            return true;
        } else {
            console.warn('Content script file not found, cannot inject stabilizer');
            return false;
        }
    } catch (error) {
        console.warn('Failed to inject stabilizer script:', error.message);
        return false;
    }
}

    // Wait for Chrome extension to be ready and use its stabilization utilities
    async waitForExtensionReady(page) {
    try {
        // Wait for extension/script to initialize (with timeout)
        // Note: Script should already be injected via addInitScript before navigation
        const maxWaitTime = 3000; // 3 seconds max wait
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            const isReady = await page.evaluate(() => {
                return window.screenshotStabilizerReady === true;
            }).catch(() => false);

            if (isReady) {
                // Extension/script is ready, use its utilities
                try {
                    // Wait for fonts to load (extension function returns a Promise)
                    await page.evaluate(async () => {
                        if (window.screenshotStabilizer && window.screenshotStabilizer.waitForFonts) {
                            await window.screenshotStabilizer.waitForFonts();
                        }
                    });

                    // Wait for animations to complete (extension function returns a Promise)
                    await page.evaluate(async () => {
                        if (window.screenshotStabilizer && window.screenshotStabilizer.waitForAnimations) {
                            await window.screenshotStabilizer.waitForAnimations();
                        }
                    });

                    // Force load lazy content (synchronous function)
                    await page.evaluate(() => {
                        if (window.screenshotStabilizer && window.screenshotStabilizer.forceLoadLazyContent) {
                            window.screenshotStabilizer.forceLoadLazyContent();
                        }
                    });

                    // Wait for fully loaded state if available
                    const fullyLoaded = await page.evaluate(() => {
                        return new Promise((resolve) => {
                            if (window.screenshotStabilizerFullyLoaded) {
                                resolve(true);
                            } else {
                                // Wait up to 2 seconds for fully loaded state
                                const checkInterval = setInterval(() => {
                                    if (window.screenshotStabilizerFullyLoaded) {
                                        clearInterval(checkInterval);
                                        resolve(true);
                                    }
                                }, 100);
                                setTimeout(() => {
                                    clearInterval(checkInterval);
                                    resolve(false); // Timeout - extension may not set this flag
                                }, 2000);
                            }
                        });
                    });

                    if (fullyLoaded) {
                        console.log('Screenshot stabilizer ready and page stabilized');
                    }

                    return true;
                } catch (utilError) {
                    console.warn('Stabilizer utilities error (continuing anyway):', utilError.message);
                    return true; // Stabilizer is ready even if utilities fail
                }
            }

            // Wait a bit before checking again
            await page.waitForTimeout(100);
        }

        // If script was injected but not ready, try to initialize it manually
        try {
            // Try to trigger initialization manually
            await page.evaluate(() => {
                if (typeof window.screenshotStabilizer === 'undefined') {
                    // Script might not have initialized, try to run it
                    if (document.readyState === 'complete' || document.readyState === 'interactive') {
                        // Force initialization
                        const event = new Event('DOMContentLoaded');
                        document.dispatchEvent(event);
                    }
                }
            });
            // Give it a moment
            await page.waitForTimeout(500);

            // Check again
            const isReady = await page.evaluate(() => {
                return window.screenshotStabilizerReady === true;
            }).catch(() => false);

            if (isReady) {
                return true;
            }
        } catch (e) {
            // Ignore initialization errors
        }

        // Stabilizer didn't load in time, but continue anyway (fallback behavior)
        console.warn('Screenshot stabilizer did not initialize in time, continuing without stabilization features');
        return false;
    } catch (error) {
        // Stabilizer failed to load, but continue with normal screenshot flow
        console.warn('Screenshot stabilizer not available (continuing without stabilization features):', error.message);
        return false;
    }
}

    // Highlight element for better visibility in screenshot
    async highlightElement(element) {
    try {
        await element.evaluate(el => {
            el.style.outline = '2px solid rgba(212, 175, 55, 0.5)';
            el.style.outlineOffset = '4px';
            el.style.borderRadius = '2px';
            el.style.backgroundColor = 'rgba(212, 175, 55, 0.05)';
        });
    } catch (e) {
        // Ignore highlight errors
    }
}

    // Capture screenshot for a single message on a page
    async captureMessage(url, messageText, messageId, retries = 2) {
    let context = null;
    let page = null;

    try {
        // Initialize browser with retry
        for (let i = 0; i < 3; i++) {
            try {
                await this.init();
                break;
            } catch (initError) {
                if (i === 2) throw initError;
                console.warn(`Browser init failed, retrying... (${i + 1}/3)`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                this.browser = null; // Force recreation
            }
        }

        // Create context with realistic browser fingerprint
        const fingerprint = generateRandomFingerprint();
        const headers = generateHeaders(fingerprint);

        context = await this.browser.newContext({
            viewport: fingerprint.viewport,
            userAgent: fingerprint.userAgent,
            locale: fingerprint.locale,
            timezoneId: fingerprint.timezone,
            timeout: 30000,
            // Bypass some bot detection
            bypassCSP: true,
            ignoreHTTPSErrors: true,
            // Add extra headers to appear more like a real browser
            extraHTTPHeaders: headers
        });

        // CRITICAL: Inject consent neutralization BEFORE creating page
        // This overrides OneTrust, Cookiebot, and other CMPs at the API level
        this.consentNeutralizer.resetStats();
        await this.consentNeutralizer.injectCMPNeutralizer(context);
        await this.consentNeutralizer.injectConsentState(context);
        console.log('[Screenshot] CMP neutralization applied to context');

        page = await context.newPage({
            timeout: 30000
        });

        // Apply fingerprint evasion scripts
        await applyFingerprintEvasion(page, fingerprint);

        // Setup safe network handling (blocks trackers but allows consent scripts)
        await this.consentNeutralizer.setupSafeNetworkHandling(page);

        // Inject stabilizer script before navigation (works better than extension in headless mode)
        await this.injectStabilizerScript(page);

        // Navigate to page with more lenient wait strategy
        // Use 'load' instead of 'networkidle' to avoid timeout on sites with continuous network activity
        try {
            await page.goto(url, {
                waitUntil: 'load',
                timeout: 60000  // Increased timeout to 60 seconds
            });
        } catch (timeoutError) {
            // If load times out, try with domcontentloaded as fallback
            console.warn(`Load timeout for ${url}, trying domcontentloaded...`);
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });
        }

        // Wait for Chrome extension/script to be ready and stabilize the page
        await this.waitForExtensionReady(page);

        // Apply CSS overlay removal for any consent banners that still appear
        await this.consentNeutralizer.applyOverlayCSS(page);
        console.log('[Screenshot] CSS overlay removal applied');

        // Apply DOM cleanup to physically remove overlays
        await this.consentNeutralizer.removeOverlaysFromDOM(page);
        console.log('[Screenshot] DOM cleanup applied');

        // Wait a bit for any animations and dynamic content
        await page.waitForTimeout(2000);

        // Move mouse to top-left corner to avoid triggering hover menus
        try {
            await page.mouse.move(0, 0);
        } catch (e) {
            // Ignore mouse move errors
        }

        // Check if page is an error/blocked page before proceeding
        const isErrorPage = await this.detectErrorPage(page);
        if (isErrorPage) {
            const errorDetails = await page.evaluate(() => {
                const bodyText = document.body.innerText || document.body.textContent || '';
                const title = document.title || '';
                return { bodyText: bodyText.substring(0, 200), title };
            }).catch(() => ({ bodyText: '', title: '' }));

            throw new Error(`Page is blocked or inaccessible. Error: ${errorDetails.title || 'Access Denied'}. ${errorDetails.bodyText.substring(0, 100)}`);
        }

        // Close any popups, modals, or cookie banners before taking screenshot
        await this.closePopups(page);

        // Scroll page to reveal content that might be below the fold
        await this.scrollPageToRevealContent(page);

        // Wait for dynamic content to load after scrolling
        await page.waitForTimeout(1500);

        // Wait for network to be idle (for dynamically loaded content)
        try {
            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });
        } catch (e) {
            // Ignore timeout, continue anyway
        }

        // Find element containing the message (with retry and scrolling)
        let element = await this.findElementWithText(page, messageText);

        // If not found, try scrolling and searching again
        if (!element) {
            console.log('Text not found on initial search, trying with page scroll...');
            await this.scrollPageToRevealContent(page);
            await page.waitForTimeout(2000);
            // Wait for any lazy-loaded content
            await page.evaluate(() => {
                // Trigger scroll events that might load content
                window.dispatchEvent(new Event('scroll'));
            });
            await page.waitForTimeout(1000);
            element = await this.findElementWithText(page, messageText);
        }

        // If still not found, try searching for partial matches with different lengths
        if (!element) {
            console.log('Full text not found, trying partial matches...');
            // Try progressively smaller chunks
            const partialLengths = [50, 40, 30, 20];
            for (const len of partialLengths) {
                if (messageText.length > len) {
                    const partialText = messageText.substring(0, len).trim();
                    element = await this.findElementWithText(page, partialText);
                    if (element) {
                        console.log(`Found partial match (first ${len} chars): "${partialText}"`);
                        break;
                    }
                }
            }
        }

        // If still not found, try searching for key phrases
        if (!element) {
            console.log('Trying to find key phrases from the text...');
            // Extract key phrases (words of 4+ characters)
            const words = messageText.split(/\s+/).filter(w => w.length >= 4);
            if (words.length > 0) {
                // Try first significant word
                element = await this.findElementWithText(page, words[0]);
                if (!element && words.length > 1) {
                    // Try a phrase of first 2-3 significant words
                    const phrase = words.slice(0, Math.min(3, words.length)).join(' ');
                    element = await this.findElementWithText(page, phrase);
                }
            }
        }

        // Debug: Log page text if still not found
        if (!element) {
            const pageText = await page.evaluate(() => {
                return document.body.innerText || document.body.textContent || '';
            }).catch(() => '');
            console.log(`Page text preview (first 500 chars): ${pageText.substring(0, 500)}`);
            console.log(`Searching for: "${messageText.substring(0, 100)}..."`);
        }

        // If exact text not found, try to find a related element with key terms
        if (!element) {
            // Extract key terms (important words, 5+ characters)
            const keyTerms = messageText
                .split(/\s+/)
                .filter(word => word.length >= 5)
                .map(word => word.replace(/[.,;:!?'"()\-]/g, ''))
                .filter(word => word.length >= 5)
                .slice(0, 3); // Take top 3 key terms

            if (keyTerms.length > 0) {
                console.log(`Exact text not found, searching for key terms: ${keyTerms.join(', ')}`);
                for (const term of keyTerms) {
                    element = await this.findElementWithText(page, term);
                    if (element) {
                        console.log(`Found element containing key term: "${term}"`);
                        break;
                    }
                }
            }
        }

        // Last resort: try to find main content area (but only if not an error page)
        if (!element) {
            // Double-check it's not an error page before using fallback
            const isErrorPage = await this.detectErrorPage(page);
            if (isErrorPage) {
                throw new Error(`Page appears to be blocked or inaccessible. Cannot capture screenshot.`);
            }

            try {
                const fallbackElement = await page.evaluateHandle(() => {
                    // Find the main content area (article, main, or largest text container)
                    const mainContent = document.querySelector('main, article, [role="main"]') ||
                        document.querySelector('.content, .main-content, #content, #main');
                    if (mainContent) {
                        return mainContent;
                    }
                    // Fallback to body
                    return document.body;
                });

                if (fallbackElement && fallbackElement.asElement()) {
                    console.log('Using fallback: capturing main content area');
                    element = fallbackElement.asElement();
                }
            } catch (e) {
                // Ignore fallback errors
            }
        }

        if (!element) {
            throw new Error(`Could not find text "${messageText}" on page`);
        }

        // Scroll element into view with timeout handling
        try {
            // Check if element is visible first
            const isVisible = await element.isVisible().catch(() => false);
            if (!isVisible) {
                // Try to get bounding box and scroll manually
                const box = await element.boundingBox().catch(() => null);
                if (box) {
                    await page.evaluate(({ x, y }) => {
                        window.scrollTo(x, y - 100);
                    }, box);
                    await page.waitForTimeout(500);
                } else {
                    // Element might not be in viewport, try scrollIntoViewIfNeeded with shorter timeout
                    await element.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => { });
                    await page.waitForTimeout(500);
                }
            } else {
                // Element is visible, just ensure it's in view
                await element.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => { });
                await page.waitForTimeout(500);
            }
        } catch (scrollError) {
            // If scroll fails, try manual scroll
            try {
                const box = await element.boundingBox().catch(() => null);
                if (box) {
                    await page.evaluate(({ x, y }) => {
                        window.scrollTo(x, y - 100);
                    }, box);
                    await page.waitForTimeout(500);
                }
            } catch (manualScrollError) {
                console.warn('Could not scroll element into view, continuing anyway');
            }
        }

        // Highlight the element subtly
        await this.highlightElement(element);

        // Get viewport dimensions for metadata
        const viewport = page.viewportSize();

        // Capture screenshot of entire visible viewport (not cropped)
        const screenshotBuffer = await page.screenshot({
            type: 'png',
            fullPage: false  // Only capture visible viewport, not entire page
        });

        const screenshotId = uuidv4();
        const metadata = {
            id: screenshotId,
            messageId: messageId,
            messageText: messageText,
            url: url,
            dimensions: {
                width: viewport.width,
                height: viewport.height
            },
            capturedAt: new Date().toISOString()
        };

        return {
            id: screenshotId,
            buffer: screenshotBuffer,
            metadata: metadata
        };

    } catch (error) {
        console.error(`Error capturing screenshot for "${messageText}" at ${url}:`, error.message);

        // If browser crashed, reset it and retry once
        if ((error.message.includes('Target page, context or browser has been closed') ||
            error.message.includes('browser has been closed') ||
            error.message.includes('Browser closed')) && retries > 0) {
            console.warn('Browser crashed, resetting and retrying...');
            this.browser = null; // Force browser recreation
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait before retry
            return this.captureMessage(url, messageText, messageId, retries - 1);
        }

        // If text not found, return null instead of throwing (allows graceful handling)
        if (error.message.includes('Could not find text')) {
            return null;
        }

        return null;
    } finally {
        // Always cleanup page and context
        try {
            if (page) await page.close().catch(() => { });
        } catch (e) {
            console.warn('Error closing page:', e.message);
        }
        try {
            if (context) await context.close().catch(() => { });
        } catch (e) {
            console.warn('Error closing context:', e.message);
        }
    }
}

    // Capture screenshots for multiple messages
    async captureMessages(messages, onProgress) {
    const screenshots = [];
    let completed = 0;

    // Create a list of all screenshots to capture
    const tasks = [];
    messages.forEach(message => {
        message.urls.forEach(url => {
            tasks.push({
                url: url,
                messageText: message.text,
                messageId: message.id
            });
        });
    });

    const total = tasks.length;

    for (const task of tasks) {
        if (onProgress) {
            onProgress({
                current: completed + 1,
                total: total,
                url: task.url,
                message: task.messageText
            });
        }

        const screenshot = await this.captureMessage(
            task.url,
            task.messageText,
            task.messageId
        );

        if (screenshot) {
            screenshots.push(screenshot);
        }

        completed++;

        // Small delay between captures
        if (completed < total) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    return screenshots;
}
    // Fetch full page content (HTML) using Playwright with retry strategies
    async fetchPageContent(url, retryCount = 0) {
    let context = null;
    let page = null;
    const maxRetries = 3;

    // Different strategies for each retry attempt
    const strategies = [
        { name: 'stealth-mode', forceHttp1: true, extraArgs: ['--disable-http2', '--disable-blink-features=AutomationControlled'] },
        { name: 'default', forceHttp1: false, extraArgs: [] },
        { name: 'http1-fallback', forceHttp1: true, extraArgs: ['--disable-http2'] }
    ];

    const strategy = strategies[Math.min(retryCount, strategies.length - 1)];

    // Generate a new random fingerprint for each retry
    const fingerprint = generateRandomFingerprint();
    const headers = generateHeaders(fingerprint);

    // Get proxy if available (rotate on each retry)
    const proxy = proxyManager.getNextProxy();

    console.log(`[Playwright] Fetching content for: ${url} (Strategy: ${strategy.name}, Attempt: ${retryCount + 1}/${maxRetries}${proxy ? ', Using proxy' : ''})`);

    try {
        // Apply rate limiting before request
        await rateLimiter.wait(url);

        // Initialize browser with retry and specific strategy
        for (let i = 0; i < 3; i++) {
            try {
                // If we need HTTP/1.1 or special args, recreate browser with those settings
                if (strategy.extraArgs.length > 0 && this.browser) {
                    await this.close();
                }

                if (!this.browser) {
                    const extensionPath = path.resolve(__dirname, '..', '..', '..', 'extensions', 'chrome-extension');

                    // Build browser launch options
                    const launchOptions = {
                        headless: true,
                        args: [
                            '--no-sandbox',
                            '--disable-setuid-sandbox',
                            '--disable-dev-shm-usage',
                            '--disable-gpu',
                            '--disable-software-rasterizer',
                            ...(fs.existsSync(extensionPath) ? [`--load-extension=${extensionPath}`] : []),
                            '--disable-background-networking',
                            '--disable-background-timer-throttling',
                            '--disable-backgrounding-occluded-windows',
                            '--disable-renderer-backgrounding',
                            '--disable-features=TranslateUI',
                            '--disable-ipc-flooding-protection',
                            '--disable-blink-features=AutomationControlled', // Always hide automation
                            ...strategy.extraArgs  // Add strategy-specific args (like --disable-http2)
                        ],
                        timeout: 30000
                    };

                    // Add proxy if available
                    if (proxy) {
                        launchOptions.proxy = { server: proxy };
                    }

                    this.browser = await chromium.launch(launchOptions);
                } else {
                    await this.init();
                }
                break;
            } catch (initError) {
                if (i === 2) throw initError;
                console.warn(`Browser init failed, retrying... (${i + 1}/3)`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                this.browser = null;
            }
        }

        // Create context with randomized browser fingerprint
        context = await this.browser.newContext({
            userAgent: fingerprint.userAgent,
            viewport: fingerprint.viewport,
            locale: fingerprint.locale,
            timezoneId: fingerprint.timezone,
            // Add extra headers to appear more like a real browser
            extraHTTPHeaders: headers
        });

        page = await context.newPage();

        // Apply fingerprint evasion scripts
        await applyFingerprintEvasion(page, fingerprint);

        // Record the request
        rateLimiter.recordRequest(url);

        // Navigate to page with increased timeout
        const timeout = 90000; // 90 seconds for protected sites

        try {
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: timeout
            });
        } catch (navError) {
            // Check for HTTP/2 protocol errors
            if (navError.message.includes('ERR_HTTP2_PROTOCOL_ERROR') ||
                navError.message.includes('ERR_HTTP2_') ||
                navError.message.includes('PROTOCOL_ERROR')) {
                console.warn(`[Playwright] HTTP/2 protocol error detected, will retry with HTTP/1.1`);
                throw navError; // Re-throw to trigger retry with different strategy
            }

            // For timeout or other errors, try with 'load' event
            console.warn(`[Playwright] Navigation failed with domcontentloaded, trying load event...`);
            await page.goto(url, {
                waitUntil: 'load',
                timeout: timeout
            });
        }

        // Wait for initial load
        await page.waitForTimeout(2000);

        // Check for and wait for Cloudflare challenge to complete
        const cloudflareResolved = await this.waitForCloudflareChallenge(page, 30000);
        if (!cloudflareResolved) {
            console.warn('[Playwright] Cloudflare challenge may not have completed');
        }

        // Wait for dynamic content with longer delay for protected sites
        await page.waitForTimeout(2000);

        // Try to wait for network idle briefly
        try {
            await page.waitForLoadState('networkidle', { timeout: 10000 });
        } catch (e) {
            // Network may never be idle on some sites, continue anyway
        }

        // Handle popups/cookie banners using existing logic
        await this.closePopups(page);

        // Wait after closing popups for page to settle
        await page.waitForTimeout(1000);

        // Scroll to trigger lazy loading
        await this.scrollPageToRevealContent(page);

        // Wait for lazy-loaded content
        await page.waitForTimeout(1500);

        // Get content
        const content = await page.content();

        // Check for blocked page first
        const isBlocked = await this.detectErrorPage(page);
        if (isBlocked) {
            throw new Error('Page returned error or blocked response');
        }

        // Validate we got actual content (not a challenge page)
        // Typical websites have at least 10KB of HTML
        if (content.length < 5000) {
            console.warn(`[Playwright] Suspiciously short content (${content.length} chars), likely blocked`);
            throw new Error(`Blocked: Content too short (${content.length} chars)`);
        }

        // Log content length for debugging
        console.log(`[Playwright] Successfully fetched ${content.length} characters from ${url}`);

        return content;

    } catch (error) {
        console.error(`[Playwright] Error fetching content for ${url}:`, error.message);

        // Mark proxy as failed if using one
        if (proxy) {
            proxyManager.markFailed(proxy);
        }

        // Cleanup before retry
        try {
            if (page) await page.close().catch(() => { });
            if (context) await context.close().catch(() => { });
        } catch (e) { }

        // Check if we should retry with a different strategy
        if (retryCount < maxRetries - 1) {
            const shouldRetry =
                error.message.includes('ERR_HTTP2_') ||
                error.message.includes('PROTOCOL_ERROR') ||
                error.message.includes('timeout') ||
                error.message.includes('Navigation failed') ||
                error.message.includes('net::ERR_') ||
                error.message.includes('blocked') ||
                error.message.includes('Cloudflare') ||
                error.message.includes('challenge');

            if (shouldRetry) {
                console.log(`[Playwright] Retrying with different strategy (${retryCount + 2}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3s before retry for rate limiting

                // Close browser to apply new strategy
                await this.close();

                return this.fetchPageContent(url, retryCount + 1);
            }
        }

        throw error;
    } finally {
        // Cleanup
        try {
            if (page) await page.close().catch(() => { });
        } catch (e) { }
        try {
            if (context) await context.close().catch(() => { });
        } catch (e) { }
    }
}
}

module.exports = ScreenshotService;
