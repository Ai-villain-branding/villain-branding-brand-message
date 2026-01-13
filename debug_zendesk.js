const { chromium } = require('playwright');
const fs = require('fs');

async function debugFetch(url) {
    console.log(`Fetching ${url}...`);
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000); // Wait for dynamic content

        const content = await page.content();
        const title = await page.title();
        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));

        console.log(`Title: ${title}`);
        console.log(`Content Length: ${content.length}`);
        console.log(`Body Snippet: ${bodyText.replace(/\n/g, ' ')}...`);

        // Check for common block indicators
        const isBlocked = title.includes('Just a moment') ||
            title.includes('Access denied') ||
            title.includes('Attention Required') ||
            title.includes('Cloudflare');

        if (isBlocked) {
            console.error('DETECTED BLOCK PAGE!');
        } else {
            console.log('Content seems valid.');
        }

    } catch (error) {
        console.error('Error fetching:', error.message);
    } finally {
        await browser.close();
    }
}

const { cleanContent } = require('./services/contentCleaner');

(async () => {
    console.log('--- Testing Zendesk ---');
    await debugFetch('https://www.zendesk.com');
    console.log('\n--- Testing Asana ---');
    await debugFetch('https://asana.com');
})();

async function debugFetch(url) {
    console.log(`Fetching ${url}...`);
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000); // Wait for dynamic content

        const content = await page.content();
        const title = await page.title();

        console.log(`Title: ${title}`);
        console.log(`Raw HTML Length: ${content.length}`);

        const cleaned = cleanContent(content);
        console.log(`Cleaned Content Length: ${cleaned.length}`);
        console.log(`Cleaned Snippet: ${cleaned.substring(0, 500)}...`);

        if (cleaned.length < 100) {
            console.error('WARNING: Cleaned content is too short! This page would be skipped.');
        }

    } catch (error) {
        console.error('Error fetching:', error.message);
    } finally {
        await browser.close();
    }
}
