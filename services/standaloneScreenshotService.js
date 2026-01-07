/**
 * Standalone Screenshot Service
 * 
 * Simplified Playwright-based screenshot capture service.
 * This is a 2nd attempt fallback that uses a cleaner, simpler approach
 * without extensions or persistent browser contexts.
 * 
 * Based on the standalone-screenshot.js implementation guide.
 */

const { chromium } = require('playwright');
const { v4: uuidv4 } = require('uuid');

class StandaloneScreenshotService {
    constructor() {
        this.defaultWidth = parseInt(process.env.SCREENSHOT_WIDTH) || 1920;
        this.defaultHeight = parseInt(process.env.SCREENSHOT_HEIGHT) || 1080;
        this.waitTimeAfterLoad = 8000; // milliseconds
        this.pageLoadTimeout = 90000; // milliseconds
    }

    /**
     * Detect if the page is showing a Cloudflare challenge
     * @param {Page} page - Playwright page object
     * @returns {Promise<boolean>}
     */
    async detectCloudflareChallenge(page) {
        try {
            const isCloudflare = await page.evaluate(() => {
                const bodyText = (document.body?.innerText || document.body?.textContent || '').toLowerCase();
                const title = (document.title || '').toLowerCase();
                const html = document.documentElement.innerHTML.toLowerCase();
                
                const cloudflarePatterns = [
                    'checking your browser',
                    'just a moment',
                    'please wait',
                    'cf-browser-verification',
                    'cf-wrapper',
                    'cloudflare'
                ];
                
                for (const pattern of cloudflarePatterns) {
                    if (bodyText.includes(pattern) || title.includes(pattern) || html.includes(pattern)) {
                        const cfWrapper = document.getElementById('cf-wrapper') || 
                                       document.querySelector('.cf-wrapper') ||
                                       document.querySelector('[class*="cf-"]') ||
                                       document.querySelector('[id*="cf-"]');
                        
                        if (cfWrapper) {
                            return true;
                        }
                    }
                }
                
                return false;
            });
            
            return isCloudflare;
        } catch (error) {
            return false;
        }
    }

