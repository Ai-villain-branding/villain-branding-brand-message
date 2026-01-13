/**
 * Standalone Screenshot Service (Free Methods Only)
 * 
 * CRITICAL CONSTRAINTS:
 * - Headless mode ONLY
 * - NO paid APIs (Scrappey, SaaS screenshot tools)
 * - Consent-neutralization strategy (Unified with Cloudflare bypass)
 * - Free fallback engines: Playwright → Puppeteer → Selenium
 * - Must degrade gracefully on failures
 */

const { chromium } = require('playwright');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const ConsentNeutralizer = require('./consentNeutralizer');

class StandaloneScreenshotService {
    constructor() {
        this.defaultWidth = parseInt(process.env.SCREENSHOT_WIDTH) || 1920;
        this.defaultHeight = parseInt(process.env.SCREENSHOT_HEIGHT) || 1080;
        this.waitTimeAfterLoad = 8000;
        this.pageLoadTimeout = 90000;

        // Cloudflare bypass settings
        this.cloudflareExtensionEnabled = process.env.CLOUDFLARE_EXTENSION_ENABLED !== 'false';
        this.cloudflareBypassTimeout = parseInt(process.env.CLOUDFLARE_BYPASS_TIMEOUT) || 180000; // 3 mins

        // Initialize consent neutralizer
        this.neutralizer = new ConsentNeutralizer();
    }

    /**
     * Detect Cloudflare challenge
     */
    async detectCloudflareChallenge(page) {
        try {
            return await page.evaluate(() => {
                const title = document.title.toLowerCase();
                const body = document.body.innerText.toLowerCase();
                return (
                    title.includes('just a moment') ||
                    title.includes('attention required') ||
                    title.includes('security check') ||
                    title.includes('cloudflare') ||
                    body.includes('verify you are human') ||
                    body.includes('checking your browser')
                );
            });
        } catch (e) {
            return false;
        }
    }

    /**
     * Wait for Cloudflare extension to bypass challenge
     */
    async waitForCloudflareBypass(page, url) {
        if (!this.cloudflareExtensionEnabled) return false;

        this.log('info', `Waiting for Cloudflare bypass for ${url}...`);

        const startTime = Date.now();
        while (Date.now() - startTime < this.cloudflareBypassTimeout) {
            // Check if extension signaled completion
            const isComplete = await page.evaluate(() => window.cloudflareBypassComplete === true);

            if (isComplete) {
                this.log('info', 'Cloudflare bypass reported complete by extension');
                return true;
            }

            // Check if challenge is gone
            const isChallenge = await this.detectCloudflareChallenge(page);
            if (!isChallenge) {
                // Double check it's not just a blank page
                const hasContent = await page.evaluate(() => document.body.innerText.length > 200);
                if (hasContent) {
                    this.log('info', 'Cloudflare challenge no longer detected');
                    return true;
                }
            }

            await page.waitForTimeout(1000);
        }

        this.log('warn', 'Cloudflare bypass timed out');
        return false;
    }

    /**
     * LAYER 8: FREE-ONLY FALLBACK CAPTURE
     */
    async fallbackCaptureFreeOnly(url, messageText, messageId) {
        this.log('warn', 'Attempting free fallback engines...');

        // Try Puppeteer
        if (process.env.ENABLE_PUPPETEER_FALLBACK === 'true') {
            try {
                this.log('info', 'Trying Puppeteer fallback...');
                const PuppeteerFallback = require('./puppeteerFallback');
                const puppeteer = new PuppeteerFallback();
                const result = await puppeteer.captureMessage(url, messageText, messageId);
                if (result && result.buffer) {
                    this.log('info', 'Puppeteer fallback succeeded');
                    return result;
                }
            } catch (error) {
                this.log('error', `Puppeteer fallback failed: ${error.message}`);
            }
        }

        // Try Selenium
        if (process.env.ENABLE_SELENIUM_FALLBACK === 'true') {
            try {
                this.log('info', 'Trying Selenium fallback (last resort)...');
                const SeleniumFallback = require('./seleniumFallback');
                const selenium = new SeleniumFallback();
                const result = await selenium.captureMessage(url, messageText, messageId);
                if (result && result.buffer) {
                    this.log('info', 'Selenium fallback succeeded');
                    return result;
                }
            } catch (error) {
                this.log('error', `Selenium fallback failed: ${error.message}`);
            }
        }

        // All free methods exhausted
        throw new Error('All free capture methods failed (Playwright, Puppeteer, Selenium). Paid APIs are disabled.');
    }

