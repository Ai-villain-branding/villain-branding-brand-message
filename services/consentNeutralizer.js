/**
 * Consent Management Platform (CMP) Neutralizer
 * 
 * CRITICAL ARCHITECTURAL PRINCIPLE:
 * DO NOT block consent scripts (OneTrust, Cookiebot, etc.)
 * Many sites depend on them to unblock rendering.
 * 
 * Instead: Allow scripts to load but NEUTRALIZE their behavior
 * by overriding global consent APIs to immediately resolve as "granted"
 */

class ConsentNeutralizer {
    constructor(options = {}) {
        this.loggingLevel = options.loggingLevel || process.env.CONSENT_LOGGING_LEVEL || 'info';
        this.cssInjectionEnabled = options.cssInjectionEnabled !== false;

        // Track what we've done for debugging
        this.stats = {
            cmpNeutralized: false,
            consentStateInjected: false,
            cssApplied: false,
            allowedScripts: 0,
            blockedTrackers: 0,
            domReadinessAchieved: false
        };
    }

    /**
     * LAYER 1: CMP NEUTRALIZATION (PRIMARY FIX)
     * 
     * WHY: Sites like ClickUp depend on consent scripts to unblock rendering.
     * Blocking them causes blank pages. Instead, we let them load but override
     * their APIs to immediately return "consent granted" so banners don't block.
     * 
     * This runs BEFORE any page JavaScript executes via addInitScript()
     */
    getCMPNeutralizerScript() {
        return `
(function() {
    'use strict';
    
    // Prevent re-injection
    if (window.__cmpNeutralized) return;
    window.__cmpNeutralized = true;
    
    console.log('[CMP Neutralizer] Injecting consent API overrides');
    
    // ============================================================
    // IAB TCF (Transparency & Consent Framework) v2.0 Neutralization
    // ============================================================
    // WHY: Many CMPs use IAB TCF. We override __tcfapi to always return
    // "consent granted" so the CMP thinks user already consented.
    window.__tcfapi = function(command, version, callback, parameter) {
        console.log('[CMP Neutralizer] IAB TCF __tcfapi called:', command);
        
        if (command === 'ping') {
            callback({
                gdprApplies: false,
                cmpLoaded: true,
                cmpStatus: 'loaded',
                displayStatus: 'hidden',
                apiVersion: '2.0'
            }, true);
        } else if (command === 'getTCData') {
            callback({
                tcString: 'NEUTRALIZED',
                tcfPolicyVersion: 2,
                cmpId: 0,
                cmpVersion: 0,
                gdprApplies: false,
                eventStatus: 'tcloaded',
                cmpStatus: 'loaded',
                listenerId: null,
                isServiceSpecific: true,
                useNonStandardStacks: false,
                publisherCC: 'US',
                purposeOneTreatment: false,
                outOfBand: {
                    allowedVendors: {},
                    disclosedVendors: {}
                },
                purpose: {
                    consents: {},
                    legitimateInterests: {}
                },
                vendor: {
                    consents: {},
                    legitimateInterests: {}
                },
                specialFeatureOptins: {},
                publisher: {
                    consents: {},
                    legitimateInterests: {},
                    customPurpose: {
                        consents: {},
                        legitimateInterests: {}
                    },
                    restrictions: {}
                }
            }, true);
        } else if (command === 'addEventListener') {
            // Immediately fire callback with "consent granted"
            setTimeout(() => {
                callback({
                    eventStatus: 'tcloaded',
                    cmpStatus: 'loaded',
                    gdprApplies: false
                }, true);
            }, 0);
        } else {
            callback({}, true);
        }
    };
    
    // ============================================================
    // OneTrust Neutralization
    // ============================================================
    // WHY: OneTrust is the most common CMP. Sites check OneTrust.IsAlertBoxClosed()
    // to decide whether to show banner. We override to return "already closed".
    window.OneTrust = window.OneTrust || {};
    window.OneTrust.IsAlertBoxClosed = () => true;
    window.OneTrust.IsAlertBoxClosedAndValid = () => true;
    window.OneTrust.Close = () => {};
    window.OneTrust.AllowAll = () => {};
    window.OneTrust.RejectAll = () => {};
    window.OneTrust.ToggleInfoDisplay = () => {};
    
    // OneTrust callback queue - execute immediately
    window.OneTrust.OnConsentChanged = (callback) => {
        if (typeof callback === 'function') {
            setTimeout(callback, 0);
        }
    };
    
    // OptanonWrapper is called by OneTrust when ready
    // Override to prevent banner display logic
    window.OptanonWrapper = function() {
        console.log('[CMP Neutralizer] OptanonWrapper called - neutralized');
    };
    
    // ============================================================
    // Cookiebot Neutralization
    // ============================================================
    window.Cookiebot = window.Cookiebot || {};
    window.Cookiebot.consent = {
        marketing: true,
        statistics: true,
        preferences: true,
        necessary: true
    };
    window.Cookiebot.consented = true;
    window.Cookiebot.declined = false;
    window.Cookiebot.hasResponse = true;
    window.Cookiebot.show = () => {};
    window.Cookiebot.hide = () => {};
    window.Cookiebot.renew = () => {};
    window.Cookiebot.withdraw = () => {};
    
    // ============================================================
    // Quantcast Choice Neutralization
    // ============================================================
    window.__cmp = function(command, parameter, callback) {
        console.log('[CMP Neutralizer] Quantcast __cmp called:', command);
        
        if (command === 'ping') {
            callback({
                gdprAppliesGlobally: false,
                cmpLoaded: true
            }, true);
        } else if (command === 'getConsentData') {
            callback({
                consentData: 'NEUTRALIZED',
                gdprApplies: false,
                hasGlobalScope: false
            }, true);
        } else {
            callback({}, true);
        }
    };
    
    // ============================================================
    // Generic Consent Flags
    // ============================================================
    // WHY: Many sites check generic window flags to determine consent state
    window.cookieConsentGiven = true;
    window.gdprConsent = true;
    window.hasConsent = true;
    window.cookiesAccepted = true;
    window.privacyPolicyAccepted = true;
    
    // ============================================================
    // Segment Consent Wrapper Neutralization
    // ============================================================
    // WHY: Segment analytics often wraps consent checks
    if (window.analytics && window.analytics.load) {
        const originalLoad = window.analytics.load;
        window.analytics.load = function(...args) {
            console.log('[CMP Neutralizer] Segment analytics.load neutralized');
            // Allow load but don't let it block
            try {
                return originalLoad.apply(this, args);
            } catch (e) {
                console.warn('[CMP Neutralizer] Segment load error (suppressed):', e.message);
            }
        };
    }
    
    // ============================================================
    // Prevent Banner Display via MutationObserver
    // ============================================================
    // WHY: Even with API overrides, some CMPs still inject DOM elements.
    // We watch for common banner containers and hide them immediately.
    const bannerSelectors = [
        '#onetrust-consent-sdk',
        '#CybotCookiebotDialog',
        '.qc-cmp2-container',
        '[class*="cookie-banner"]',
        '[class*="consent-banner"]',
        '[id*="cookie-banner"]',
        '[id*="consent-banner"]'
    ];
    
    const hideBanners = () => {
        bannerSelectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                if (el && el.style) {
                    el.style.display = 'none';
                    el.style.visibility = 'hidden';
                    el.style.opacity = '0';
                    el.style.pointerEvents = 'none';
                }
            });
        });
    };
    
    // Run immediately and on DOM changes
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hideBanners);
    } else {
        hideBanners();
    }
    
    // Watch for dynamically added banners
    const observer = new MutationObserver(hideBanners);
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }
    
    console.log('[CMP Neutralizer] All consent APIs neutralized');
})();
        `.trim();
    }