    /**
     * Detect if the page is an error/blocked page
     * @param {Page} page - Playwright page object
     * @returns {Promise<boolean>}
     */
    async detectErrorPage(page) {
        try {
            const isCloudflare = await this.detectCloudflareChallenge(page);
            if (isCloudflare) {
                return true;
            }

            const errorIndicators = await page.evaluate(() => {
                const bodyText = (document.body.innerText || document.body.textContent || '').toLowerCase();
                const title = (document.title || '').toLowerCase();
                const url = window.location.href.toLowerCase();
                
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
                    'reference #',
                    'errors.edgesuite.net',
                    'this site can\'t be reached',
                    'err_',
                ];
                
                for (const pattern of errorPatterns) {
                    if (title.includes(pattern) || bodyText.includes(pattern) || url.includes(pattern)) {
                        return true;
                    }
                }
                
                const textLength = bodyText.trim().length;
                if (textLength < 200 && (title.includes('error') || title.includes('denied') || title.includes('forbidden'))) {
                    return true;
                }
                
                return false;
            });
            
            return errorIndicators;
        } catch (error) {
            return false;
        }
    }

    /**
     * Simple text search using Playwright's getByText
     * @param {Page} page - Playwright page object
     * @param {string} messageText - Text to search for
     * @returns {Promise<ElementHandle|null>}
     */
    async findElementWithText(page, messageText) {
        const cleanText = messageText.trim();
        
        // Strategy 1: Try exact text match (case-insensitive)
        try {
            const element = page.getByText(cleanText, { exact: false });
            const count = await element.count();
            if (count > 0) {
                return await element.first().elementHandle();
            }
        } catch (error) {
            // Continue to next strategy
        }

        // Strategy 2: Try partial match (first 50 chars)
        if (cleanText.length > 50) {
            try {
                const partialText = cleanText.substring(0, 50).trim();
                const element = page.getByText(partialText, { exact: false });
                const count = await element.count();
                if (count > 0) {
                    return await element.first().elementHandle();
                }
            } catch (error) {
                // Continue
            }
        }

        // Strategy 3: Try key phrases (words of 4+ characters)
        const words = cleanText.split(/\s+/).filter(w => w.length >= 4);
        if (words.length > 0) {
            try {
                // Try first significant word
                const element = page.getByText(words[0], { exact: false });
                const count = await element.count();
                if (count > 0) {
                    return await element.first().elementHandle();
                }
            } catch (error) {
                // Continue
            }

            // Try phrase of first 2-3 words
            if (words.length > 1) {
                try {
                    const phrase = words.slice(0, Math.min(3, words.length)).join(' ');
                    const element = page.getByText(phrase, { exact: false });
                    const count = await element.count();
                    if (count > 0) {
                        return await element.first().elementHandle();
                    }
                } catch (error) {
                    // Continue
                }
            }
        }

        // Strategy 4: Try DOM query as fallback
        try {
            const element = await page.evaluateHandle(({ targetText }) => {
                const normalizedTarget = targetText.toLowerCase().trim();
                const elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, div, a, li, article, section');
                
                for (const el of elements) {
                    const elText = (el.innerText || el.textContent || '').trim().toLowerCase();
                    if (elText.includes(normalizedTarget) || normalizedTarget.includes(elText)) {
                        return el;
                    }
                }
                return null;
            }, { targetText: cleanText });

            if (element && element.asElement()) {
                return element.asElement();
            }
        } catch (error) {
            // Ignore
        }

        return null;
    }

    /**
     * Close popups, modals, cookie banners
     * @param {Page} page - Playwright page object
     */
    async closePopups(page) {
        try {
            // Try pressing Escape key
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);

            // Try to find and click common close buttons
            const closeSelectors = [
                'button[aria-label*="close" i]',
                'button[aria-label*="dismiss" i]',
                'button[aria-label*="accept" i]',
                '.modal-close',
                '.close-modal',
                '.popup-close',
                '[class*="cookie"] button',
                '[id*="cookie"] button'
            ];

            for (const selector of closeSelectors) {
                try {
                    const elements = await page.$$(selector);
                    for (const element of elements) {
                        const isVisible = await element.isVisible().catch(() => false);
                        if (isVisible) {
                            await element.click({ timeout: 1000 }).catch(() => {});
                            await page.waitForTimeout(500);
                        }
                    }
                } catch (e) {
                    // Continue
                }
            }
        } catch (error) {
            // Ignore popup closing errors
        }
    }

    /**
     * Capture screenshot for a single message on a page
     * @param {string} url - URL to capture
     * @param {string} messageText - Text to search for on the page
     * @param {string} messageId - Message ID for metadata
     * @returns {Promise<Object|null>} Screenshot result or null on failure
     */
    async captureMessage(url, messageText, messageId) {
        let browser = null;
        let page = null;

        try {
            console.log(`[Standalone Screenshot] Starting capture for: ${url}`);

            // Launch browser (fresh instance, no persistent context)
            browser = await chromium.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled'
                ]
            });

            // Create browser context
            const context = await browser.newContext({
                viewport: { width: this.defaultWidth, height: this.defaultHeight },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });

            page = await context.newPage();

            console.log('[Standalone Screenshot] Navigating to page...');

            // Navigate to URL
            try {
                await page.goto(url, {
                    waitUntil: 'load',
                    timeout: this.pageLoadTimeout
                });
            } catch (timeoutError) {
                console.warn(`[Standalone Screenshot] Load timeout for ${url}, trying domcontentloaded...`);
                await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: this.pageLoadTimeout
                });
            }

            console.log('[Standalone Screenshot] Page loaded, waiting for content...');

            // Wait for page to be fully interactive
            await page.waitForLoadState('domcontentloaded');

            // Wait additional time for dynamic content
            await page.waitForTimeout(this.waitTimeAfterLoad);

            // Check for Cloudflare challenge
            const isCloudflare = await this.detectCloudflareChallenge(page);
            if (isCloudflare) {
                console.warn(`[Standalone Screenshot] Cloudflare challenge detected for ${url}, cannot bypass (use 1st attempt or Scrappey)`);
                throw new Error('Cloudflare challenge detected - standalone service cannot bypass');
            }

            // Check for error pages
            const isErrorPage = await this.detectErrorPage(page);
            if (isErrorPage) {
                const errorDetails = await page.evaluate(() => {
                    const bodyText = document.body.innerText || document.body.textContent || '';
                    const title = document.title || '';
                    return { bodyText: bodyText.substring(0, 200), title };
                }).catch(() => ({ bodyText: '', title: '' }));
                
                throw new Error(`Page is blocked or inaccessible. Error: ${errorDetails.title || 'Access Denied'}`);
            }

            // Close popups
            await this.closePopups(page);
            await page.waitForTimeout(500);

            // Find element containing the message
            let element = await this.findElementWithText(page, messageText);

            // If not found, try scrolling and searching again
            if (!element) {
                console.log('[Standalone Screenshot] Text not found, trying with scroll...');
                await page.evaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight / 2);
                });
                await page.waitForTimeout(2000);
                element = await this.findElementWithText(page, messageText);
            }

            // If still not found, try partial matches
            if (!element && messageText.length > 30) {
                console.log('[Standalone Screenshot] Trying partial matches...');
                const partialLengths = [50, 40, 30];
                for (const len of partialLengths) {
                    if (messageText.length > len) {
                        const partialText = messageText.substring(0, len).trim();
                        element = await this.findElementWithText(page, partialText);
                        if (element) {
                            console.log(`[Standalone Screenshot] Found partial match (first ${len} chars)`);
                            break;
                        }
                    }
                }
            }

            // Last resort: try to find main content area
            if (!element) {
                console.log('[Standalone Screenshot] Text not found, using fallback: main content area');
                try {
                    const fallbackElement = await page.evaluateHandle(() => {
                        const mainContent = document.querySelector('main, article, [role="main"]') || 
                                          document.querySelector('.content, .main-content, #content, #main');
                        return mainContent || document.body;
                    });

                    if (fallbackElement && fallbackElement.asElement()) {
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
                await element.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
                await page.waitForTimeout(500);
            } catch (scrollError) {
                // Try manual scroll
                try {
                    const box = await element.boundingBox().catch(() => null);
                    if (box) {
                        await page.evaluate(({ x, y }) => {
                            window.scrollTo(x, y - 100);
                        }, box);
                        await page.waitForTimeout(500);
                    }
                } catch (e) {
                    // Ignore
                }
            }

            // Get viewport dimensions
            const viewport = page.viewportSize();

            console.log('[Standalone Screenshot] Capturing screenshot...');

            // Capture screenshot (viewport only, not full page)
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
                source: 'standalone-playwright'
            };

            console.log(`[Standalone Screenshot] ✓ Screenshot captured successfully!`);

            return {
                id: screenshotId,
                buffer: screenshotBuffer,
                metadata: metadata,
                htmlEvidencePath: null // Standalone service doesn't capture HTML evidence
            };

        } catch (error) {
            console.error(`[Standalone Screenshot] Error capturing screenshot for "${messageText}" at ${url}:`, error.message);
            
            // Return null on failure (allows fallback to Scrappey)
            return null;
        } finally {
            // Cleanup
            try {
                if (page) await page.close().catch(() => {});
            } catch (e) {
                // Ignore
            }
            try {
                if (browser) await browser.close().catch(() => {});
            } catch (e) {
                // Ignore
            }
        }
    }
}

module.exports = StandaloneScreenshotService;

