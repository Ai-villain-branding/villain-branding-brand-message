/**
 * Cookie Consent Handler
 * 
 * A modular, layered approach to handling cookie consent popups and blocking overlays
 * in headless browser automation. Works without manual interaction.
 * 
 * LAYER 1: Network-level blocking of consent provider scripts
 * LAYER 2: Pre-inject consent state (localStorage/cookies) before page load
 * LAYER 3: CSS-level overlay removal (visual failsafe)
 * LAYER 4: Element-level screenshot capture (target main content)
 * 
 * All layers are designed to fail gracefully and never crash the pipeline.
 */

class CookieConsentHandler {
    constructor(options = {}) {
        // Configuration
        this.config = {
            networkBlockingEnabled: process.env.CONSENT_NETWORK_BLOCKING_ENABLED !== 'false',
            cssInjectionEnabled: process.env.CONSENT_CSS_INJECTION_ENABLED !== 'false',
            loggingLevel: process.env.CONSENT_LOGGING_LEVEL || 'info',
            ...options
        };

        // LAYER 1: Consent provider blocklist
        // These patterns match common cookie consent and tracking providers
        this.consentProviderPatterns = [
            // Major consent management platforms
            'onetrust',
            'cookiebot',
            'quantcast',
            'trustarc',
            'klaro',
            'cookiepro',
            'cookielaw',
            'cookieconsent',
            'osano',
            'termly',
            'iubenda',
            'cookiefirst',
            'usercentrics',
            'didomi',
            'consentmanager',

            // Generic consent/tracking patterns
            'consent',
            'gdpr',
            'cookie-banner',
            'cookie-notice',
            'privacy-banner',
            'cmp', // Consent Management Platform

            // Specific tracking/analytics that often include consent UI
            'cookieyes',
            'complianz',
            'borlabs',
            'cookie-script'
        ];

        // LAYER 2: Common consent localStorage keys
        this.consentLocalStorageKeys = {
            // OneTrust
            'OptanonConsent': 'groups=C0001:1,C0002:1,C0003:1,C0004:1&datestamp=' + new Date().toISOString(),
            'OptanonAlertBoxClosed': new Date().toISOString(),

            // Cookiebot
            'CookieConsent': JSON.stringify({
                necessary: true,
                preferences: true,
                statistics: true,
                marketing: true,
                stamp: Date.now()
            }),
            'CookieConsentBulkSetting': JSON.stringify({ stamp: Date.now() }),

            // Generic consent flags
            'cookieConsent': 'true',
            'cookiesAccepted': 'true',
            'gdprConsent': 'true',
            'privacyConsent': 'true',
            'acceptedCookies': 'all',
            'cookie-agreed': '2',
            'cookie_notice_accepted': 'true',

            // Quantcast
            'euconsent-v2': 'CPcHGAPcHGAP...',  // Simplified consent string

            // TrustArc
            'notice_preferences': '2:',
            'notice_gdpr_prefs': '0,1,2:',

            // Osano
            'osano_consentmanager': JSON.stringify({ consent: true }),

            // Usercentrics
            'uc_settings': JSON.stringify({ consent: { status: true } })
        };

        // LAYER 2: Common consent cookies
        this.consentCookies = [
            { name: 'cookieconsent_status', value: 'dismiss', domain: '' },
            { name: 'cookie_consent', value: 'true', domain: '' },
            { name: 'gdpr_consent', value: 'true', domain: '' },
            { name: 'cookies_accepted', value: 'all', domain: '' },
            { name: 'privacy_consent', value: 'accepted', domain: '' },
            { name: 'OptanonAlertBoxClosed', value: new Date().toISOString(), domain: '' },
            { name: 'CookieConsent', value: 'true', domain: '' }
        ];

        // LAYER 3: CSS selectors for overlays and banners
        this.overlaySelectors = [
            // ID-based selectors
            '[id*="cookie" i]',
            '[id*="consent" i]',
            '[id*="gdpr" i]',
            '[id*="privacy" i]',
            '[id*="banner" i]',
            '[id*="notice" i]',

            // Class-based selectors
            '[class*="cookie" i]',
            '[class*="consent" i]',
            '[class*="gdpr" i]',
            '[class*="privacy" i]',
            '[class*="banner" i]',
            '[class*="notice" i]',
            '[class*="overlay" i]',
            '[class*="modal" i]',

            // Specific known consent platforms
            '#onetrust-consent-sdk',
            '#CybotCookiebotDialog',
            '#cookiescript_injected',
            '.cc-window',
            '.cookie-banner',
            '.cookie-notice',
            '.gdpr-banner',
            '.privacy-notice',

            // Generic overlays
            '[role="dialog"][aria-label*="cookie" i]',
            '[role="dialog"][aria-label*="consent" i]',
            '[role="dialog"][aria-label*="privacy" i]'
        ];

        // LAYER 4: Element selector priority for clean content capture
        this.contentElementSelectors = [
            'main',
            'article',
            '#content',
            '#main-content',
            '[role="main"]',
            '.main-content',
            '.content',
            'body'
        ];

        // Statistics tracking
        this.stats = {
            blockedRequests: 0,
            injectedConsent: false,
            cssApplied: false,
            elementStrategy: null
        };
    }