    /**
     * LAYER 1: Inject CMP neutralizer into browser context
     * This runs BEFORE any page loads
     */
    async injectCMPNeutralizer(context) {
        try {
            await context.addInitScript(this.getCMPNeutralizerScript());
            this.stats.cmpNeutralized = true;
            this.log('info', 'Layer 1 (CMP Neutralization) activated');
            return true;
        } catch (error) {
            this.log('error', `Failed to inject CMP neutralizer: ${error.message}`);
            return false;
        }
    }

    /**
     * LAYER 2: CONSENT STATE PRE-INJECTION
     * 
     * WHY: Set localStorage and cookies BEFORE navigation so CMPs
     * detect "already handled" state and skip banner display logic
     */
    async injectConsentState(context) {
        try {
            // Common consent localStorage keys with "granted" values
            const consentScript = `
                // OneTrust consent
                localStorage.setItem('OptanonConsent', 'groups=C0001:1,C0002:1,C0003:1,C0004:1');
                localStorage.setItem('OptanonAlertBoxClosed', new Date().toISOString());
                
                // Cookiebot
                localStorage.setItem('CookieConsent', JSON.stringify({
                    necessary: true,
                    preferences: true,
                    statistics: true,
                    marketing: true,
                    stamp: Date.now()
                }));
                
                // Generic consent flags
                localStorage.setItem('cookieConsent', 'true');
                localStorage.setItem('gdprConsent', 'true');
                localStorage.setItem('cookiesAccepted', 'true');
                localStorage.setItem('privacyPolicyAccepted', 'true');
                
                console.log('[Consent State] Pre-injected consent localStorage');
            `;

            await context.addInitScript(consentScript);

            // Also set common consent cookies
            const cookies = [
                { name: 'cookieconsent_status', value: 'dismiss', domain: '.clickup.com' },
                { name: 'cookie_consent', value: 'true', domain: '.clickup.com' },
                { name: 'gdpr_consent', value: 'true', domain: '.clickup.com' },
                { name: 'OptanonAlertBoxClosed', value: new Date().toISOString(), domain: '.clickup.com' }
            ];

            // Try to add cookies (may fail if domain doesn't match, that's OK)
            for (const cookie of cookies) {
                try {
                    await context.addCookies([{
                        ...cookie,
                        path: '/',
                        expires: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 year
                    }]);
                } catch (e) {
                    // Domain mismatch is expected, ignore
                }
            }

            this.stats.consentStateInjected = true;
            this.log('info', 'Layer 2 (Consent State Pre-Injection) activated');
            return true;
        } catch (error) {
            this.log('error', `Failed to inject consent state: ${error.message}`);
            return false;
        }
    }

