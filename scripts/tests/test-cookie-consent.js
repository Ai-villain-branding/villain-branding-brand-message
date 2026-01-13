/**
 * Cookie Consent Test Script
 * 
 * Tests the 5-layer cookie consent resilience system against known sites
 * with cookie consent banners.
 * 
 * Usage: node test-cookie-consent.js
 */

const StandaloneScreenshotService = require('../../src/backend/services/standaloneScreenshotService');
const fs = require('fs');
const path = require('path');

// Test sites with known cookie consent banners
const TEST_SITES = [
    {
        name: 'BBC (OneTrust)',
        url: 'https://www.bbc.com',
        text: 'BBC'
    },
    {
        name: 'The Guardian (Sourcepoint)',
        url: 'https://www.theguardian.com',
        text: 'The Guardian'
    },
    {
        name: 'CNN (OneTrust)',
        url: 'https://www.cnn.com',
        text: 'CNN'
    },
    {
        name: 'Forbes (TrustArc)',
        url: 'https://www.forbes.com',
        text: 'Forbes'
    },
    {
        name: 'Wired (Consent Management)',
        url: 'https://www.wired.com',
        text: 'Wired'
    }
];

async function runTests() {
    console.log('='.repeat(70));
    console.log('COOKIE CONSENT RESILIENCE TEST');
    console.log('='.repeat(70));
    console.log('');

    const service = new StandaloneScreenshotService();
    const results = [];

    // Create test results directory
    const resultsDir = path.join(__dirname, '../../screenshots', 'test-results');
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
    }

    for (const site of TEST_SITES) {
        console.log(`\nTesting: ${site.name}`);
        console.log(`URL: ${site.url}`);
        console.log('-'.repeat(70));

        const startTime = Date.now();

        try {
            const result = await service.captureMessage(site.url, site.text, `test-${Date.now()}`);
            const duration = Date.now() - startTime;

            if (result && result.buffer) {
                // Save screenshot
                const filename = `${site.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png`;
                const filepath = path.join(resultsDir, filename);
                fs.writeFileSync(filepath, result.buffer);

                console.log(`✓ SUCCESS (${duration}ms)`);
                console.log(`  Source: ${result.metadata.source}`);
                console.log(`  Screenshot saved: ${filepath}`);

                // Get consent handler stats if available
                if (service.consentHandler) {
                    const stats = service.consentHandler.getStats();
                    console.log(`  Blocked requests: ${stats.blockedRequests}`);
                    console.log(`  Layers activated: ${stats.summary}`);
                }

                results.push({
                    site: site.name,
                    url: site.url,
                    success: true,
                    duration,
                    source: result.metadata.source,
                    filepath
                });
            } else {
                console.log(`✗ FAILED (${duration}ms)`);
                console.log(`  Reason: No screenshot returned`);

                results.push({
                    site: site.name,
                    url: site.url,
                    success: false,
                    duration,
                    error: 'No screenshot returned'
                });
            }
        } catch (error) {
            const duration = Date.now() - startTime;
            console.log(`✗ ERROR (${duration}ms)`);
            console.log(`  Error: ${error.message}`);

            results.push({
                site: site.name,
                url: site.url,
                success: false,
                duration,
                error: error.message
            });
        }

        // Reset stats for next test
        if (service.consentHandler) {
            service.consentHandler.resetStats();
        }
    }

    // Print summary
    console.log('');
    console.log('='.repeat(70));
    console.log('TEST SUMMARY');
    console.log('='.repeat(70));
    console.log('');

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const successRate = ((successful / results.length) * 100).toFixed(1);

    console.log(`Total tests: ${results.length}`);
    console.log(`Successful: ${successful} (${successRate}%)`);
    console.log(`Failed: ${failed}`);
    console.log('');

    // Print detailed results
    console.log('Detailed Results:');
    console.log('-'.repeat(70));
    results.forEach((result, index) => {
        const status = result.success ? '✓' : '✗';
        console.log(`${index + 1}. ${status} ${result.site}`);
        console.log(`   URL: ${result.url}`);
        console.log(`   Duration: ${result.duration}ms`);
        if (result.success) {
            console.log(`   Source: ${result.source}`);
            console.log(`   File: ${result.filepath}`);
        } else {
            console.log(`   Error: ${result.error}`);
        }
        console.log('');
    });

    // Save results to JSON
    const reportPath = path.join(resultsDir, 'test-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        summary: {
            total: results.length,
            successful,
            failed,
            successRate: parseFloat(successRate)
        },
        results
    }, null, 2));

    console.log(`Full report saved to: ${reportPath}`);
    console.log('');
    console.log('='.repeat(70));

    // Exit with appropriate code
    process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
    console.error('Fatal error running tests:', error);
    process.exit(1);
});