    // ==========================================
    // LAYER 1: NETWORK-LEVEL BLOCKING
    // ==========================================

    /**
     * Setup network-level blocking to prevent consent provider scripts from loading
     * This is the PRIMARY defense layer - prevents most cookie banners from loading at all
     * 
     * @param {Page} page - Playwright page object
     * @returns {Promise<void>}
     */
    async setupNetworkBlocking(page) {
        if (!this.config.networkBlockingEnabled) {
            this.log('debug', 'Layer 1 (Network Blocking) is disabled');
            return;
        }

        try {
            await page.route('**/*', (route) => {
                const url = route.request().url().toLowerCase();
                const resourceType = route.request().resourceType();

                // Check if URL matches any consent provider pattern
                const shouldBlock = this.consentProviderPatterns.some(pattern =>
                    url.includes(pattern.toLowerCase())
                );

                if (shouldBlock && (resourceType === 'script' || resourceType === 'xhr' || resourceType === 'fetch' || resourceType === 'iframe')) {
                    this.stats.blockedRequests++;
                    this.log('debug', `Layer 1: Blocked ${resourceType} request to: ${url.substring(0, 100)}...`);
                    route.abort();
                } else {
                    route.continue();
                }
            });

            this.log('info', 'Layer 1 (Network Blocking) activated');
        } catch (error) {
            this.log('warn', `Layer 1 (Network Blocking) failed: ${error.message}`);
            // Don't throw - fail gracefully
        }
    }

    // ==========================================
    // LAYER 2: PRE-INJECT CONSENT STATE
    // ==========================================

    /**
     * Inject consent state into browser context BEFORE any page scripts execute
     * This simulates "consent already given" state
     * 
     * @param {BrowserContext} context - Playwright browser context
     * @param {string} domain - Optional domain for cookies (defaults to current domain)
     * @returns {Promise<void>}
     */
    async injectConsentState(context, domain = null) {
        try {
            // Inject localStorage values via init script
            // This runs BEFORE any page JavaScript executes
            await context.addInitScript(() => {
                // This code runs in the browser context before page load
                const consentData = {
                    // OneTrust
                    'OptanonConsent': 'groups=C0001:1,C0002:1,C0003:1,C0004:1&datestamp=' + new Date().toISOString(),
                    'OptanonAlertBoxClosed': new Date().toISOString(),

                    // Cookiebot
                    'CookieConsent': JSON.stringify({
                        necessary: true,
                        preferences: true,
                        statistics: true,
                        marketing: true,
                        stamp: Date.now()
                    }),

                    // Generic
                    'cookieConsent': 'true',
                    'cookiesAccepted': 'true',
                    'gdprConsent': 'true',
                    'privacyConsent': 'true',
                    'acceptedCookies': 'all',
                    'cookie-agreed': '2',
                    'cookie_notice_accepted': 'true'
                };

                // Inject into localStorage
                try {
                    Object.entries(consentData).forEach(([key, value]) => {
                        localStorage.setItem(key, value);
                    });
                } catch (e) {
                    // localStorage might not be available in some contexts
                }

                // Also set some common consent flags on window object
                window.cookieConsentGiven = true;
                window.gdprConsent = true;
                window.privacyAccepted = true;
            });

            this.stats.injectedConsent = true;
            this.log('info', 'Layer 2 (Consent Injection) activated - localStorage and window flags set');
        } catch (error) {
            this.log('warn', `Layer 2 (Consent Injection) failed: ${error.message}`);
            // Don't throw - fail gracefully
        }
    }

