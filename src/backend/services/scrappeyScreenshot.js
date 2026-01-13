const axios = require('axios');
const config = require('../config');

/**
 * @typedef {Object} ScreenshotOptions
 * @property {string} url - The target URL to capture
 * @property {boolean} [upload=false] - Whether to upload screenshot to Scrappey's CDN for a public URL
 * @property {number} [width=1920] - Screenshot width in pixels (default: 1920 for standard full-page size)
 * @property {number} [height=1080] - Screenshot height in pixels (default: 1080 for standard full-page size)
 */

/**
 * @typedef {Object} ScreenshotResult
 * @property {string} [base64] - Base64-encoded screenshot image (only if upload is false)
 * @property {string} [publicUrl] - Public URL to the uploaded screenshot (only if upload is true)
 * @property {string} finalURL - The final URL that was captured (may differ from input due to redirects)
 */

/**
 * Captures a full-page screenshot of a URL using Scrappey Web Screenshot + Anti-Bot API.
 * 
 * This service handles JavaScript-heavy pages, Cloudflare protection, and other anti-bot measures
 * through Scrappey's infrastructure. The anti-bot bypass is handled entirely by Scrappey - no
 * custom logic is needed on our end.
 * 
 * Performance Note: For production use, set `upload: true` to get a public CDN URL instead of
 * a large base64 string. This significantly reduces response payload size and improves performance.
 * 
 * @param {ScreenshotOptions} options - Screenshot capture options
 * @returns {Promise<ScreenshotResult>} Screenshot result with base64 or public URL
 * @throws {Error} If API key is missing, request fails, or response is invalid
 * 
 * @example
 * // Basic usage with base64 response
 * const result = await captureScreenshot({ url: 'https://example.com' });
 * console.log(result.base64); // Base64 image string
 * 
 * @example
 * // Production usage with public URL (recommended)
 * const result = await captureScreenshot({ 
 *   url: 'https://example.com',
 *   upload: true,
 *   width: 1920,
 *   height: 1080
 * });
 * console.log(result.publicUrl); // https://cdn.scrappey.com/...
 */
