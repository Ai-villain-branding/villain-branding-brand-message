/**
 * Puppeteer Fallback Engine (Free)
 * 
 * Uses consent-neutralization strategy with Puppeteer
 * Triggered when Playwright fails
 */

const ConsentNeutralizer = require('./consentNeutralizer');

class PuppeteerFallback {
    constructor() {
        this.neutralizer = new ConsentNeutralizer();
    }

    async captureMessage(url, messageText, messageId) {
        let browser = null;
        let page = null;

        try {
            const puppeteer = require('puppeteer');

            console.log('[PuppeteerFallback] Launching browser...');

            browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-features=IsolateOrigins,site-per-process'
                ]
            });

            page = await browser.newPage();

            await page.setViewport({ width: 1920, height: 1080 });
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

            // LAYER 1 & 2: Inject CMP neutralizer and consent state
            await page.evaluateOnNewDocument(this.neutralizer.getCMPNeutralizerScript());
            await page.evaluateOnNewDocument(this.neutralizer.getServiceWorkerDisableScript());

            // LAYER 3: Safe network handling
            await page.setRequestInterception(true);
            page.on('request', (request) => {
                const url = request.url();

                // Only block non-essential trackers (NOT consent scripts)
                const shouldBlock = (
                    url.includes('doubleclick.net') ||
                    url.includes('googlesyndication.com') ||
                    url.includes('hotjar.com') ||
                    url.includes('mouseflow.com')
                );

                if (shouldBlock) {
                    request.abort();
                } else {
                    request.continue();
                }
            });

            // Navigate
            console.log('[PuppeteerFallback] Navigating to page...');
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 90000
            }).catch(() => { });

            // Wait for readable DOM
            await page.waitForTimeout(10000);

            // LAYER 4: Apply CSS
            await page.addStyleTag({
                content: `
                    #onetrust-consent-sdk,
                    #CybotCookiebotDialog,
                    .qc-cmp2-container,
                    [class*="cookie-banner"],
                    [class*="consent-banner"],
                    .cookie-consent, .gdpr-banner, .privacy-notice {
                        display: none !important;
                        visibility: hidden !important;
                    }
                    body { overflow: auto !important; position: static !important; }
                `
            });

            // Scroll to trigger lazy loading
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight * 0.5);
            });
            await page.waitForTimeout(2000);

            // LAYER 6: Element screenshot
            console.log('[PuppeteerFallback] Capturing screenshot...');
            const selectors = [
                'main', 'article', '[role="main"]', '#content', '.content', '.main-content', 'body'
            ];

            let screenshot = null;
            for (const selector of selectors) {
                try {
                    const element = await page.$(selector);
                    if (element) {
                        const isVisible = await element.isVisible();
                        if (isVisible) {
                            screenshot = await element.screenshot();
                            console.log(`[PuppeteerFallback] Captured using selector: ${selector}`);
                            break;
                        }
                    }
                } catch (e) {
                    continue;
                }
            }

            if (!screenshot) {
                screenshot = await page.screenshot({ fullPage: false });
            }

            console.log('[PuppeteerFallback] Screenshot captured successfully');

            return {
                buffer: screenshot,
                metadata: {
                    url,
                    messageId,
                    timestamp: new Date().toISOString(),
                    source: 'puppeteer-fallback'
                }
            };

        } catch (error) {
            console.error('[PuppeteerFallback] Failed:', error.message);
            throw error;
        } finally {
            if (page) await page.close().catch(() => { });
            if (browser) await browser.close().catch(() => { });
        }
    }
}

module.exports = PuppeteerFallback;
