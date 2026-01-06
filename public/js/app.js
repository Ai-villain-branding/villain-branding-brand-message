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
    }
};
