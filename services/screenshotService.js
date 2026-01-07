const { chromium } = require('playwright');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

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
            const pathToExtension = path.resolve(__dirname, '..', 'chrome-extension');
            
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
                                await element.click({ timeout: 1000 }).catch(() => {});
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
                            await firstButton.click({ timeout: 1000 }).catch(() => {});
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
            const contentScriptPath = path.resolve(__dirname, '..', 'chrome-extension', 'content.js');
            
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
                await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            } catch (e) {
                // Ignore timeout
            }

            // Find element containing the message (same logic as standard capture)
            let element = await this.findElementWithText(page, messageText);
            
            // If not found, try scrolling and searching again
            if (!element) {
                console.log('Text not found on initial search, trying with page scroll...');
                await this.scrollPageToRevealContent(page);
                await page.waitForTimeout(2000);
                await page.evaluate(() => {
                    window.dispatchEvent(new Event('scroll'));
                });
                await page.waitForTimeout(1000);
                element = await this.findElementWithText(page, messageText);
            }
            
            // If still not found, try partial matches
            if (!element) {
                console.log('Full text not found, trying partial matches...');
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
            
            // If still not found, try key phrases
            if (!element) {
                console.log('Trying to find key phrases from the text...');
                const words = messageText.split(/\s+/).filter(w => w.length >= 4);
                if (words.length > 0) {
                    element = await this.findElementWithText(page, words[0]);
                    if (!element && words.length > 1) {
                        const phrase = words.slice(0, Math.min(3, words.length)).join(' ');
                        element = await this.findElementWithText(page, phrase);
                    }
                }
            }

            // Last resort: try to find main content area
            if (!element) {
                const isErrorPage = await this.detectErrorPage(page);
                if (isErrorPage) {
                    throw new Error(`Page appears to be blocked or inaccessible. Cannot capture screenshot.`);
                }
                
                try {
                    const fallbackElement = await page.evaluateHandle(() => {
                        const mainContent = document.querySelector('main, article, [role="main"]') || 
                                          document.querySelector('.content, .main-content, #content, #main');
                        if (mainContent) {
                            return mainContent;
                        }
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
                        await element.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
                        await page.waitForTimeout(500);
                    }
                } else {
                    await element.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
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
                if (page) await page.close().catch(() => {});
            } catch (e) {
                console.warn('Error closing page:', e.message);
            }
        }
    }

    // Capture screenshot for a single message on a page
    async captureMessage(url, messageText, messageId, retries = 2) {
        let page = null;

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
                    this.browserContext = null; // Force recreation
                }
            }

            // Create page directly from persistent context
            // Persistent context already has viewport and user agent configured
            page = await this.browserContext.newPage({
                timeout: 30000
            });

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

            // Wait a bit for any animations and dynamic content
            await page.waitForTimeout(2000);

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
                await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
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
                        await element.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
                        await page.waitForTimeout(500);
                    }
                } else {
                    // Element is visible, just ensure it's in view
                    await element.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
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
            
            // Check if HTML evidence exists for this URL (from CloudFlare bypass cache)
            const htmlEvidence = this.htmlEvidenceCache.get(url);
            
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
                htmlEvidencePath: htmlEvidence ? htmlEvidence.filePath : null
            };

            return {
                id: screenshotId,
                buffer: screenshotBuffer,
                metadata: metadata,
                htmlEvidencePath: htmlEvidence ? htmlEvidence.filePath : null
            };

        } catch (error) {
            console.error(`Error capturing screenshot for "${messageText}" at ${url}:`, error.message);
            
            // If browser context crashed, reset it and retry once
            if ((error.message.includes('Target page, context or browser has been closed') ||
                 error.message.includes('browser has been closed') ||
                 error.message.includes('Browser closed') ||
                 error.message.includes('Context closed')) && retries > 0) {
                console.warn('Browser context crashed, resetting and retrying...');
                this.browserContext = null; // Force context recreation
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait before retry
                return this.captureMessage(url, messageText, messageId, retries - 1);
            }
            
            // If text not found, return null instead of throwing (allows graceful handling)
            if (error.message.includes('Could not find text')) {
                return null;
            }
            
            return null;
        } finally {
            // Always cleanup page (but keep context alive for reuse)
            try {
                if (page) await page.close().catch(() => {});
            } catch (e) {
                console.warn('Error closing page:', e.message);
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
}

module.exports = ScreenshotService;
