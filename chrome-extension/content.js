// Screenshot Stabilizer Content Script
// This script ensures DOM is fully rendered and UI elements are visible before screenshots

(function() {
    'use strict';

    // Force visibility of hidden elements that might be dynamically shown
    function forceVisibility() {
        const style = document.createElement('style');
        style.id = 'screenshot-stabilizer-styles';
        style.textContent = `
            /* Force visibility of common hidden elements */
            [style*="display: none"]:not([data-permanent-hidden]),
            [style*="visibility: hidden"]:not([data-permanent-hidden]),
            .hidden:not([data-permanent-hidden]),
            [hidden]:not([data-permanent-hidden]) {
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
            }
            
            /* Ensure overlays and modals are visible if they contain important content */
            .modal.show,
            .overlay.active,
            .popup.visible {
                display: block !important;
                visibility: visible !important;
            }
            
            /* Prevent lazy loading issues */
            img[loading="lazy"],
            iframe[loading="lazy"] {
                loading: eager !important;
            }
        `;
        
        if (!document.getElementById('screenshot-stabilizer-styles')) {
            document.head.appendChild(style);
        }
    }

    // Wait for fonts to load
    function waitForFonts() {
        return new Promise((resolve) => {
            if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(() => {
                    // Additional small delay to ensure font rendering is complete
                    setTimeout(resolve, 100);
                }).catch(() => {
                    // Fallback if fonts API fails
                    setTimeout(resolve, 500);
                });
            } else {
                // Fallback for browsers without Font Loading API
                setTimeout(resolve, 500);
            }
        });
    }

    // Wait for animations and transitions to complete
    function waitForAnimations() {
        return new Promise((resolve) => {
            // Get all elements with animations/transitions
            const animatedElements = document.querySelectorAll('*');
            let maxDuration = 0;
            
            animatedElements.forEach(el => {
                const style = window.getComputedStyle(el);
                const transitionDuration = parseFloat(style.transitionDuration) || 0;
                const animationDuration = parseFloat(style.animationDuration) || 0;
                const duration = Math.max(transitionDuration, animationDuration) * 1000; // Convert to ms
                maxDuration = Math.max(maxDuration, duration);
            });
            
            // Wait for the longest animation/transition plus a buffer
            setTimeout(resolve, maxDuration + 200);
        });
    }

    // Force load of lazy-loaded images and iframes
    function forceLoadLazyContent() {
        // Force load lazy images
        const lazyImages = document.querySelectorAll('img[loading="lazy"], img[data-src], img[data-lazy]');
        lazyImages.forEach(img => {
            if (img.dataset.src) {
                img.src = img.dataset.src;
            } else if (img.dataset.lazy) {
                img.src = img.dataset.lazy;
            }
            img.loading = 'eager';
        });

        // Force load lazy iframes
        const lazyIframes = document.querySelectorAll('iframe[loading="lazy"], iframe[data-src]');
        lazyIframes.forEach(iframe => {
            if (iframe.dataset.src) {
                iframe.src = iframe.dataset.src;
            }
            iframe.loading = 'eager';
        });
    }

    // Handle permission prompts (auto-accept common ones)
    function handlePermissions() {
        // This will be handled by the browser, but we can prepare the page
        // to be more permissive for screenshot purposes
        if (navigator.permissions) {
            // Request common permissions that might block rendering
            navigator.permissions.query({ name: 'notifications' }).catch(() => {});
        }
    }

    // Main initialization
    function initialize() {
        // Apply styles immediately
        forceVisibility();
        
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                forceLoadLazyContent();
                handlePermissions();
            });
        } else {
            forceLoadLazyContent();
            handlePermissions();
        }

        // Mark that stabilizer is ready
        window.screenshotStabilizerReady = true;
        
        // Expose utility functions for external use
        window.screenshotStabilizer = {
            waitForFonts,
            waitForAnimations,
            forceLoadLazyContent,
            ready: true
        };
    }

    // Start initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // Also run when page is fully loaded
    window.addEventListener('load', () => {
        forceLoadLazyContent();
        window.screenshotStabilizerFullyLoaded = true;
    });
})();




