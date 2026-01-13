/**
 * Simple Cookie Consent Test
 * 
 * Tests the cookie consent handler with a single site
 * Uses only Playwright (no fallback engines needed)
 * 
 * Usage: node simple-test.js
 */

const StandaloneScreenshotService = require('./services/standaloneScreenshotService');
const fs = require('fs');
const path = require('path');

async function simpleTest() {
    console.log('='.repeat(70));
    console.log('SIMPLE COOKIE CONSENT TEST');
    console.log('='.repeat(70));
    console.log('');

    const service = new StandaloneScreenshotService();

    // Create test results directory
    const resultsDir = path.join(__dirname, 'screenshots', 'simple-test');
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
    }

    // Test with a simple site
    const testUrl = 'https://example.com';
    const testText = 'Example Domain';

    console.log(`Testing URL: ${testUrl}`);
    console.log(`Looking for text: "${testText}"`);
    console.log('-'.repeat(70));
    console.log('');

    const startTime = Date.now();

    try {
        const result = await service.captureMessage(testUrl, testText, 'simple-test');
        const duration = Date.now() - startTime;

        if (result && result.buffer) {
            // Save screenshot
            const filepath = path.join(resultsDir, 'example-com.png');
            fs.writeFileSync(filepath, result.buffer);

            console.log('✓ SUCCESS!');
            console.log(`  Duration: ${duration}ms`);
            console.log(`  Source: ${result.metadata.source}`);
            console.log(`  Screenshot saved: ${filepath}`);
            console.log('');

            // Get consent handler stats
            if (service.consentHandler) {
                const stats = service.consentHandler.getStats();
                console.log('Cookie Consent Handler Stats:');
                console.log(`  Blocked requests: ${stats.blockedRequests}`);
                console.log(`  Consent injected: ${stats.injectedConsent}`);
                console.log(`  CSS applied: ${stats.cssApplied}`);
                console.log(`  Element strategy: ${stats.elementStrategy || 'N/A'}`);
                console.log(`  Summary: ${stats.summary}`);
            }

            console.log('');
            console.log('='.repeat(70));
            console.log('TEST PASSED ✓');
            console.log('='.repeat(70));

            process.exit(0);
        } else {
            console.log('✗ FAILED: No screenshot returned');
            process.exit(1);
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        console.log('✗ ERROR');
        console.log(`  Duration: ${duration}ms`);
        console.log(`  Error: ${error.message}`);
        console.log(`  Stack: ${error.stack}`);
        console.log('');
        console.log('='.repeat(70));
        console.log('TEST FAILED ✗');
        console.log('='.repeat(70));
        process.exit(1);
    }
}

// Run test
simpleTest().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