    /**
     * Inject consent cookies into a page (alternative to context-level injection)
     * Use this when you need to set cookies for a specific domain after navigation
     * 
     * @param {Page} page - Playwright page object
     * @param {string} domain - Domain for cookies
     * @returns {Promise<void>}
     */
    async injectConsentCookies(page, domain = null) {
        try {
            const currentUrl = page.url();
            const targetDomain = domain || new URL(currentUrl).hostname;

            const cookies = this.consentCookies.map(cookie => ({
                ...cookie,
                domain: cookie.domain || targetDomain,
                path: '/',
                expires: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 year
            }));

            await page.context().addCookies(cookies);
            this.log('debug', `Layer 2: Injected ${cookies.length} consent cookies for domain: ${targetDomain}`);
        } catch (error) {
            this.log('warn', `Layer 2 (Cookie Injection) failed: ${error.message}`);
        }
    }

    // ==========================================
    // LAYER 3: CSS-LEVEL OVERLAY REMOVAL
    // ==========================================

    /**
     * Inject global CSS to hide cookie banners and overlays
     * This is a visual failsafe that runs AFTER page load
     * 
     * @param {Page} page - Playwright page object
     * @returns {Promise<void>}
     */
    async applyOverlayCSS(page) {
        if (!this.config.cssInjectionEnabled) {
            this.log('debug', 'Layer 3 (CSS Injection) is disabled');
            return;
        }

        try {
            // Build comprehensive CSS rules to hide overlays
            const cssRules = this.overlaySelectors.map(selector =>
                `${selector} { display: none !important; visibility: hidden !important; opacity: 0 !important; }`
            ).join('\n');

            // Additional rules to ensure body scrolling works
            const additionalCSS = `
        body {
          overflow: auto !important;
          position: static !important;
        }
        html {
          overflow: auto !important;
        }
        /* Hide fixed/sticky overlays */
        [style*="position: fixed"][style*="z-index"],
        [style*="position: sticky"][style*="z-index"] {
          display: none !important;
        }
      `;

            const fullCSS = cssRules + '\n' + additionalCSS;

            // Inject CSS into page
            await page.addStyleTag({ content: fullCSS });

            this.stats.cssApplied = true;
            this.log('info', `Layer 3 (CSS Overlay Removal) activated - ${this.overlaySelectors.length} selectors hidden`);
        } catch (error) {
            this.log('warn', `Layer 3 (CSS Overlay Removal) failed: ${error.message}`);
            // Don't throw - fail gracefully
        }
    }

    // ==========================================
    // LAYER 4: ELEMENT-LEVEL SCREENSHOT CAPTURE
    // ==========================================

    /**
     * Find the best content element for clean screenshot capture
     * Prefers main content areas over full body to avoid overlays
     * 
     * @param {Page} page - Playwright page object
     * @returns {Promise<ElementHandle|null>} - Element to screenshot, or null for full page
     */
    async findCleanContentElement(page) {
        try {
            // Try each selector in priority order
            for (const selector of this.contentElementSelectors) {
                try {
                    const element = await page.$(selector);
                    if (element) {
                        const isVisible = await element.isVisible().catch(() => false);
                        if (isVisible) {
                            // Check if element has reasonable dimensions
                            const box = await element.boundingBox();
                            if (box && box.width > 300 && box.height > 200) {
                                this.stats.elementStrategy = selector;
                                this.log('debug', `Layer 4: Found clean content element using selector: ${selector}`);
                                return element;
                            }
                        }
                    }
                } catch (e) {
                    // Try next selector
                    continue;
                }
            }

            this.log('debug', 'Layer 4: No specific content element found, will use full page');
            return null;
        } catch (error) {
            this.log('warn', `Layer 4 (Element Selection) failed: ${error.message}`);
            return null;
        }
    }

    /**
     * Capture screenshot with element-level targeting
     * This method integrates Layer 4 into the screenshot process
     * 
     * @param {Page} page - Playwright page object
     * @param {ElementHandle} targetElement - Specific element to capture (optional)
     * @returns {Promise<Buffer>} - Screenshot buffer
     */
    async captureCleanScreenshot(page, targetElement = null) {
        try {
            // If no target element provided, try to find clean content element
            const element = targetElement || await this.findCleanContentElement(page);

            if (element) {
                // Capture specific element
                const screenshot = await element.screenshot({ type: 'png' });
                this.log('info', `Layer 4: Captured element screenshot using strategy: ${this.stats.elementStrategy}`);
                return screenshot;
            } else {
                // Fallback to full page
                const screenshot = await page.screenshot({ type: 'png', fullPage: true });
                this.log('info', 'Layer 4: Captured full page screenshot');
                return screenshot;
            }
        } catch (error) {
            this.log('error', `Layer 4 (Screenshot Capture) failed: ${error.message}`);
            throw error;
        }
    }

