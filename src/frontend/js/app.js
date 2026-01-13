// API Client utilities
const API_BASE = '';

async function apiRequest(endpoint, options = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    });

    const data = await response.json().catch(() => ({ error: 'Request failed' }));

    // For screenshot generation, we want to return the response even if it's a 404
    // because failed attempts are now tracked in the database
    if (!response.ok && endpoint.includes('/api/screenshot') && response.status === 404) {
        // Return the error response as a result object
        return { success: false, ...data };
    }

    if (!response.ok) {
        throw new Error(data.error || data.details || `HTTP ${response.status}`);
    }

    return data;
}

// Export for use in other scripts
window.api = {
    // 1. Start Analysis (Full Website)
    analyzeWebsite: (url) => apiRequest('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({ url, mode: 'full' })
    }),

    // 1b. Start Analysis (Specific Pages)
    analyzeSpecificPages: (baseUrl, pages) => apiRequest('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({ url: baseUrl, pages: pages, mode: 'specific' })
    }),

    // 2. Get Companies
    getCompanies: () => apiRequest('/api/companies'),

    // 2b. Get Companies with Proof Counts
    getCompaniesWithEvidences: () => apiRequest('/api/companies-with-proofs'),

    // 2c. Delete Company
    deleteCompany: (companyId) => apiRequest(`/api/company/${companyId}`, {
        method: 'DELETE'
    }),

    // 3. Get Company Messages
    getCompanyMessages: (companyId) => apiRequest(`/api/company/${companyId}/messages`),

    // 3b. Get Company Categories with Messages
    getCompanyCategories: (companyId) => apiRequest(`/api/company/${companyId}/categories`),

    // 3c. Delete Message (and all associated screenshots)
    deleteMessage: (messageId) => apiRequest(`/api/message/${messageId}`, {
        method: 'DELETE'
    }),

    // 4. Generate Screenshot
    generateScreenshot: (companyId, messageId, url, text) => apiRequest('/api/screenshot', {
        method: 'POST',
        body: JSON.stringify({ companyId, messageId, url, text })
    }),

    // 5. Get Screenshots
    getScreenshots: (companyId) => apiRequest(`/api/company/${companyId}/screenshots`),

    // 6. Delete Screenshot
    deleteScreenshot: (screenshotId) => apiRequest(`/api/screenshot/${screenshotId}`, {
        method: 'DELETE'
    }),

    // 7. Update Screenshot (with cropped image)
    updateScreenshot: (screenshotId, base64Image) => apiRequest(`/api/screenshot/${screenshotId}`, {
        method: 'PUT',
        body: JSON.stringify({ image: base64Image })
    }),

    // 7b. Copy Screenshot (save cropped image as new screenshot)
    copyScreenshot: (screenshotId, base64Image) => apiRequest(`/api/screenshot/${screenshotId}/copy`, {
        method: 'POST',
        body: JSON.stringify({ image: base64Image })
    }),

    // Helper: Get Company ID from URL
    getCompanyId: () => new URLSearchParams(window.location.search).get('id'),

    // Helper: Update Nav Links
    updateNavLinks: (companyId) => {
        // Find MESSAGES link - try by ID first, then by text content
        let navMessages = document.getElementById('navMessages');
        if (!navMessages) {
            // Find by text content if ID doesn't exist
            const allNavLinks = document.querySelectorAll('a.nav-link');
            navMessages = Array.from(allNavLinks).find(a => a.textContent.trim() === 'MESSAGES');
        }

        // Find EVIDENCES link - try by ID first, then by text content
        let navEvidences = document.getElementById('navEvidences');
        if (!navEvidences) {
            const allNavLinks = document.querySelectorAll('a.nav-link');
            navEvidences = Array.from(allNavLinks).find(a => a.textContent.trim() === 'EVIDENCES');
        }

        // MESSAGES always points to companies list page
        if (navMessages) navMessages.href = `companies.html`;

        // EVIDENCES always points to main proofs page (companies-proofs.html)
        if (navEvidences) navEvidences.href = `companies-proofs.html`;
    },

    // Custom Centered Alert Dialog
    alert: (message, title = 'Alert') => {
        return new Promise((resolve) => {
            // Remove existing dialog if any
            const existing = document.getElementById('custom-dialog-overlay');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = 'custom-dialog-overlay';
            overlay.className = 'custom-dialog-overlay';

            overlay.innerHTML = `
                <div class="custom-dialog">
                    <div class="custom-dialog-title">${title}</div>
                    <div class="custom-dialog-message">${message}</div>
                    <div class="custom-dialog-buttons">
                        <button class="btn-primary" onclick="this.closest('.custom-dialog-overlay').remove(); window.customDialogResolve && window.customDialogResolve();">OK</button>
                    </div>
                </div>
            `;

            window.customDialogResolve = resolve;
            document.body.appendChild(overlay);

            // Trigger animation
            setTimeout(() => overlay.classList.add('active'), 10);

            // Close on Escape key
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    overlay.remove();
                    window.customDialogResolve = null;
                    document.removeEventListener('keydown', escapeHandler);
                    resolve();
                }
            };
            document.addEventListener('keydown', escapeHandler);
        });
    },

    // Custom Centered Confirm Dialog
    confirm: (message, title = 'Confirm') => {
        return new Promise((resolve) => {
            // Remove existing dialog if any
            const existing = document.getElementById('custom-dialog-overlay');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = 'custom-dialog-overlay';
            overlay.className = 'custom-dialog-overlay';

            overlay.innerHTML = `
                <div class="custom-dialog">
                    <div class="custom-dialog-title">${title}</div>
                    <div class="custom-dialog-message">${message}</div>
                    <div class="custom-dialog-buttons">
                        <button class="btn-secondary" onclick="this.closest('.custom-dialog-overlay').remove(); window.customDialogResolve && window.customDialogResolve(false); window.customDialogResolve = null;">Cancel</button>
                        <button class="btn-primary" onclick="this.closest('.custom-dialog-overlay').remove(); window.customDialogResolve && window.customDialogResolve(true); window.customDialogResolve = null;">OK</button>
                    </div>
                </div>
            `;

            window.customDialogResolve = resolve;
            document.body.appendChild(overlay);

            // Trigger animation
            setTimeout(() => overlay.classList.add('active'), 10);

            // Close on Escape key (cancels)
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    overlay.remove();
                    window.customDialogResolve(false);
                    window.customDialogResolve = null;
                    document.removeEventListener('keydown', escapeHandler);
                }
            };
            document.addEventListener('keydown', escapeHandler);
        });
    }
};