async function captureScreenshot(options) {
    const { url, upload = false, width = 1920, height = 1080 } = options;

    // Validate API key
    if (!config.scrappeyApiKey) {
        throw new Error('SCRAPPEY_API_KEY environment variable is required. Please set it in your .env file or Railway environment variables.');
    }

    // Log API key status (first few chars only for debugging)
    if (config.scrappeyApiKey && config.scrappeyApiKey.length > 0) {
        const keyPreview = config.scrappeyApiKey.substring(0, 10) + '...';
        console.log(`[Scrappey] Using API key: ${keyPreview} (length: ${config.scrappeyApiKey.length})`);
    }

    // Validate URL
    if (!url || typeof url !== 'string') {
        throw new Error('URL is required and must be a string');
    }

    // Basic URL format validation
    try {
        new URL(url);
    } catch (e) {
        throw new Error(`Invalid URL format: ${url}`);
    }

    // Default dimensions: 1920x1080 is a standard full-page screenshot size that works well
    // for most modern websites. It's wide enough to capture desktop layouts without being
    // too large, and tall enough to show meaningful content.
    const requestBody = {
        cmd: 'request.get',
        url: url,
        screenshot: true,
        screenshotUpload: upload,
        screenshotWidth: width,
        screenshotHeight: height
    };

    const apiUrl = `https://publisher.scrappey.com/api/v1?key=${config.scrappeyApiKey}`;

    try {
        console.log(`[Scrappey] Capturing screenshot of ${url} (${width}x${height}, upload: ${upload})`);
        console.log(`[Scrappey] Request body:`, JSON.stringify(requestBody));

        const response = await axios.post(apiUrl, requestBody, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 180000 // 180 second (3 minute) timeout for screenshot capture
        });

        // Validate HTTP response
        if (response.status !== 200) {
            throw new Error(`Scrappey API returned status ${response.status} for URL ${url}`);
        }

        // Validate response structure
        if (!response.data) {
            throw new Error(`Scrappey API returned empty response for URL ${url}`);
        }

        const data = response.data;

        // Check for API errors in response
        if (data.error || data.status === 'error') {
            const errorMessage = data.message || data.error || 'Unknown error from Scrappey API';
            throw new Error(`Scrappey API error for URL ${url}: ${errorMessage}`);
        }

        // Extract solution data
        if (!data.solution) {
            throw new Error(`Scrappey API response missing 'solution' field for URL ${url}`);
        }

        const solution = data.solution;
        const result = {
            finalURL: solution.url || url // Use final URL from API if available (handles redirects)
        };

        // Extract screenshot data based on upload preference
        if (upload && solution.screenshotUrl) {
            // Public URL from CDN (preferred for production)
            result.publicUrl = solution.screenshotUrl;
            console.log(`[Scrappey] Screenshot uploaded to: ${result.publicUrl}`);
        } else if (!upload && solution.screenshot) {
            // Base64 encoded image
            result.base64 = solution.screenshot;
            console.log(`[Scrappey] Screenshot captured as base64 (${result.base64.length} chars)`);
        } else {
            // Fallback: try to get whatever is available
            if (solution.screenshotUrl) {
                result.publicUrl = solution.screenshotUrl;
                console.log(`[Scrappey] Using screenshotUrl (upload was ${upload} but URL available)`);
            } else if (solution.screenshot) {
                result.base64 = solution.screenshot;
                console.log(`[Scrappey] Using base64 screenshot (upload was ${upload} but base64 available)`);
            } else {
                throw new Error(`Scrappey API response missing screenshot data for URL ${url}. Response: ${JSON.stringify(solution).substring(0, 200)}`);
            }
        }

        return result;

    } catch (error) {
        // Handle axios errors
        if (error.response) {
            // API returned error status
            const status = error.response.status;
            const statusText = error.response.statusText;
            const errorData = error.response.data;

            // Try to extract meaningful error message
            let errorMessage = 'Unknown error';
            if (typeof errorData === 'string') {
                errorMessage = errorData;
            } else if (errorData?.message) {
                errorMessage = errorData.message;
            } else if (errorData?.error) {
                errorMessage = typeof errorData.error === 'string' ? errorData.error : JSON.stringify(errorData.error);
            } else if (errorData?.data) {
                errorMessage = typeof errorData.data === 'string' ? errorData.data : JSON.stringify(errorData.data);
            } else if (statusText) {
                errorMessage = statusText;
            }

            // Log full error details for debugging
            console.error(`[Scrappey] API error for URL ${url}:`, {
                status,
                statusText,
                error: errorMessage,
                responseData: errorData,
                requestUrl: apiUrl.replace(config.scrappeyApiKey, 'KEY_REDACTED'),
                requestBody: JSON.stringify(requestBody)
            });

            // Provide more helpful error messages for common issues
            if (status === 500) {
                console.error(`[Scrappey] 500 Internal Server Error - This could indicate:`);
                console.error(`  - Invalid or expired API key`);
                console.error(`  - Scrappey service temporarily unavailable`);
                console.error(`  - URL is too heavily protected (e.g., ${url})`);
                console.error(`  - Request format issue`);
            }

            throw new Error(`Scrappey API error (${status}) for URL ${url}: ${errorMessage}`);
        } else if (error.request) {
            // Request was made but no response received
            console.error(`[Scrappey] No response received for URL ${url}:`, error.message);
            throw new Error(`Scrappey API request timeout or network error for URL ${url}: ${error.message}`);
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            // Network/DNS errors
            console.error(`[Scrappey] Network error for URL ${url}:`, error.message);
            throw new Error(`Scrappey API network error for URL ${url}: ${error.message}`);
        } else {
            // Other errors (validation, parsing, etc.)
            console.error(`[Scrappey] Error capturing screenshot of ${url}:`, error.message);
            throw error;
        }
    }
}

module.exports = {
    captureScreenshot,
    fetchContent
};

/**
 * Fetches the HTML content of a URL using Scrappey Anti-Bot API.
 * 
 * @param {string} url - The target URL to fetch
 * @returns {Promise<string>} The HTML content
 */
async function fetchContent(url) {
    // Validate API key
    if (!config.scrappeyApiKey) {
        throw new Error('SCRAPPEY_API_KEY environment variable is required.');
    }

    // Validate URL
    if (!url || typeof url !== 'string') {
        throw new Error('URL is required and must be a string');
    }

    const requestBody = {
        cmd: 'request.get',
        url: url,
        screenshot: false
    };

    const apiUrl = `https://publisher.scrappey.com/api/v1?key=${config.scrappeyApiKey}`;

    try {
        console.log(`[Scrappey] Fetching content for ${url}`);
        const response = await axios.post(apiUrl, requestBody, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 60000 // 60 second timeout
        });

        if (response.status !== 200) {
            throw new Error(`Scrappey API returned status ${response.status}`);
        }

        const data = response.data;
        if (data.error || data.status === 'error') {
            throw new Error(`Scrappey API error: ${data.message || data.error}`);
        }

        if (!data.solution) {
            throw new Error('Scrappey API response missing solution');
        }

        // Scrappey returns the HTML body in 'response' or 'body'
        return data.solution.response || data.solution.body || '';

    } catch (error) {
        console.error(`[Scrappey] Error fetching content for ${url}:`, error.message);
        throw error;
    }
}