    // ==========================================
    // UTILITY METHODS
    // ==========================================

    /**
     * Apply all layers in sequence for a page
     * This is a convenience method that applies Layers 1, 3, and prepares for Layer 4
     * Note: Layer 2 must be applied at context level before page creation
     * 
     * @param {Page} page - Playwright page object
     * @returns {Promise<void>}
     */
    async applyAllLayers(page) {
        // Layer 1: Network blocking (must be done before navigation)
        await this.setupNetworkBlocking(page);

        // Note: Layer 2 should already be applied via context.addInitScript()

        // Layer 3: CSS overlay removal (done after page load)
        // This will be called after page.goto() in the main service

        // Layer 4: Element selection (done during screenshot capture)
        // This will be called when taking the screenshot
    }

    /**
     * Apply post-load layers (Layer 3)
     * Call this after page navigation completes
     * 
     * @param {Page} page - Playwright page object
     * @returns {Promise<void>}
     */
    async applyPostLoadLayers(page) {
        await this.applyOverlayCSS(page);
    }

    /**
     * Get statistics about which layers were activated
     * Useful for debugging and monitoring
     * 
     * @returns {Object} - Statistics object
     */
    getStats() {
        return {
            ...this.stats,
            summary: this.generateSummary()
        };
    }

    /**
     * Generate human-readable summary of layer effectiveness
     * 
     * @returns {string} - Summary message
     */
    generateSummary() {
        const parts = [];

        if (this.stats.blockedRequests > 0) {
            parts.push(`Layer 1 blocked ${this.stats.blockedRequests} consent requests`);
        }

        if (this.stats.injectedConsent) {
            parts.push('Layer 2 injected consent state');
        }

        if (this.stats.cssApplied) {
            parts.push('Layer 3 applied CSS overlay removal');
        }

        if (this.stats.elementStrategy) {
            parts.push(`Layer 4 used element strategy: ${this.stats.elementStrategy}`);
        }

        return parts.length > 0 ? parts.join(', ') : 'No layers activated';
    }

    /**
     * Reset statistics for new capture
     */
    resetStats() {
        this.stats = {
            blockedRequests: 0,
            injectedConsent: false,
            cssApplied: false,
            elementStrategy: null
        };
    }

    /**
     * Logging utility with level support
     * 
     * @param {string} level - Log level (debug, info, warn, error)
     * @param {string} message - Log message
     */
    log(level, message) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        const configLevel = levels[this.config.loggingLevel] || 1;
        const messageLevel = levels[level] || 1;

        if (messageLevel >= configLevel) {
            const prefix = '[CookieConsentHandler]';
            switch (level) {
                case 'error':
                    console.error(`${prefix} ERROR:`, message);
                    break;
                case 'warn':
                    console.warn(`${prefix} WARN:`, message);
                    break;
                case 'debug':
                    console.log(`${prefix} DEBUG:`, message);
                    break;
                default:
                    console.log(`${prefix}`, message);
            }
        }
    }

    /**
     * Add custom consent provider pattern to blocklist
     * Useful for extending the handler for specific sites
     * 
     * @param {string} pattern - Pattern to block (e.g., 'custom-consent-provider')
     */
    addConsentProviderPattern(pattern) {
        if (!this.consentProviderPatterns.includes(pattern)) {
            this.consentProviderPatterns.push(pattern);
            this.log('info', `Added custom consent provider pattern: ${pattern}`);
        }
    }

    /**
     * Add custom localStorage consent key
     * 
     * @param {string} key - localStorage key
     * @param {string} value - Value to set
     */
    addConsentLocalStorageKey(key, value) {
        this.consentLocalStorageKeys[key] = value;
        this.log('info', `Added custom consent localStorage key: ${key}`);
    }

    /**
     * Add custom CSS selector for overlay removal
     * 
     * @param {string} selector - CSS selector
     */
    addOverlaySelector(selector) {
        if (!this.overlaySelectors.includes(selector)) {
            this.overlaySelectors.push(selector);
            this.log('info', `Added custom overlay selector: ${selector}`);
        }
    }
}

module.exports = CookieConsentHandler;
