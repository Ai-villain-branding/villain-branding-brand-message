const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

class WebCrawler {
    constructor(options = {}) {
        this.maxPages = options.maxPages || parseInt(process.env.MAX_CRAWL_PAGES) || 50;
        this.maxDepth = options.maxDepth || parseInt(process.env.MAX_CRAWL_DEPTH) || 3;
        this.crawlDelay = options.crawlDelay || parseInt(process.env.CRAWL_DELAY_MS) || 1000;
        this.timeout = options.timeout || parseInt(process.env.REQUEST_TIMEOUT_MS) || 30000;

        this.visited = new Set();
        this.queue = [];
        this.results = [];
        this.baseDomain = null;
    }

    // Priority scoring for different page types
    getPagePriority(url) {
        const urlLower = url.toLowerCase();

        // High priority pages
        if (urlLower === this.baseDomain || urlLower === this.baseDomain + '/') return 100;
        if (urlLower.includes('/about')) return 90;
        if (urlLower.includes('/product')) return 85;
        if (urlLower.includes('/service')) return 85;
        if (urlLower.includes('/solution')) return 80;
        if (urlLower.includes('/feature')) return 80;

        // Medium priority
        if (urlLower.includes('/pricing')) return 70;
        if (urlLower.includes('/case-stud')) return 65;
        if (urlLower.includes('/customer')) return 65;
        if (urlLower.includes('/blog')) return 60;
        if (urlLower.includes('/career')) return 55;
        if (urlLower.includes('/contact')) return 50;

        // Default priority
        return 40;
    }

    // Normalize and validate URL
    normalizeUrl(url, baseUrl) {
        try {
            const normalized = new URL(url, baseUrl);

            // Remove fragments
            normalized.hash = '';

            // Remove common tracking parameters
            const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'source'];
            trackingParams.forEach(param => normalized.searchParams.delete(param));

            return normalized.href;
        } catch (error) {
            return null;
        }
    }

    // Check if URL should be crawled
    shouldCrawl(url) {
        try {
            const urlObj = new URL(url);
            const baseDomainObj = new URL(this.baseDomain);

            // Must be same domain
            if (urlObj.hostname !== baseDomainObj.hostname) return false;

            // Skip common non-content URLs
            const skipPatterns = [
                /\.(pdf|jpg|jpeg|png|gif|svg|css|js|xml|json|zip|exe)$/i,
                /\/api\//,
                /\/download\//,
                /\/login/,
                /\/signup/,
                /\/register/,
                /\/auth/,
                /\/admin/,
                /\?.*page=/,  // Pagination
                /\/tag\//,
                /\/category\//,
                /\/author\//,
                /\/search/
            ];

            return !skipPatterns.some(pattern => pattern.test(url));
        } catch (error) {
            return false;
        }
    }

    // Extract links from HTML
    extractLinks(html, baseUrl) {
        const $ = cheerio.load(html);
        const links = new Set();

        $('a[href]').each((_, element) => {
            const href = $(element).attr('href');
            if (!href) return;

            const normalized = this.normalizeUrl(href, baseUrl);
            if (normalized && this.shouldCrawl(normalized)) {
                links.add(normalized);
            }
        });

        return Array.from(links);
    }

    // Get canonical URL from page
    getCanonicalUrl(html, pageUrl) {
        const $ = cheerio.load(html);
        const canonical = $('link[rel="canonical"]').attr('href');

        if (canonical) {
            return this.normalizeUrl(canonical, pageUrl);
        }

        return pageUrl;
    }

    // Fetch a single page
    async fetchPage(url) {
        try {
            const response = await axios.get(url, {
                timeout: this.timeout,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; BrandAnalyzer/1.0; +http://example.com/bot)',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                maxRedirects: 5,
                validateStatus: (status) => status >= 200 && status < 400
            });

            return {
                url: response.request.res.responseUrl || url,
                html: response.data,
                statusCode: response.status,
                contentType: response.headers['content-type'] || ''
            };
        } catch (error) {
            console.error(`Error fetching ${url}:`, error.message);
            return null;
        }
    }

    // Main crawl function
    async crawl(startUrl, onProgress) {
        this.baseDomain = new URL(startUrl).origin;
        this.visited.clear();
        this.queue = [];
        this.results = [];

        // Initialize queue with start URL
        this.queue.push({
            url: startUrl,
            depth: 0,
            priority: 100
        });

        while (this.queue.length > 0 && this.results.length < this.maxPages) {
            // Sort queue by priority
            this.queue.sort((a, b) => b.priority - a.priority);

            const { url, depth } = this.queue.shift();

            // Skip if already visited
            if (this.visited.has(url)) continue;

            // Mark as visited
            this.visited.add(url);

            // Fetch page
            const page = await this.fetchPage(url);

            if (!page) continue;

            // Check content type
            if (!page.contentType.includes('text/html')) continue;

            // Get canonical URL
            const canonicalUrl = this.getCanonicalUrl(page.html, page.url);

            // Skip if canonical is different and already visited
            if (canonicalUrl !== page.url && this.visited.has(canonicalUrl)) {
                continue;
            }

            // Add to results
            this.results.push({
                url: canonicalUrl,
                html: page.html,
                depth: depth,
                crawledAt: new Date().toISOString()
            });

            // Report progress
            if (onProgress) {
                onProgress({
                    crawled: this.results.length,
                    total: this.maxPages,
                    currentUrl: canonicalUrl
                });
            }

            // Extract and queue new links if not at max depth
            if (depth < this.maxDepth) {
                const links = this.extractLinks(page.html, canonicalUrl);

                for (const link of links) {
                    if (!this.visited.has(link) && !this.queue.find(item => item.url === link)) {
                        this.queue.push({
                            url: link,
                            depth: depth + 1,
                            priority: this.getPagePriority(link)
                        });
                    }
                }
            }

            // Delay between requests
            if (this.queue.length > 0 && this.results.length < this.maxPages) {
                await new Promise(resolve => setTimeout(resolve, this.crawlDelay));
            }
        }

        return this.results;
    }
}

module.exports = WebCrawler;