/**
 * Process items in batches with controlled concurrency, retries, and delays
 * @param {Array} items - Array of items to process
 * @param {Function} processor - Async function that processes a single item: (item, index) => Promise
 * @param {Object} options - Configuration options
 * @param {number} options.batchSize - Number of concurrent items to process (default: 2)
 * @param {number} options.delayBetweenBatches - Delay in ms between batches (default: 1500)
 * @param {number} options.delayWithinBatch - Delay in ms between items within a batch (default: 200)
 * @param {number} options.maxRetries - Maximum number of retries for failed items (default: 2)
 * @param {number} options.retryDelay - Initial delay in ms for retries, uses exponential backoff (default: 1000)
 * @param {Function} options.shouldRetry - Function to determine if an item should be retried: (result) => boolean
 * @param {Function} options.onProgress - Progress callback: (current, total, item) => void
 * @returns {Promise<Array>} Array of results in the same order as input items
 */
async function processInBatches(items, processor, options = {}) {
    const {
        batchSize = 2,
        delayBetweenBatches = 1500,
        delayWithinBatch = 200,
        maxRetries = 2,
        retryDelay = 1000,
        shouldRetry = (result) => result && !result.success,
        onProgress = null
    } = options;

    const results = new Array(items.length);
    const total = items.length;
    let completed = 0;

    // Helper function to process a single item with retries
    async function processWithRetry(item, globalIndex, attempt = 0) {
        try {
            const result = await processor(item, globalIndex);

            // Check if result indicates failure and should be retried
            if (shouldRetry(result) && attempt < maxRetries) {
                const delay = retryDelay * Math.pow(2, attempt); // Exponential backoff
                console.log(`[${globalIndex + 1}/${total}] Retry ${attempt + 1}/${maxRetries} after ${delay}ms delay...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return processWithRetry(item, globalIndex, attempt + 1);
            }

            return result;
        } catch (error) {
            // Retry on exceptions if we haven't exceeded max retries
            if (attempt < maxRetries) {
                const delay = retryDelay * Math.pow(2, attempt); // Exponential backoff
                console.log(`[${globalIndex + 1}/${total}] Exception occurred, retry ${attempt + 1}/${maxRetries} after ${delay}ms delay...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return processWithRetry(item, globalIndex, attempt + 1);
            }
            // Max retries exceeded, return error result
            return { success: false, error: error.message || String(error) };
        }
    }

    // Process items in batches
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchIndexes = batch.map((_, idx) => i + idx);

        // Process current batch with staggered starts and retries
        const batchPromises = batch.map(async (item, batchIdx) => {
            const globalIndex = batchIndexes[batchIdx];

            // Stagger the start of each item within the batch
            if (batchIdx > 0) {
                await new Promise(resolve => setTimeout(resolve, delayWithinBatch * batchIdx));
            }

            try {
                const result = await processWithRetry(item, globalIndex);
                results[globalIndex] = result;
                return { index: globalIndex, success: true, result };
            } catch (error) {
                results[globalIndex] = { success: false, error: error.message || String(error) };
                return { index: globalIndex, success: false, error: error.message || String(error) };
            } finally {
                completed++;
                if (onProgress) {
                    onProgress(completed, total, item);
                }
            }
        });

        // Wait for current batch to complete
        await Promise.all(batchPromises);

        // Add delay between batches (except after the last batch)
        if (i + batchSize < items.length) {
            console.log(`Batch ${Math.floor(i / batchSize) + 1} completed, waiting ${delayBetweenBatches}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
        }
    }

    return results;
}

// Export batch processing utility
window.api.processInBatches = processInBatches;

// Override native alert and confirm with custom centered versions
window.alert = (message) => window.api.alert(message, 'Alert');
window.confirm = (message) => window.api.confirm(message, 'Confirm');