    /**
     * LAYER 3: SAFE NETWORK HANDLING (NO HARD BLOCKING)
     * 
     * WHY: We DO NOT block consent scripts anymore. Only block clearly
     * non-essential tracking (ads, heatmaps) that don't affect rendering.
     * 
     * CRITICAL: OneTrust, Cookiebot, etc. are ALLOWED to load
     */
    async setupSafeNetworkHandling(page) {
        try {
            await page.route('**/*', (route) => {
                const url = route.request().url();
                const resourceType = route.request().resourceType();

                // Only block clearly non-essential trackers
                const shouldBlock = (
                    // Ad networks
                    url.includes('doubleclick.net') ||
                    url.includes('googlesyndication.com') ||
                    url.includes('adservice.google') ||
                    // Heatmaps/session recording
                    url.includes('hotjar.com') ||
                    url.includes('mouseflow.com') ||
                    url.includes('fullstory.com') ||
                    url.includes('logrocket.com') ||
                    // Social media pixels
                    url.includes('facebook.net/en_US/fbevents.js') ||
                    url.includes('connect.facebook.net') ||
                    url.includes('twitter.com/i/adsct')
                );

                if (shouldBlock) {
                    this.stats.blockedTrackers++;
                    this.log('debug', `Blocked non-essential tracker: ${url.substring(0, 100)}...`);
                    route.abort();
                } else {
                    // ALLOW consent scripts and everything else
                    this.stats.allowedScripts++;
                    route.continue();
                }
            });

            this.log('info', 'Layer 3 (Safe Network Handling) activated - consent scripts ALLOWED');
            return true;
        } catch (error) {
            this.log('error', `Failed to setup network handling: ${error.message}`);
            return false;
        }
    }

    /**
     * LAYER 4: CSS OVERLAY REMOVAL (VISUAL FAILSAFE)
     * 
     * WHY: Even with API neutralization, some banners may still render.
     * CSS is a last-resort visual failsafe to hide them.
     */
    async applyOverlayCSS(page) {
        if (!this.cssInjectionEnabled) {
            return false;
        }

        try {
            const css = `
                /* OneTrust */
                #onetrust-consent-sdk,
                #onetrust-banner-sdk,
                .onetrust-pc-dark-filter,
                .optanon-alert-box-wrapper {
                    display: none !important;
                    visibility: hidden !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                }
                
                /* Cookiebot */
                #CybotCookiebotDialog,
                #CybotCookiebotDialogBodyUnderlay {
                    display: none !important;
                    visibility: hidden !important;
                }
                
                /* Quantcast */
                .qc-cmp2-container,
                #qc-cmp2-ui {
                    display: none !important;
                }
                
                /* Generic cookie banners */
                [class*="cookie-banner"],
                [class*="consent-banner"],
                [class*="gdpr-banner"],
                [id*="cookie-banner"],
                [id*="consent-banner"],
                [id*="gdpr-banner"],
                [class*="cookie-notice"],
                [class*="cookie-consent"],
                [role="dialog"][aria-label*="cookie" i],
                [role="dialog"][aria-label*="consent" i] {
                    display: none !important;
                    visibility: hidden !important;
                }
                
                /* Restore body scrolling (banners often disable it) */
                body {
                    overflow: auto !important;
                    position: static !important;
                }
                
                /* Remove overlay backgrounds */
                body::before,
                body::after {
                    display: none !important;
                }
            `;

            await page.addStyleTag({ content: css });
            this.stats.cssApplied = true;
            this.log('info', 'Layer 4 (CSS Overlay Removal) activated');
            return true;
        } catch (error) {
            this.log('error', `Failed to apply overlay CSS: ${error.message}`);
            return false;
        }
    }

