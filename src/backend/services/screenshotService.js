const { chromium } = require('playwright');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const CookieConsentHandler = require('./cookieConsentHandler');
const PuppeteerFallback = require('./puppeteerFallback');
const SeleniumFallback = require('./seleniumFallback');

class ScreenshotService {
    constructor() {
        this.browserContext = null;
        this.minWidth = 800;
        this.minHeight = 600;
        this.defaultWidth = parseInt(process.env.SCREENSHOT_WIDTH) || 1440;
        this.defaultHeight = parseInt(process.env.SCREENSHOT_HEIGHT) || 900;
        // Use unique directory per instance to avoid singleton lock conflicts
        this.userDataDir = process.env.PLAYWRIGHT_USER_DATA_DIR || `/tmp/playwright-user-data-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        // CloudFlare bypass configuration
        this.cloudflareExtensionEnabled = process.env.CLOUDFLARE_EXTENSION_ENABLED !== 'false';
        this.cloudflareBypassTimeout = parseInt(process.env.CLOUDFLARE_BYPASS_TIMEOUT) || 180000; // 3 minutes default
        // Store HTML evidence paths for linking with screenshots
        this.htmlEvidenceCache = new Map(); // url -> { filePath, timestamp }

        // Initialize cookie consent handler (Layers 1-4)
        this.consentHandler = new CookieConsentHandler();

        // Initialize fallback engines (Layer 5)
        this.puppeteerFallback = new PuppeteerFallback();
        this.seleniumFallback = new SeleniumFallback();

        // Enable/disable fallbacks via environment variables
        this.enablePuppeteerFallback = process.env.ENABLE_PUPPETEER_FALLBACK !== 'false';
        this.enableSeleniumFallback = process.env.ENABLE_SELENIUM_FALLBACK !== 'false';

        // Domain-specific rate limiting state
        this.domainLastRequestTime = new Map();
    }

    // Normalize text for robust matching
    normalizeText(text) {
        if (!text) return '';
        return text.toLowerCase()
            .replace(/[^\w\s]/g, '') // Remove punctuation
            .replace(/\s+/g, ' ')    // Collapse multiple spaces
            .trim();
    }

    // Detect if a domain is high-risk (insurance/healthcare)
    isHighRiskDomain(url) {
        try {
            const domain = new URL(url).hostname.toLowerCase();
            const highRiskPatterns = [
                'aetna', 'uhc', 'unitedhealthcare', 'cigna', 'geico',
                'statefarm', 'humana', 'bcbs', 'bluecross', 'progressive',
                'metlife', 'prudential', 'allstate', 'libertymutual', 'nationwide'
            ];
            return highRiskPatterns.some(pattern => domain.includes(pattern));
        } catch (e) {
            return false;
        }
    }

    // Apply stealth techniques to avoid bot detection
    async applyStealth(page) {
        await page.addInitScript(() => {
            // Override navigator.webdriver
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
            });

            // Mock chrome object
            window.chrome = {
                runtime: {},
                loadTimes: function () { },
                csi: function () { },
                app: {}
            };

            // Mock plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5],
            });

            // Mock permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );

            // Mock hardwareConcurrency
            Object.defineProperty(navigator, 'hardwareConcurrency', {
                get: () => 8,
            });

            // Mock platform
            Object.defineProperty(navigator, 'platform', {
                get: () => 'MacIntel',
            });
        });
    }

    // Block analytics and tracking to speed up load and reduce detection
    async blockAnalytics(page) {
        await page.route('**/*', (route) => {
            const url = route.request().url().toLowerCase();
            const analyticsDomains = [
                'google-analytics.com',
                'googletagmanager.com',
                'facebook.com/tr',
                'doubleclick.net',
                'hotjar.com',
                'mouseflow.com',
                'crazyegg.com',
                'optimizely.com',
                'segment.io',
                'intercom.io'
            ];

            const isAnalytics = analyticsDomains.some(domain => url.includes(domain));
            if (isAnalytics) {
                route.abort();
            } else {
                route.continue();
            }
        });
    }

    // Aggressive cookie consent neutralization
    async neutralizeCookieConsent(page) {
        try {
            console.log('[Screenshot] Neutralizing cookie consent...');

            // 1. Inject CSS to hide common consent elements
            await page.addStyleTag({
                content: `
                    .cookie-consent, .gdpr-banner, .privacy-notice, 
                    #onetrust-consent-sdk, .optanon-alert-box-wrapper,
                    [class*="cookie" i], [id*="cookie" i],
                    [class*="consent" i], [id*="consent" i],
                    [id*="CybotCookiebotDialog"], #cookiescript_injected,
                    .cc-window, .qc-cmp2-container {
                        display: none !important;
                        visibility: hidden !important;
                        opacity: 0 !important;
                        pointer-events: none !important;
                    }
                    body, html {
                        overflow: auto !important;
                        position: static !important;
                    }
                `
            });

            // 2. Find and click "Accept" buttons
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
                const acceptPatterns = [/accept/i, /agree/i, /allow/i, /continue/i, /ok/i, /got it/i];

                for (const btn of buttons) {
                    const text = btn.innerText || btn.textContent || '';
                    if (acceptPatterns.some(pattern => pattern.test(text))) {
                        // Check if visible
                        const rect = btn.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0 && window.getComputedStyle(btn).display !== 'none') {
                            btn.click();
                            console.log('Clicked consent button:', text);
                        }
                    }
                }

                // 3. Remove visible consent elements
                const selectors = [
                    '.cookie-consent', '.gdpr-banner', '.privacy-notice',
                    '#onetrust-consent-sdk', '.optanon-alert-box-wrapper',
                    '[class*="cookie" i]', '[id*="cookie" i]',
                    '[class*="consent" i]', '[id*="consent" i]'
                ];

                selectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach(el => {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            el.remove();
                        }
                    });
                });
            });

            await page.waitForTimeout(1000);
            console.log('[Screenshot] Cookie consent removed');
        } catch (error) {
            console.warn('[Screenshot] Error neutralizing cookie consent:', error.message);
        }
    }

    // Initialize browser with persistent context (following the provided code snippet pattern)
    async init() {
        try {
            // Check if browser context exists and is connected
            if (this.browserContext) {
                try {
                    // Try to get pages to check if context is still alive
                    const pages = this.browserContext.pages();
                    // Context is alive, no need to recreate
                    return;
                } catch (e) {
                    // Context is dead, need to recreate
                    console.warn('Browser context connection lost, recreating...');
                    this.browserContext = null;
                    // Generate new unique directory to avoid lock conflicts
                    this.userDataDir = `/tmp/playwright-user-data-${Date.now()}-${Math.random().toString(36).substring(7)}`;
                }
            }

            // Get absolute path to chrome extension directory (screenshot stabilizer only)
            const pathToExtension = path.resolve(__dirname, '../../../extensions/chrome-extension');

            // Verify extension directory exists
            if (!fs.existsSync(pathToExtension)) {
                console.warn(`Chrome extension directory not found at ${pathToExtension}, will use direct script injection instead`);
            }

            // Build extension loading arguments (only stabilizer extension for 1st attempt)
            const extensionArgs = [];

            if (fs.existsSync(pathToExtension)) {
                extensionArgs.push(
                    `--disable-extensions-except=${pathToExtension}`,
                    `--load-extension=${pathToExtension}`
                );
            }

            // Clean up user data directory completely to avoid singleton lock conflicts
            // This ensures a fresh start each time
            if (fs.existsSync(this.userDataDir)) {
                try {
                    // Remove all files and subdirectories recursively
                    fs.rmSync(this.userDataDir, { recursive: true, force: true });
                    console.log('Cleaned up existing user data directory');
                } catch (cleanupError) {
                    console.warn('Could not clean up user data directory, using new unique directory:', cleanupError.message);
                    // Use a new unique directory if cleanup fails
                    this.userDataDir = `/tmp/playwright-user-data-${Date.now()}-${Math.random().toString(36).substring(7)}`;
                }
            }

            // Ensure user data directory exists (fresh and clean)
            if (!fs.existsSync(this.userDataDir)) {
                fs.mkdirSync(this.userDataDir, { recursive: true });
            }

            // Launch persistent context with Chrome extension loaded (strictly following snippet)
            this.browserContext = await chromium.launchPersistentContext(this.userDataDir, {
                channel: 'chromium',
                headless: true,
                viewport: { width: this.defaultWidth, height: this.defaultHeight },
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    ...extensionArgs, // Include extension loading args
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-features=TranslateUI',
                    '--disable-ipc-flooding-protection',
                ],
                timeout: 30000
            });

            // Wait for service worker exactly as shown in the snippet
            let [serviceWorker] = this.browserContext.serviceWorkers();
            if (!serviceWorker) {
                try {
                    serviceWorker = await this.browserContext.waitForEvent('serviceworker', { timeout: 10000 });
                } catch (swTimeoutError) {
                    // Service worker may not load in headless mode or extension may not have one
                    console.warn('Service worker did not initialize within timeout, continuing anyway');
                }
            }

            if (serviceWorker) {
                const serviceWorkers = this.browserContext.serviceWorkers();
                console.log(`Service worker initialized. Active service workers: ${serviceWorkers.length}`);
            }

            // LAYER 2: Inject consent state into browser context
            // This runs BEFORE any page is created, ensuring consent is set from the start
            await this.consentHandler.injectConsentState(this.browserContext);

        } catch (error) {
            console.error('Failed to initialize browser context:', error);
            // Reset context to null so next attempt will try again
            this.browserContext = null;
            throw error;
        }
    }

    // Close browser context
    async close() {
        if (this.browserContext) {
            await this.browserContext.close();
            this.browserContext = null;

            // Clean up user data directory after closing
            if (this.userDataDir && fs.existsSync(this.userDataDir)) {
                try {
                    fs.rmSync(this.userDataDir, { recursive: true, force: true });
                    console.log('Cleaned up user data directory after close');
                } catch (cleanupError) {
                    console.warn('Could not clean up user data directory:', cleanupError.message);
                }
            }
        }
    }

    // Detect if the page is showing a Cloudflare challenge
    async detectCloudflareChallenge(page) {
        try {
            const isCloudflare = await page.evaluate(() => {
                const bodyText = (document.body?.innerText || document.body?.textContent || '').toLowerCase();
                const title = (document.title || '').toLowerCase();
                const html = document.documentElement.innerHTML.toLowerCase();

                // Cloudflare challenge indicators
                const cloudflarePatterns = [
                    'checking your browser',
                    'just a moment',
                    'please wait',
                    'cf-browser-verification',
                    'cf-wrapper',
                    'cloudflare'
                ];

                // Check for Cloudflare-specific text
                for (const pattern of cloudflarePatterns) {
                    if (bodyText.includes(pattern) || title.includes(pattern) || html.includes(pattern)) {
                        // Check for Cloudflare-specific DOM elements
                        const cfWrapper = document.getElementById('cf-wrapper') ||
                            document.querySelector('.cf-wrapper') ||
                            document.querySelector('[class*="cf-"]') ||
                            document.querySelector('[id*="cf-"]');

                        if (cfWrapper) {
                            return true;
                        }
                    }
                }

                // Check for Cloudflare ray ID in response (if available via meta tags or comments)
                const cfRayMatch = html.match(/cf-ray[:\s]+([a-z0-9-]+)/i);
                if (cfRayMatch) {
                    return true;
                }

                return false;
            });

            return isCloudflare;
        } catch (error) {
            // If detection fails, assume it's not a Cloudflare challenge
            return false;
        }
    }

    // Detect if the page is an error/blocked page
    async detectErrorPage(page) {
        try {
            // First check if it's a Cloudflare challenge (more specific)
            const isCloudflare = await this.detectCloudflareChallenge(page);
            if (isCloudflare) {
                return true; // Cloudflare challenge is considered an error/blocked state
            }

            const errorIndicators = await page.evaluate(() => {
                const bodyText = (document.body.innerText || document.body.textContent || '').toLowerCase();
                const title = (document.title || '').toLowerCase();
                const url = window.location.href.toLowerCase();

                // Common error page indicators (excluding Cloudflare-specific ones)
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
                    'reference #', // Generic error pages
                    'errors.edgesuite.net', // Akamai error pages
                    'this site can\'t be reached',
                    'err_',
                ];

                // Check title, body text, and URL for error indicators
                for (const pattern of errorPatterns) {
                    if (title.includes(pattern) || bodyText.includes(pattern) || url.includes(pattern)) {
                        return true;
                    }
                }

                // Check for very short content (error pages are often minimal)
                const textLength = bodyText.trim().length;
                if (textLength < 200 && (title.includes('error') || title.includes('denied') || title.includes('forbidden'))) {
                    return true;
                }

                return false;
            });

            return errorIndicators;
        } catch (error) {
            // If detection fails, assume it's not an error page (better to try than to skip)
            return false;
        }
    }

    // Scroll page to reveal content that might be below the fold
    async scrollPageToRevealContent(page) {
        try {
            // Get page dimensions
            const dimensions = await page.evaluate(() => {
                return {
                    scrollHeight: document.documentElement.scrollHeight,
                    scrollWidth: document.documentElement.scrollWidth,
                    clientHeight: window.innerHeight,
                    clientWidth: window.innerWidth
                };
            });

            // Scroll down in increments to reveal content
            const scrollIncrement = dimensions.clientHeight * 0.8; // Scroll 80% of viewport height
            const maxScrolls = Math.ceil(dimensions.scrollHeight / scrollIncrement);

            for (let i = 0; i < Math.min(maxScrolls, 5); i++) { // Limit to 5 scrolls
                await page.evaluate((scrollY) => {
                    window.scrollTo(0, scrollY);
                }, i * scrollIncrement);
                await page.waitForTimeout(300); // Wait for content to load
            }

            // Scroll back to top
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForTimeout(300);
        } catch (error) {
            console.warn('Error scrolling page:', error.message);
        }
    }

    // Close popups, modals, cookie banners, etc.
    async closePopups(page) {
        try {
            // Common selectors for popups, modals, and cookie banners
            const popupSelectors = [
                // Cookie consent banners
                '[id*="cookie"]',
                '[class*="cookie"]',
                '[id*="Cookie"]',
                '[class*="Cookie"]',
                '[id*="consent"]',
                '[class*="consent"]',
                '[id*="gdpr"]',
                '[class*="gdpr"]',
                '[id*="privacy"]',
                '[class*="privacy"]',
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
                // Accept/Close buttons in cookie banners
                'button:has-text("Accept")',
                'button:has-text("Accept All")',
                'button:has-text("Accept All Cookies")',
                'button:has-text("I Accept")',
                'button:has-text("Got it")',
                'button:has-text("OK")',
                'button:has-text("Close")',
                'button:has-text("×")',
                'button:has-text("✕")',
                // Overlay close buttons
                '[class*="overlay"] [class*="close"]',
                '[class*="banner"] [class*="close"]',
                // Common modal/popup containers
                '[class*="modal"] [class*="close"]',
                '[class*="popup"] [class*="close"]',
                '[class*="dialog"] [class*="close"]',
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
        if (!text) return null;

        const normalizedSearch = this.normalizeText(text);
        if (!normalizedSearch) return null;

        console.log(`[Screenshot] Searching for text: "${text.substring(0, 50)}..."`);

        // Helper for fuzzy matching within evaluate
        const fuzzyMatchLogic = `
            const normalize = (t) => (t || '').toLowerCase().replace(/[^\\w\\s]/g, '').replace(/\\s+/g, ' ').trim();
            
            const getLevenshteinDistance = (a, b) => {
                const matrix = [];
                for (let i = 0; i <= b.length; i++) matrix[i] = [i];
                for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
                for (let i = 1; i <= b.length; i++) {
                    for (let j = 1; j <= a.length; j++) {
                        if (b.charAt(i - 1) === a.charAt(j - 1)) {
                            matrix[i][j] = matrix[i - 1][j - 1];
                        } else {
                            matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
                        }
                    }
                }
                return matrix[b.length][a.length];
            };

            const isFuzzyMatch = (pageText, searchText, threshold = 0.8) => {
                const normPage = normalize(pageText);
                const normSearch = normalize(searchText);
                
                if (normPage.includes(normSearch)) return true;
                
                const searchWords = normSearch.split(' ').filter(w => w.length > 3);
                if (searchWords.length === 0) return false;
                
                let matches = 0;
                for (const word of searchWords) {
                    if (normPage.includes(word)) matches++;
                }
                
                if (matches / searchWords.length >= threshold) return true;
                
                const distance = getLevenshteinDistance(normPage, normSearch);
                if (distance <= normSearch.length * 0.2) return true;
                
                return false;
            };

            const findInTree = (root) => {
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
                let node;
                let bestMatch = null;
                let smallestArea = Infinity;

                while (node = walker.nextNode()) {
                    // Skip hidden elements
                    const style = window.getComputedStyle(node);
                    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

                    const text = node.innerText || node.textContent || '';
                    if (isFuzzyMatch(text, targetText)) {
                        const rect = node.getBoundingClientRect();
                        const area = rect.width * rect.height;
                        if (area > 0 && area < smallestArea) {
                            smallestArea = area;
                            bestMatch = node;
                        }
                    }

                    // Check Shadow DOM
                    if (node.shadowRoot) {
                        const shadowMatch = findInTree(node.shadowRoot);
                        if (shadowMatch) {
                            const rect = shadowMatch.getBoundingClientRect();
                            const area = rect.width * rect.height;
                            if (area > 0 && area < smallestArea) {
                                smallestArea = area;
                                bestMatch = shadowMatch;
                            }
                        }
                    }
                }
                return bestMatch;
            };
        `;

        // Strategy 1: Main document search (including Shadow DOM)
        try {
            const handle = await page.evaluateHandle(`({ targetText }) => {
                ${fuzzyMatchLogic}
                return findInTree(document.body);
            }`, { targetText: text });

            if (handle && handle.asElement()) {
                console.log('[Screenshot] Text found in main document');
                return handle.asElement();
            }
        } catch (error) {
            console.warn('[Screenshot] Main document search failed:', error.message);
        }

        // Strategy 2: Iframe search
        try {
            const frames = page.frames();
            for (const frame of frames) {
                if (frame === page.mainFrame()) continue;
                try {
                    const handle = await frame.evaluateHandle(`({ targetText }) => {
                        ${fuzzyMatchLogic}
                        return findInTree(document.body);
                    }`, { targetText: text });

                    if (handle && handle.asElement()) {
                        console.log('[Screenshot] Text found in iframe');
                        return handle.asElement();
                    }
                } catch (e) {
                    // Continue to next frame
                }
            }
        } catch (error) {
            console.warn('[Screenshot] Iframe search failed:', error.message);
        }

        // Strategy 3: Playwright built-in as last resort
        try {
            const element = page.getByText(text, { exact: false });
            if (await element.count() > 0) {
                console.log('[Screenshot] Text found via Playwright getByText');
                return element.first();
            }
        } catch (error) {
            // Ignore
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
            const contentScriptPath = path.resolve(__dirname, '../../../extensions/chrome-extension', 'content.js');

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

    // Wait for CloudFlare bypass extension to complete and send HTML
    async waitForCloudflareBypass(page, url, timeout = null) {
        const maxWaitTime = timeout || this.cloudflareBypassTimeout;
        const startTime = Date.now();
        const checkInterval = 1000; // Check every second

        console.log(`[CloudFlare Bypass] Waiting for extension to solve challenge for ${url}...`);

        while (Date.now() - startTime < maxWaitTime) {
            try {
                // Check if extension has completed bypass
                const bypassStatus = await page.evaluate(() => {
                    return {
                        isComplete: window.cloudflareBypassComplete === true,
                        result: window.cloudflareBypassResult || null,
                        status: window.cloudflareBypassStatus ? {
                            isComplete: window.cloudflareBypassStatus.isComplete(),
                            getResult: window.cloudflareBypassStatus.getResult()
                        } : null
                    };
                });

                if (bypassStatus.isComplete || (bypassStatus.status && bypassStatus.status.isComplete())) {
                    const result = bypassStatus.result || (bypassStatus.status ? bypassStatus.status.getResult() : null);
                    console.log(`[CloudFlare Bypass] Challenge solved, HTML sent to backend`);

                    // Store HTML evidence path in cache for later linking
                    if (result && result.relativePath) {
                        this.htmlEvidenceCache.set(url, {
                            filePath: result.relativePath,
                            timestamp: new Date().toISOString()
                        });
                    }

                    return result;
                }

                // Check if challenge is still present
                const isStillChallenge = await this.detectCloudflareChallenge(page);
                if (!isStillChallenge) {
                    // Challenge appears to be solved, but extension hasn't sent HTML yet
                    // Wait a bit more for extension to send
                    await page.waitForTimeout(2000);
                    const finalCheck = await page.evaluate(() => {
                        return window.cloudflareBypassComplete === true;
                    });

                    if (finalCheck) {
                        const result = await page.evaluate(() => window.cloudflareBypassResult || null);
                        if (result && result.relativePath) {
                            this.htmlEvidenceCache.set(url, {
                                filePath: result.relativePath,
                                timestamp: new Date().toISOString()
                            });
                        }
                        return result;
                    }
                }

                await page.waitForTimeout(checkInterval);
            } catch (error) {
                console.warn(`[CloudFlare Bypass] Error checking bypass status: ${error.message}`);
                await page.waitForTimeout(checkInterval);
            }
        }

        console.warn(`[CloudFlare Bypass] Timeout waiting for bypass completion (${maxWaitTime}ms)`);
        return null;
    }

    // Capture screenshot with CloudFlare bypass
    async captureWithCloudflareBypass(url, messageText, messageId, retries = 2) {
        let page = null;
        let htmlEvidencePath = null;

        try {
            // Initialize browser context with retry
            for (let i = 0; i < 3; i++) {
                try {
                    await this.init();
                    break;
                } catch (initError) {
                    if (i === 2) throw initError;
                    console.warn(`Browser context init failed, retrying... (${i + 1}/3)`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    this.browserContext = null;
                }
            }

            // Create page
            page = await this.browserContext.newPage({
                timeout: 30000
            });

            // Inject stabilizer script before navigation
            await this.injectStabilizerScript(page);

            // Navigate to URL - extension will handle Cloudflare challenge
            console.log(`[CloudFlare Bypass] Navigating to ${url} with bypass extension...`);
            try {
                await page.goto(url, {
                    waitUntil: 'load',
                    timeout: 60000
                });
            } catch (timeoutError) {
                console.warn(`[CloudFlare Bypass] Load timeout for ${url}, trying domcontentloaded...`);
                await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: 60000
                });
            }

            // Wait for CloudFlare extension to solve challenge and send HTML
            const bypassResult = await this.waitForCloudflareBypass(page, url);
            if (bypassResult && bypassResult.relativePath) {
                htmlEvidencePath = bypassResult.relativePath;
                console.log(`[CloudFlare Bypass] HTML evidence saved: ${htmlEvidencePath}`);
            } else {
                console.warn(`[CloudFlare Bypass] HTML evidence not received, continuing with screenshot anyway`);
            }

            // Wait for extension/script to be ready and stabilize the page
            await this.waitForExtensionReady(page);

            // Wait a bit for any animations and dynamic content
            await page.waitForTimeout(2000);

            // Check if page is still an error/blocked page (should be solved by now)
            const isErrorPage = await this.detectErrorPage(page);
            if (isErrorPage) {
                const isCloudflare = await this.detectCloudflareChallenge(page);
                if (isCloudflare) {
                    throw new Error(`Cloudflare challenge was not solved within timeout. Page may still be blocked.`);
                }

                const errorDetails = await page.evaluate(() => {
                    const bodyText = document.body.innerText || document.body.textContent || '';
                    const title = document.title || '';
                    return { bodyText: bodyText.substring(0, 200), title };
                }).catch(() => ({ bodyText: '', title: '' }));

                throw new Error(`Page is blocked or inaccessible. Error: ${errorDetails.title || 'Access Denied'}. ${errorDetails.bodyText.substring(0, 100)}`);
            }

            // Close any popups, modals, or cookie banners
            await this.closePopups(page);

            // Scroll page to reveal content
            await this.scrollPageToRevealContent(page);

            // Wait for dynamic content to load after scrolling
            await page.waitForTimeout(1500);

            // Wait for network to be idle
            try {
                await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });
            } catch (e) {
                // Ignore timeout
            }

            // Find element containing the message (using the new robust logic)
            let element = await this.findElementWithText(page, messageText);

            // If not found, try scrolling and searching again
            if (!element) {
                console.log('[CloudFlare Bypass] Text not found on initial search, trying with page scroll...');
                await this.scrollPageToRevealContent(page);
                await page.waitForTimeout(2000);
                element = await this.findElementWithText(page, messageText);
            }

            // If still not found, try clicking "show more"
            if (!element) {
                await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button, a'));
                    const showMorePatterns = [/show more/i, /read more/i, /view more/i, /expand/i];
                    for (const btn of buttons) {
                        if (showMorePatterns.some(p => p.test(btn.innerText || btn.textContent))) {
                            btn.click();
                        }
                    }
                });
                await page.waitForTimeout(2000);
                element = await this.findElementWithText(page, messageText);
            }

            // Fallback to main content
            if (!element) {
                console.log('[CloudFlare Bypass] Using fallback: capturing main content area');
                element = await page.evaluateHandle(() => {
                    return document.querySelector('main, article, [role="main"], .content, #content') || document.body;
                });
            }

            if (!element) {
                throw new Error(`Could not find text "${messageText}" on page even after bypass`);
            }

            // Scroll element into view
            try {
                const isVisible = await element.isVisible().catch(() => false);
                if (!isVisible) {
                    const box = await element.boundingBox().catch(() => null);
                    if (box) {
                        await page.evaluate(({ x, y }) => {
                            window.scrollTo(x, y - 100);
                        }, box);
                        await page.waitForTimeout(500);
                    } else {
                        await element.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => { });
                        await page.waitForTimeout(500);
                    }
                } else {
                    await element.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => { });
                    await page.waitForTimeout(500);
                }
            } catch (scrollError) {
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

            // Highlight the element
            await this.highlightElement(element);

            // Get viewport dimensions
            const viewport = page.viewportSize();

            // Capture screenshot
            const screenshotBuffer = await page.screenshot({
                type: 'png',
                fullPage: false
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
                capturedAt: new Date().toISOString(),
                htmlEvidencePath: htmlEvidencePath, // Include HTML evidence path
                cloudflareBypass: true
            };

            return {
                id: screenshotId,
                buffer: screenshotBuffer,
                metadata: metadata,
                htmlEvidencePath: htmlEvidencePath
            };

        } catch (error) {
            console.error(`[CloudFlare Bypass] Error capturing screenshot for "${messageText}" at ${url}:`, error.message);

            // If browser context crashed, reset and retry
            if ((error.message.includes('Target page, context or browser has been closed') ||
                error.message.includes('browser has been closed') ||
                error.message.includes('Browser closed') ||
                error.message.includes('Context closed')) && retries > 0) {
                console.warn('Browser context crashed, resetting and retrying...');
                this.browserContext = null;
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.captureWithCloudflareBypass(url, messageText, messageId, retries - 1);
            }

            return null;
        } finally {
            try {
                if (page) await page.close().catch(() => { });
            } catch (e) {
                console.warn('Error closing page:', e.message);
            }
        }
    }

    // Capture screenshot for a single message on a page
    async captureMessage(url, messageText, messageId, retries = 5) {
        console.log(`[Screenshot] Starting capture for: "${messageText.substring(0, 50)}..."`);
        let page = null;
        const isInsurance = this.isHighRiskDomain(url);
        const domain = new URL(url).hostname;

        // Rate limiting: 3-5s for normal, 10s for insurance
        const lastRequest = this.domainLastRequestTime.get(domain) || 0;
        const minDelay = isInsurance ? 10000 : (3000 + Math.random() * 2000);
        const timeSinceLast = Date.now() - lastRequest;
        if (timeSinceLast < minDelay) {
            const wait = minDelay - timeSinceLast;
            console.log(`[Screenshot] Rate limiting: waiting ${Math.round(wait)}ms for ${domain}`);
            await new Promise(resolve => setTimeout(resolve, wait));
        }
        this.domainLastRequestTime.set(domain, Date.now());

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                console.log(`[Screenshot] Attempt ${attempt}/${retries} for ${url}`);

                // Initialize browser context
                await this.init();

                // Randomize viewport
                const width = Math.floor(Math.random() * (1920 - 1366 + 1)) + 1366;
                const height = Math.floor(Math.random() * (1080 - 768 + 1)) + 768;

                page = await this.browserContext.newPage({
                    viewport: { width, height },
                    timeout: isInsurance ? 120000 : 60000
                });

                // Apply stealth and block analytics
                await this.applyStealth(page);
                await this.blockAnalytics(page);
                await this.injectStabilizerScript(page);

                // Navigation with increased timeout
                const navTimeout = isInsurance ? 120000 : 60000;
                console.log(`[Screenshot] Navigating to ${url}...`);

                try {
                    await page.goto(url, {
                        waitUntil: 'networkidle',
                        timeout: navTimeout
                    });
                } catch (e) {
                    console.warn(`[Screenshot] networkidle failed, trying load...`);
                    await page.goto(url, { waitUntil: 'load', timeout: navTimeout }).catch(() => { });
                }

                console.log(`[Screenshot] Page loaded: ${url}`);

                // Intelligent waiting
                const initialWait = isInsurance ? 15000 : 5000;

                // Random mouse movements during wait
                for (let i = 0; i < 5; i++) {
                    await page.mouse.move(Math.random() * width, Math.random() * height);
                    await page.waitForTimeout(initialWait / 5);
                }

                await page.waitForLoadState('domcontentloaded').catch(() => { });
                await page.waitForLoadState('load').catch(() => { });

                // Check for substantial content
                await page.waitForFunction(() => {
                    return document.readyState === 'complete' && document.body.innerText.length > 1000;
                }, { timeout: 10000 }).catch(() => { });

                // Neutralize cookie consent
                await this.neutralizeCookieConsent(page);

                // Scroll to trigger lazy loading
                const scrollPositions = [0, 0.25, 0.5, 0.75, 1.0];
                const scrollPos = scrollPositions[(attempt - 1) % scrollPositions.length];
                await page.evaluate((pos) => {
                    window.scrollTo(0, document.body.scrollHeight * pos);
                }, scrollPos);
                await page.waitForTimeout(2000);

                // Find element
                let element = await this.findElementWithText(page, messageText);

                if (!element) {
                    // Try clicking "show more" buttons
                    await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button, a'));
                        const showMorePatterns = [/show more/i, /read more/i, /view more/i, /expand/i];
                        for (const btn of buttons) {
                            if (showMorePatterns.some(p => p.test(btn.innerText || btn.textContent))) {
                                btn.click();
                            }
                        }
                    });
                    await page.waitForTimeout(2000);
                    element = await this.findElementWithText(page, messageText);
                }

                if (!element && attempt === retries) {
                    console.log('[Screenshot] Using fallback: capturing main content area');
                    element = await page.evaluateHandle(() => {
                        return document.querySelector('main, article, [role="main"], .content, #content') || document.body;
                    });
                }

                if (element) {
                    const elementHandle = element.asElement ? element.asElement() : element;

                    // Scroll into view
                    await elementHandle.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => { });
                    await page.waitForTimeout(2000);

                    // Highlight with box-shadow
                    await page.evaluate((el) => {
                        el.style.boxShadow = '0 0 0 3px rgba(255, 0, 0, 0.6)';
                        el.style.outline = 'none';
                    }, elementHandle);
                    await page.waitForTimeout(500);

                    // Capture
                    const screenshotBuffer = await page.screenshot({
                        type: 'png',
                        fullPage: false
                    });

                    // Quality check
                    if (screenshotBuffer.length < 5000) {
                        throw new Error('Screenshot too small, likely blank');
                    }

                    console.log('[Screenshot] Captured successfully');

                    const screenshotId = uuidv4();
                    return {
                        id: screenshotId,
                        buffer: screenshotBuffer,
                        metadata: {
                            id: screenshotId,
                            messageId,
                            messageText,
                            url,
                            capturedAt: new Date().toISOString(),
                            attempt,
                            isInsurance,
                            isFallback: !await this.findElementWithText(page, messageText) // Re-check if it was a fallback
                        }
                    };
                }

                throw new Error('Text not found and fallback failed');

            } catch (error) {
                console.error(`[Screenshot] Attempt ${attempt} failed: ${error.message}`);

                if (attempt < retries) {
                    const delay = Math.pow(2, attempt) * 1000;
                    console.log(`[Screenshot] Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error(`[Screenshot] Failed to find text after all attempts`);
                    return null;
                }
            } finally {
                if (page) await page.close().catch(() => { });
            }
        }

        return null;
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
}

module.exports = ScreenshotService;
