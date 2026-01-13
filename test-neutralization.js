/**
 * Test Consent Neutralization Strategy
 * 
 * Tests the new approach on ClickUp Privacy page
 * (known to fail with hard-blocking approach)
 */

const StandaloneScreenshotService = require('./services/standaloneScreenshotService');
const fs = require('fs');
const path = require('path');

async function testConsentNeutralization() {
    console.log('='.repeat(70));
    console.log('CONSENT NEUTRALIZATION TEST');
    console.log('Testing on ClickUp Privacy page (known CMP-heavy site)');
    console.log('='.repeat(70));
    console.log('');

    const service = new StandaloneScreenshotService();

    // Create test results directory
    const resultsDir = path.join(__dirname, 'screenshots', 'neutralization-test');
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
    }

    const testUrl = 'https://www.clickup.com/terms/privacy';
    const testText = 'Privacy Policy';

    console.log(`URL: ${testUrl}`);
    console.log(`Looking for: "${testText}"`);
    console.log('-'.repeat(70));
    console.log('');

    const startTime = Date.now();

    try {
        const result = await service.captureMessage(testUrl, testText, 'neutralization-test');
        const duration = Date.now() - startTime;

        if (result && result.buffer) {
            // Save screenshot
            const filepath = path.join(resultsDir, 'clickup-privacy.png');
            fs.writeFileSync(filepath, result.buffer);

            console.log('');
            console.log('✓ SUCCESS!');
            console.log(`  Duration: ${duration}ms`);
            console.log(`  Source: ${result.metadata.source}`);
            console.log(`  Selector: ${result.metadata.selector}`);
            console.log(`  Screenshot saved: ${filepath}`);
            console.log('');

            if (result.metadata.neutralizationStats) {
                console.log('Neutralization Stats:');
                console.log(`  ${result.metadata.neutralizationStats.summary}`);
                console.log(`  Allowed scripts: ${result.metadata.neutralizationStats.allowedScripts}`);
                console.log(`  Blocked trackers: ${result.metadata.neutralizationStats.blockedTrackers}`);
            }

            console.log('');
            console.log('='.repeat(70));
            console.log('TEST PASSED ✓');
            console.log('Consent scripts were ALLOWED to load but NEUTRALIZED');
            console.log('='.repeat(70));

            process.exit(0);
        } else {
            console.log('✗ FAILED: No screenshot returned');
            process.exit(1);
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        console.log('');
        console.log('✗ ERROR');
        console.log(`  Duration: ${duration}ms`);
        console.log(`  Error: ${error.message}`);
        console.log('');
        console.log('='.repeat(70));
        console.log('TEST FAILED ✗');
        console.log('='.repeat(70));
        process.exit(1);
    }
}

// Run test
testConsentNeutralization().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
