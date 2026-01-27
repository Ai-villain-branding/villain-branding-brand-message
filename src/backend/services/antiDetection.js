/**
 * Anti-Detection Utilities
 * 
 * Provides browser fingerprint randomization, proxy rotation, and rate limiting
 * to help avoid bot detection on protected websites.
 */

// Common user agents (Chrome on Windows, Mac, and Linux)
const USER_AGENTS = [
    // Chrome on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',

    // Chrome on Mac
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',

    // Firefox on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',

    // Firefox on Mac
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0',

    // Edge on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',

    // Safari on Mac
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];

// Common viewport sizes (desktop only for consistent rendering)
const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1600, height: 900 },
    { width: 2560, height: 1440 },
    { width: 1680, height: 1050 },
];

// Common timezones
const TIMEZONES = [
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'America/Denver',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Asia/Tokyo',
    'Asia/Singapore',
    'Australia/Sydney',
];

// Common locales
const LOCALES = [
    'en-US',
    'en-GB',
    'en-AU',
    'en-CA',
];

// Common screen color depths
const COLOR_DEPTHS = [24, 32];

// Common device memory values (in GB)
const DEVICE_MEMORIES = [4, 8, 16, 32];

// Common hardware concurrency values (CPU cores)
const HARDWARE_CONCURRENCIES = [4, 6, 8, 12, 16];

/**
 * Generate a random browser fingerprint
 * @returns {Object} Browser fingerprint configuration
 */
function generateRandomFingerprint() {
    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const viewport = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
    const timezone = TIMEZONES[Math.floor(Math.random() * TIMEZONES.length)];
    const locale = LOCALES[Math.floor(Math.random() * LOCALES.length)];
    const colorDepth = COLOR_DEPTHS[Math.floor(Math.random() * COLOR_DEPTHS.length)];
    const deviceMemory = DEVICE_MEMORIES[Math.floor(Math.random() * DEVICE_MEMORIES.length)];
    const hardwareConcurrency = HARDWARE_CONCURRENCIES[Math.floor(Math.random() * HARDWARE_CONCURRENCIES.length)];

    // Extract browser version from user agent
    const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
    const firefoxMatch = userAgent.match(/Firefox\/(\d+)/);
    const browserVersion = chromeMatch ? chromeMatch[1] : (firefoxMatch ? firefoxMatch[1] : '121');

    // Determine platform from user agent
    let platform = 'Win32';
    let platformName = 'Windows';
    if (userAgent.includes('Macintosh')) {
        platform = 'MacIntel';
        platformName = 'macOS';
    } else if (userAgent.includes('Linux')) {
        platform = 'Linux x86_64';
        platformName = 'Linux';
    }

    // Generate Sec-CH-UA header based on browser
    let secChUa = '';
    if (userAgent.includes('Chrome')) {
        secChUa = `"Not_A Brand";v="8", "Chromium";v="${browserVersion}", "Google Chrome";v="${browserVersion}"`;
    } else if (userAgent.includes('Edg')) {
        secChUa = `"Not_A Brand";v="8", "Chromium";v="${browserVersion}", "Microsoft Edge";v="${browserVersion}"`;
    }

    return {
        userAgent,
        viewport,
        timezone,
        locale,
        colorDepth,
        deviceMemory,
        hardwareConcurrency,
        platform,
        platformName,
        browserVersion,
        secChUa,
        // Screen dimensions (slightly larger than viewport to account for browser chrome)
        screen: {
            width: viewport.width + Math.floor(Math.random() * 100),
            height: viewport.height + Math.floor(Math.random() * 200) + 100,
        },
    };
}

/**
 * Generate HTTP headers that match the fingerprint
 * @param {Object} fingerprint - The browser fingerprint
 * @returns {Object} HTTP headers
 */
function generateHeaders(fingerprint) {
    const headers = {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': `${fingerprint.locale},en;q=0.9`,
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
    };

    // Add Sec-CH-UA headers for Chrome/Edge
    if (fingerprint.secChUa) {
        headers['Sec-Ch-Ua'] = fingerprint.secChUa;
        headers['Sec-Ch-Ua-Mobile'] = '?0';
        headers['Sec-Ch-Ua-Platform'] = `"${fingerprint.platformName}"`;
    }

    return headers;
}