    /**
     * Main capture method with consent neutralization AND Cloudflare bypass
     */
    async captureMessage(url, messageText, messageId) {
        let browser = null;
        let context = null;
        let page = null;
        let userDataDir = null;

        try {
            this.log('info', `Starting capture for: ${url}`);

            // PATH TO EXTENSIONS
            const cloudflareExtPath = path.resolve(__dirname, '..', 'cloudflare-extension');
            const stabilizerExtPath = path.resolve(__dirname, '..', 'chrome-extension');
            const useCloudflareExt = this.cloudflareExtensionEnabled && fs.existsSync(cloudflareExtPath);
            const useStabilizerExt = fs.existsSync(stabilizerExtPath);

            const args = [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-blink-features=AutomationControlled'
            ];

            const extensionArgs = [];
            if (useCloudflareExt) {
                this.log('info', 'Loading Cloudflare bypass extension');
                extensionArgs.push(cloudflareExtPath);
            }
            if (useStabilizerExt) {
                // this.log('info', 'Loading Stabilizer extension');
                // extensionArgs.push(stabilizerExtPath); 
                // Note: Loading multiple extensions can sometimes cause issues in persistent context
                // prioritizing Cloudflare if both exist, or load both if stable
                if (!useCloudflareExt) extensionArgs.push(stabilizerExtPath);
                else extensionArgs.push(stabilizerExtPath); // Load both
            }

            if (extensionArgs.length > 0) {
                const extList = extensionArgs.join(',');
                args.push(`--disable-extensions-except=${extList}`);
                args.push(`--load-extension=${extList}`);
            }

            // USE PERSISTENT CONTEXT if using extensions (required)
            if (extensionArgs.length > 0) {
                userDataDir = `/tmp/playwright-user-data-${uuidv4()}`;
                if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

                browser = await chromium.launchPersistentContext(userDataDir, {
                    headless: true, // Extensions work in headless=new (default true in recent versions)
                    args,
                    viewport: { width: this.defaultWidth, height: this.defaultHeight },
                    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    serviceWorkers: 'block' // Layer 7
                });
                context = browser; // browser IS the context in persistent mode
                page = await context.newPage();
            } else {
                // Standard launch (no extensions)
                browser = await chromium.launch({ headless: true, args });
                context = await browser.newContext({
                    viewport: { width: this.defaultWidth, height: this.defaultHeight },
                    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    serviceWorkers: 'block'
                });
                page = await context.newPage();
            }

            // LAYER 1: Inject CMP neutralizer
            await this.neutralizer.injectCMPNeutralizer(context);

            // LAYER 2: Pre-inject consent state
            await this.neutralizer.injectConsentState(context);

            // Inject service worker disabler
            await context.addInitScript(this.neutralizer.getServiceWorkerDisableScript());

            // LAYER 3: Setup safe network handling
            await this.neutralizer.setupSafeNetworkHandling(page);

            // Navigate
            this.log('info', 'Navigating to page...');
            try {
                await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: this.pageLoadTimeout
                });
            } catch (navError) {
                this.log('warn', `Navigation error: ${navError.message}`);
                // Proceed to check for Cloudflare/content
            }

            // CLOUDFLARE BYPASS CHECK
            if (useCloudflareExt) {
                const isCloudflare = await this.detectCloudflareChallenge(page);
                if (isCloudflare) {
                    this.log('info', 'Cloudflare challenge detected! Waiting for bypass...');
                    await this.waitForCloudflareBypass(page, url);
                }
            }

            // LAYER 5: Wait for readable DOM
            await this.neutralizer.waitForReadableDOM(page, 30000);

            // LAYER 4: CSS Overlay Removal
            await this.neutralizer.applyOverlayCSS(page);

            // Wait for dynamic content
            await page.waitForTimeout(this.waitTimeAfterLoad);

            // LAYER 6: Capture
            this.log('info', 'Capturing screenshot...');
            const screenshotResult = await this.neutralizer.captureElementScreenshot(page);

            this.log('info', '✓ Screenshot captured successfully!');
            const stats = this.neutralizer.getStats();

            return {
                buffer: screenshotResult.buffer,
                metadata: {
                    url,
                    messageId,
                    timestamp: new Date().toISOString(),
                    source: 'standalone-playwright',
                    selector: screenshotResult.selector,
                    neutralizationStats: stats
                }
            };

        } catch (error) {
            this.log('error', `Error capturing screenshot: ${error.message}`);

            // LAYER 8: Try free fallback engines
            try {
                return await this.fallbackCaptureFreeOnly(url, messageText, messageId);
            } catch (fallbackError) {
                throw new Error(`Screenshot capture failed: ${error.message}. Fallback also failed: ${fallbackError.message}`);
            }
        } finally {
            // Cleanup
            try {
                // If persistent context, close browser (which closes context)
                if (browser) await browser.close().catch(() => { });

                // Keep user data dir cleanup optional/async to avoid locks? 
                // Better to clean it up.
                if (userDataDir && fs.existsSync(userDataDir)) {
                    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) { }
                }
            } catch (e) {
                this.log('warn', `Error during cleanup: ${e.message}`);
            }
            this.neutralizer.resetStats();
        }
    }

    log(level, message) {
        console.log(`[Standalone Screenshot] ${message}`);
    }
}

module.exports = StandaloneScreenshotService;
