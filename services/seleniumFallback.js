/**
 * Selenium Fallback Engine (Free, Last Resort)
 * 
 * Simplified consent-neutralization with Selenium
 * Triggered when both Playwright and Puppeteer fail
 */

class SeleniumFallback {
    async captureMessage(url, messageText, messageId) {
        const { Builder, By, until } = require('selenium-webdriver');
        const chrome = require('selenium-webdriver/chrome');

        let driver = null;

        try {
            console.log('[SeleniumFallback] Launching Chrome...');

            const options = new chrome.Options();
            options.addArguments('--headless=new');
            options.addArguments('--no-sandbox');
            options.addArguments('--disable-dev-shm-usage');
            options.addArguments('--disable-gpu');
            options.addArguments('--window-size=1920,1080');

            driver = await new Builder()
                .forBrowser('chrome')
                .setChromeOptions(options)
                .build();

            // Navigate
            console.log('[SeleniumFallback] Navigating to page...');
            await driver.get(url);

            // Wait for page to load
            await driver.sleep(8000);

            // Inject CMP neutralizer
            await driver.executeScript(`
                // OneTrust neutralization
                window.OneTrust = window.OneTrust || {};
                window.OneTrust.IsAlertBoxClosed = () => true;
                
                // Cookiebot neutralization
                window.Cookiebot = window.Cookiebot || {};
                window.Cookiebot.consented = true;
                
                // IAB TCF neutralization
                window.__tcfapi = function(cmd, ver, callback) {
                    callback({ gdprApplies: false, cmpLoaded: true }, true);
                };
                
                // Hide banners with CSS
                const style = document.createElement('style');
                style.textContent = \`
                    #onetrust-consent-sdk,
                    #CybotCookiebotDialog,
                    .qc-cmp2-container,
                    [class*="cookie-banner"],
                    [class*="consent-banner"] {
                        display: none !important;
                    }
                    body { overflow: auto !important; }
                \`;
                document.head.appendChild(style);
            `);

            // Take screenshot
            console.log('[SeleniumFallback] Capturing screenshot...');
            const screenshot = await driver.takeScreenshot();
            const buffer = Buffer.from(screenshot, 'base64');

            console.log('[SeleniumFallback] Screenshot captured successfully');

            return {
                buffer,
                metadata: {
                    url,
                    messageId,
                    timestamp: new Date().toISOString(),
                    source: 'selenium-fallback'
                }
            };

        } catch (error) {
            console.error('[SeleniumFallback] Failed:', error.message);
            throw error;
        } finally {
            if (driver) {
                await driver.quit().catch(() => { });
            }
        }
    }
}

module.exports = SeleniumFallback;
