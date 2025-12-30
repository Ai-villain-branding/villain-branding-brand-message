const { chromium } = require('playwright');
const { v4: uuidv4 } = require('uuid');

class ScreenshotService {
    constructor() {
        this.browser = null;
        this.minWidth = 800;
        this.minHeight = 600;
        this.defaultWidth = parseInt(process.env.SCREENSHOT_WIDTH) || 1440;
        this.defaultHeight = parseInt(process.env.SCREENSHOT_HEIGHT) || 900;
    }

    // Initialize browser
    async init() {
        if (!this.browser) {
            this.browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        }
    }

    // Close browser
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    // Find element containing text with multiple strategies
    async findElementWithText(page, text) {
        const cleanText = text.trim().replace(/\s+/g, ' ');
        const normalizedText = cleanText.toLowerCase();

        // Strategy 1: Custom script to find the smallest element containing the full text
        // This handles case-insensitive matching and finds the most specific element
        try {
            const handle = await page.evaluateHandle((targetText, normalizedTarget) => {
                const elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, div, a, li, button, label, strong, em, b, i');
                let bestMatch = null;
                let minArea = Infinity;
                let bestScore = 0;

                for (const el of elements) {
                    const elText = (el.innerText || el.textContent || '').trim();
                    const normalizedElText = elText.toLowerCase().replace(/\s+/g, ' ');
                    
                    // Check if element contains the target text (case-insensitive)
                    if (normalizedElText.includes(normalizedTarget)) {
                        const rect = el.getBoundingClientRect();
                        const area = rect.width * rect.height;
                        
                        // Score based on how well the text matches
                        let score = 0;
                        if (normalizedElText === normalizedTarget) {
                            score = 100; // Exact match
                        } else if (normalizedElText.startsWith(normalizedTarget) || normalizedElText.endsWith(normalizedTarget)) {
                            score = 80; // Starts or ends with
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
            }, cleanText, normalizedText);

            if (handle && handle.asElement()) {
                return handle.asElement();
            }
        } catch (error) {
            console.warn('Strategy 1 failed:', error.message);
        }

        // Strategy 2: Try to find by exact text match (case-insensitive)
        try {
            const element = await page.evaluateHandle((targetText, normalizedTarget) => {
                const walker = document.createTreeWalker(
                    document.body,
                    NodeFilter.SHOW_TEXT,
                    null
                );
                
                let node;
                while (node = walker.nextNode()) {
                    const text = node.textContent.trim();
                    const normalizedText = text.toLowerCase().replace(/\s+/g, ' ');
                    
                    if (normalizedText.includes(normalizedTarget)) {
                        // Find the parent element
                        let parent = node.parentElement;
                        while (parent && parent !== document.body) {
                            // Prefer semantic elements
                            const tag = parent.tagName.toLowerCase();
                            if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'div', 'a', 'li'].includes(tag)) {
                                return parent;
                            }
                            parent = parent.parentElement;
                        }
                        return node.parentElement;
                    }
                }
                return null;
            }, cleanText, normalizedText);
            
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

    // Close popups, modals, cookie banners, and overlays
    async closePopups(page) {
        try {
            // Wait a bit for popups to appear
            await page.waitForTimeout(1000);

            // Common selectors for popups, modals, and overlays
            const popupSelectors = [
                // Cookie consent banners
                '[id*="cookie" i]',
                '[class*="cookie" i]',
                '[data-testid*="cookie" i]',
                // Modals and overlays
                '[role="dialog"]',
                '.modal',
                '.overlay',
                '[class*="modal" i]',
                '[class*="overlay" i]',
                '[class*="popup" i]',
                '[id*="modal" i]',
                '[id*="overlay" i]',
                '[id*="popup" i]',
                // GDPR/Privacy banners
                '[id*="gdpr" i]',
                '[class*="gdpr" i]',
                '[id*="privacy" i]',
                '[class*="privacy" i]',
                '[id*="consent" i]',
                '[class*="consent" i]',
                // Newsletter popups
                '[id*="newsletter" i]',
                '[class*="newsletter" i]'
            ];

            // Try to find and close popups by selector
            for (const selector of popupSelectors) {
                try {
                    const elements = await page.$$(selector);
                    for (const element of elements) {
                        try {
                            const isVisible = await element.isVisible();
                            if (!isVisible) continue;

                            // Look for close/accept buttons within the popup
                            const closeBtn = await element.$('button[aria-label*="close" i], button[aria-label*="Close" i], .close, [class*="close" i], button:has-text("Accept"), button:has-text("×"), button:has-text("X")');
                            
                            if (closeBtn) {
                                await closeBtn.click();
                                await page.waitForTimeout(500);
                                continue;
                            }

                            // If it's a button itself, check if it should be clicked
                            const tagName = await element.evaluate(el => el.tagName);
                            if (tagName === 'BUTTON') {
                                const text = await element.textContent();
                                const textLower = (text || '').toLowerCase();
                                if (textLower.includes('accept') || textLower.includes('close') || textLower.includes('agree')) {
                                    await element.click();
                                    await page.waitForTimeout(500);
                                }
                            }
                        } catch (e) {
                            continue;
                        }
                    }
                } catch (e) {
                    continue;
                }
            }

            // Try to find and click common cookie accept buttons by text content
            try {
                const allButtons = await page.$$('button');
                for (const button of allButtons) {
                    try {
                        const text = await button.textContent();
                        const textLower = (text || '').toLowerCase().trim();
                        const isVisible = await button.isVisible();
                        
                        if (isVisible && (
                            textLower.includes('accept all cookies') ||
                            textLower.includes('accept all') ||
                            textLower === 'accept' ||
                            textLower.includes('i accept') ||
                            textLower.includes('agree') ||
                            textLower.includes('got it') ||
                            textLower.includes('ok') ||
                            textLower.includes('close')
                        )) {
                            // Check if button is in a popup/modal context
                            const parent = await button.evaluateHandle(el => {
                                let current = el.parentElement;
                                let depth = 0;
                                while (current && depth < 5) {
                                    const id = (current.id || '').toLowerCase();
                                    const className = (current.className || '').toLowerCase();
                                    if (id.includes('cookie') || id.includes('modal') || id.includes('popup') ||
                                        className.includes('cookie') || className.includes('modal') || className.includes('popup') ||
                                        className.includes('overlay') || className.includes('banner')) {
                                        return true;
                                    }
                                    current = current.parentElement;
                                    depth++;
                                }
                                return false;
                            });
                            
                            if (await parent.jsonValue()) {
                                await button.click();
                                await page.waitForTimeout(500);
                                break;
                            }
                        }
                    } catch (e) {
                        continue;
                    }
                }
            } catch (e) {
                // Ignore errors
            }

            // Try clicking common close button patterns
            try {
                const closeSelectors = [
                    'button[aria-label*="close" i]',
                    'button[aria-label*="Close" i]',
                    'button.close',
                    '[class*="close-button" i]',
                    '[class*="close-btn" i]',
                    'button:has-text("×")',
                    'button:has-text("X")'
                ];

                for (const selector of closeSelectors) {
                    try {
                        const closeBtn = await page.$(selector);
                        if (closeBtn) {
                            const isVisible = await closeBtn.isVisible();
                            if (isVisible) {
                                await closeBtn.click();
                                await page.waitForTimeout(500);
                                break;
                            }
                        }
                    } catch (e) {
                        continue;
                    }
                }
            } catch (e) {
                // Ignore errors
            }

            // Wait a bit after closing popups for any animations
            await page.waitForTimeout(1000);

        } catch (error) {
            // If popup closing fails, continue anyway - don't block screenshot
            console.warn('Error closing popups:', error.message);
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
    async captureMessage(url, messageText, messageId) {
        await this.init();

        const context = await this.browser.newContext({
            viewport: { width: this.defaultWidth, height: this.defaultHeight },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        });

        const page = await context.newPage();

        try {
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

            // Wait a bit for any animations and dynamic content
            await page.waitForTimeout(2000);

            // Close any popups, modals, or overlays before taking screenshot
            await this.closePopups(page);

            // Find element containing the message
            const element = await this.findElementWithText(page, messageText);

            if (!element) {
                throw new Error(`Could not find text "${messageText}" on page`);
            }

            // Scroll element into view
            await element.scrollIntoViewIfNeeded();
            await page.waitForTimeout(500);

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
            return null;
        } finally {
            await context.close();
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