/**
 * Apply fingerprint evasion scripts to a page
 * @param {Page} page - Playwright page object
 * @param {Object} fingerprint - The browser fingerprint
 */
async function applyFingerprintEvasion(page, fingerprint) {
    // Add init script to mask automation detection
    await page.addInitScript((fp) => {
        // 1. Aggressive navigator.webdriver removal
        try {
            // Delete the property first
            delete Object.getPrototypeOf(navigator).webdriver;
        } catch (e) { }

        // Define it as false with all possible descriptors on both navigator and its prototype
        const hideWebdriver = {
            get: () => false,
            enumerable: true,
            configurable: true
        };
        Object.defineProperty(navigator, 'webdriver', hideWebdriver);
        Object.defineProperty(Object.getPrototypeOf(navigator), 'webdriver', hideWebdriver);

        // 2. Override other navigator properties
        Object.defineProperty(navigator, 'platform', { get: () => fp.platform });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => fp.hardwareConcurrency });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => fp.deviceMemory });
        Object.defineProperty(navigator, 'languages', { get: () => [fp.locale, 'en-US', 'en'] });
        Object.defineProperty(navigator, 'appVersion', { get: () => fp.userAgent.replace('Mozilla/', '') });

        // 3. Mask automation markers (common in ChromeDriver, Selenium, Playwright)
        try {
            const automationMarkers = [
                'cdc_', 'wd_', '__playwright', '__pw_manual',
                '__fxdriver_unwrapped', '__webdriver_evaluate',
                '__webdriver_script_fn', '__webdriver_script_func',
                '__webdriver_script_function', '__webdriver_unwrapped',
                '__webdriver_func', '__driver_evaluate', '__driver_unwrapped',
                '__selenium_evaluate', '__selenium_unwrapped', '__selenium_func',
                'domAutomation', 'domAutomationController'
            ];

            const keys = Object.keys(window);
            for (const key of keys) {
                for (const marker of automationMarkers) {
                    if (key.includes(marker)) {
                        delete window[key];
                    }
                }
            }
        } catch (e) { }

        // 4. Override screen properties
        Object.defineProperty(screen, 'colorDepth', { get: () => fp.colorDepth });
        Object.defineProperty(screen, 'pixelDepth', { get: () => fp.colorDepth });
        Object.defineProperty(screen, 'width', { get: () => fp.screen.width });
        Object.defineProperty(screen, 'height', { get: () => fp.screen.height });
        Object.defineProperty(screen, 'availWidth', { get: () => fp.screen.width });
        Object.defineProperty(screen, 'availHeight', { get: () => fp.screen.height - 40 });

        // 5. Override window.chrome to indicate real Chrome
        if (!window.chrome) {
            window.chrome = {
                runtime: {},
                loadTimes: function () { },
                csi: function () { },
                app: {},
            };
        }

        // 6. Add plugins array to look like a real browser
        Object.defineProperty(navigator, 'plugins', {
            get: () => {
                const plugins = [
                    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format' },
                    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
                ];
                plugins.length = 3;
                return plugins;
            }
        });

        // 7. Override permissions API to avoid detection
        const originalQuery = window.navigator.permissions?.query;
        if (originalQuery) {
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
        }

        // 8. Spoof WebGL vendor and renderer
        const getParameterProxyHandler = {
            apply: function (target, thisArg, args) {
                const param = args[0];
                // UNMASKED_VENDOR_WEBGL
                if (param === 37445) {
                    return 'Intel Inc.';
                }
                // UNMASKED_RENDERER_WEBGL
                if (param === 37446) {
                    return 'Intel Iris OpenGL Engine';
                }
                return Reflect.apply(target, thisArg, args);
            }
        };

        // Apply to WebGL contexts
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (gl) {
                const originalGetParameter = gl.getParameter.bind(gl);
                WebGLRenderingContext.prototype.getParameter = new Proxy(originalGetParameter, getParameterProxyHandler);
            }
        } catch (e) { }

    }, fingerprint);
}

/**
 * Proxy configuration manager
 */
class ProxyManager {
    constructor(proxyList = null) {
        // Parse proxy list from environment or provided list
        this.proxies = proxyList || this.parseProxiesFromEnv();
        this.currentIndex = 0;
        this.failedProxies = new Set();
    }

