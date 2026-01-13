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

    // 1c. Start Analysis with Streaming (Fetch + ReadableStream)
    analyzeStream: async (url, pages, mode, onProgress, onComplete, onError) => {
        const params = new URLSearchParams();
        if (url) params.append('url', url);
        if (mode) params.append('mode', mode);
        if (pages && pages.length > 0) params.append('pages', JSON.stringify(pages));

        try {
            const response = await fetch(`/api/analyze-stream?${params.toString()}`);

            if (!response.ok) {
                const errorText = await response.text();
                let errorMsg = `Server error: ${response.status}`;
                try {
                    const errorJson = JSON.parse(errorText);
                    errorMsg = errorJson.message || errorJson.error || errorMsg;
                } catch (e) {
                    // Use raw text if not JSON
                    if (errorText.length < 200) errorMsg = errorText;
                }
                throw new Error(errorMsg);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Process complete blocks (double newline separated)
                const blocks = buffer.split('\n\n');
                buffer = blocks.pop(); // Keep the last partial block

                for (const block of blocks) {
                    const lines = block.split('\n');
                    let eventType = 'message';
                    let data = null;

                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            eventType = line.substring(7).trim();
                        } else if (line.startsWith('data: ')) {
                            try {
                                data = JSON.parse(line.substring(6));
                            } catch (e) {
                                console.warn('Failed to parse SSE data:', line);
                            }
                        }
                    }

                    if (data) {
                        if (eventType === 'log' || eventType === 'progress') {
                            if (onProgress) onProgress({ type: eventType, ...data });
                        } else if (eventType === 'complete') {
                            if (onComplete) onComplete(data);
                            return; // Stop processing
                        } else if (eventType === 'error') {
                            throw new Error(data.message || 'Unknown error');
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Stream error:', error);
            if (onError) onError({ message: error.message });
        }
    },

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

// Override native alert and confirm with custom centered versions
window.alert = (message) => window.api.alert(message, 'Alert');
window.confirm = (message) => window.api.confirm(message, 'Confirm');
