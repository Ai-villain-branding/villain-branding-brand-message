const { chromium } = require('playwright');

async function debugOneTrust() {
    const browser = await chromium.launch({ headless: true }); // Headless true to match server env
    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    });
    const page = await context.newPage();

    try {
        console.log('Navigating to Accenture...');
        await page.goto('https://www.accenture.com', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000); // Wait for popup

        // Check for OneTrust elements
        const oneTrustContainer = await page.$('#onetrust-banner-sdk');
        console.log('OneTrust container found:', !!oneTrustContainer);

        if (oneTrustContainer) {
            const html = await oneTrustContainer.innerHTML();
            console.log('OneTrust HTML snippet:', html.substring(0, 500));
        }

        // Try selectors from my previous fix
        const selectors = [
            '#onetrust-accept-btn-handler',
            '#onetrust-banner-sdk .save-preference-btn-handler',
            '#onetrust-close-btn-container button',
            'button:has-text("Allow All")',
            'button:has-text("Accept All")'
        ];

        for (const selector of selectors) {
            const el = await page.$(selector);
            const isVisible = el ? await el.isVisible() : false;
            console.log(`Selector "${selector}": found=${!!el}, visible=${isVisible}`);

            if (isVisible) {
                console.log(`Attempting click on ${selector}...`);
                await el.click();
                console.log('Clicked.');
                await page.waitForTimeout(2000);
            }
        }

        // Check if still visible
        const stillVisible = await page.$('#onetrust-banner-sdk');
        console.log('OneTrust container still visible after attempts:', !!stillVisible && await stillVisible.isVisible());

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await browser.close();
    }
}

debugOneTrust();