    parseProxiesFromEnv() {
        const proxyEnv = process.env.PROXY_LIST || process.env.PROXIES;
        if (!proxyEnv) return [];

        // Expected format: "http://user:pass@host:port,http://host2:port2"
        return proxyEnv.split(',').map(p => p.trim()).filter(p => p.length > 0);
    }

    /**
     * Get the next proxy in rotation
     * @returns {string|null} Proxy URL or null if no proxies available
     */
    getNextProxy() {
        if (this.proxies.length === 0) return null;

        // Find next non-failed proxy
        let attempts = 0;
        while (attempts < this.proxies.length) {
            const proxy = this.proxies[this.currentIndex];
            this.currentIndex = (this.currentIndex + 1) % this.proxies.length;

            if (!this.failedProxies.has(proxy)) {
                return proxy;
            }
            attempts++;
        }

        // All proxies failed, reset and try again
        this.failedProxies.clear();
        return this.proxies[0] || null;
    }

    /**
     * Mark a proxy as failed
     * @param {string} proxy - The proxy URL that failed
     */
    markFailed(proxy) {
        if (proxy) {
            this.failedProxies.add(proxy);
            console.warn(`[Proxy] Marked proxy as failed: ${proxy.replace(/:[^:]*@/, ':***@')}`);
        }
    }

    /**
     * Check if proxies are configured
     * @returns {boolean}
     */
    hasProxies() {
        return this.proxies.length > 0;
    }

    /**
     * Get count of available proxies
     * @returns {number}
     */
    getProxyCount() {
        return this.proxies.length;
    }
}

/**
 * Rate limiter for requests
 */
class RateLimiter {
    constructor(options = {}) {
        this.minDelay = options.minDelay || parseInt(process.env.RATE_LIMIT_MIN_DELAY) || 1000; // 1 second minimum
        this.maxDelay = options.maxDelay || parseInt(process.env.RATE_LIMIT_MAX_DELAY) || 3000; // 3 seconds maximum
        this.lastRequestTime = {};
        this.requestCounts = {};
        this.cooldownPeriod = options.cooldownPeriod || 60000; // 1 minute cooldown after many requests
        this.maxRequestsBeforeCooldown = options.maxRequestsBeforeCooldown || 10;
    }

    /**
     * Get the delay to wait before making a request to a domain
     * @param {string} url - The URL to request
     * @returns {number} Delay in milliseconds
     */
    getDelay(url) {
        try {
            const domain = new URL(url).hostname;
            const now = Date.now();

            // Initialize counters for this domain
            if (!this.requestCounts[domain]) {
                this.requestCounts[domain] = { count: 0, windowStart: now };
            }

            // Reset counter if window expired
            if (now - this.requestCounts[domain].windowStart > this.cooldownPeriod) {
                this.requestCounts[domain] = { count: 0, windowStart: now };
            }

            // Calculate base delay with randomization
            let delay = this.minDelay + Math.floor(Math.random() * (this.maxDelay - this.minDelay));

            // Add extra delay if we've made many requests to this domain
            if (this.requestCounts[domain].count >= this.maxRequestsBeforeCooldown) {
                delay += 5000; // Add 5 seconds if hitting rate limits
                console.log(`[RateLimiter] Adding cooldown delay for ${domain} (${this.requestCounts[domain].count} requests)`);
            }

            // Increment request count
            this.requestCounts[domain].count++;

            return delay;
        } catch (e) {
            return this.minDelay;
        }
    }

    /**
     * Wait for the appropriate delay
     * @param {string} url - The URL to request
     */
    async wait(url) {
        const delay = this.getDelay(url);
        if (delay > 0) {
            console.log(`[RateLimiter] Waiting ${delay}ms before request to ${new URL(url).hostname}`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    /**
     * Record that a request was made
     * @param {string} url - The URL that was requested
     */
    recordRequest(url) {
        try {
            const domain = new URL(url).hostname;
            this.lastRequestTime[domain] = Date.now();
        } catch (e) { }
    }
}

// Create singleton instances
const proxyManager = new ProxyManager();
const rateLimiter = new RateLimiter();

module.exports = {
    generateRandomFingerprint,
    generateHeaders,
    applyFingerprintEvasion,
    ProxyManager,
    RateLimiter,
    proxyManager,
    rateLimiter,
    USER_AGENTS,
    VIEWPORTS,
    TIMEZONES,
    LOCALES,
};