    /**
     * LAYER 5: DOM-READINESS CHECK (NOT load-ready)
     * 
     * WHY: page.waitForLoadState('load') is unreliable for modern SPAs.
     * We wait for actual readable content to exist in the DOM.
     */
    async waitForReadableDOM(page, timeout = 30000) {
        try {
            const startTime = Date.now();

            while (Date.now() - startTime < timeout) {
                const hasContent = await page.evaluate(() => {
                    // Check for meaningful text content
                    const bodyText = (document.body?.innerText || '').trim();
                    const textLength = bodyText.length;

                    // Check for visible main content elements
                    const mainElements = document.querySelectorAll('main, article, [role="main"], #content, .content');
                    const hasVisibleMain = Array.from(mainElements).some(el => {
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    });

                    // Heuristic: Page is ready if we have >200 chars of text OR visible main content
                    return textLength > 200 || hasVisibleMain;
                });

                if (hasContent) {
                    this.stats.domReadinessAchieved = true;
                    this.log('info', 'Layer 5 (DOM Readiness) achieved - readable content detected');
                    return true;
                }

                // Wait a bit before checking again
                await page.waitForTimeout(500);
            }

            this.log('warn', 'Layer 5 (DOM Readiness) timeout - proceeding anyway');
            return false;
        } catch (error) {
            this.log('error', `DOM readiness check failed: ${error.message}`);
            return false;
        }
    }

    /**
     * LAYER 6: ELEMENT-LEVEL SCREENSHOT CAPTURE
     * 
     * WHY: Prefer capturing specific content elements instead of full page
     * to avoid overlays contaminating evidence
     */
    async captureElementScreenshot(page) {
        const selectors = [
            'main',
            'article',
            '[role="main"]',
            '#content',
            '#main-content',
            '.main-content',
            '.content',
            'body'
        ];

        for (const selector of selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    const isVisible = await element.isVisible().catch(() => false);
                    if (isVisible) {
                        this.log('debug', `Layer 6: Capturing element screenshot using selector: ${selector}`);
                        const screenshot = await element.screenshot();
                        return { buffer: screenshot, selector };
                    }
                }
            } catch (error) {
                // Try next selector
                continue;
            }
        }

        // Fallback to full page
        this.log('debug', 'Layer 6: Falling back to full page screenshot');
        const screenshot = await page.screenshot({ fullPage: true });
        return { buffer: screenshot, selector: 'fullPage' };
    }

    /**
     * LAYER 7: Service Worker Disablement
     * 
     * WHY: Service workers can interfere with headless capture
     */
    getServiceWorkerDisableScript() {
        return `
            // Disable service worker registration
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register = () => Promise.resolve();
                navigator.serviceWorker.getRegistration = () => Promise.resolve(undefined);
                navigator.serviceWorker.getRegistrations = () => Promise.resolve([]);
            }
        `;
    }

    /**
     * Get statistics about what was neutralized
     */
    getStats() {
        return {
            ...this.stats,
            summary: this.generateSummary()
        };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            cmpNeutralized: false,
            consentStateInjected: false,
            cssApplied: false,
            allowedScripts: 0,
            blockedTrackers: 0,
            domReadinessAchieved: false
        };
    }

    /**
     * Generate human-readable summary
     */
    generateSummary() {
        const parts = [];
        if (this.stats.cmpNeutralized) parts.push('CMP APIs neutralized');
        if (this.stats.consentStateInjected) parts.push('Consent state pre-injected');
        if (this.stats.cssApplied) parts.push('CSS overlays hidden');
        if (this.stats.allowedScripts > 0) parts.push(`${this.stats.allowedScripts} scripts allowed`);
        if (this.stats.blockedTrackers > 0) parts.push(`${this.stats.blockedTrackers} trackers blocked`);
        if (this.stats.domReadinessAchieved) parts.push('DOM readiness achieved');
        return parts.join(', ') || 'No actions taken';
    }

    /**
     * Logging helper
     */
    log(level, message) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        const currentLevel = levels[this.loggingLevel] || 1;
        const messageLevel = levels[level] || 1;

        if (messageLevel >= currentLevel) {
            console.log(`[ConsentNeutralizer] ${message}`);
        }
    }
}

module.exports = ConsentNeutralizer;
