const cheerio = require('cheerio');

class ContentExtractor {
    constructor() {
        // Selectors for elements to remove
        this.removeSelectors = [
            'script',
            'style',
            'noscript',
            'svg',
            'canvas',

            // Navigation
            'nav',
            'header',
            'footer',
            '[role="navigation"]',
            '[role="banner"]',
            '[role="contentinfo"]',
            '.nav',
            '.navbar',
            '.navigation',
            '.menu',
            '.breadcrumb',
            '.breadcrumbs',

            // Clutter
            '.cookie',
            '.cookies',
            '.cookie-banner',
            '.cookie-consent',
            '.gdpr',
            '.popup',
            '.modal',
            '.overlay',
            '.advertisement',
            '.ad',
            '.ads',
            '.social-share',
            '.share-buttons',
            '.sidebar',
            '.widget',
            '.related-posts',
            '.comments',
            '.comment-section',

            // Forms (usually not brand messaging)
            'form[action*="search"]',
            'form[action*="subscribe"]',
            'form[action*="newsletter"]'
        ];
    }

    // Extract metadata from page
    extractMetadata($, url) {
        const metadata = {
            url: url,
            title: '',
            description: '',
            h1: [],
            keywords: []
        };

        // Title
        metadata.title = $('title').first().text().trim() ||
            $('meta[property="og:title"]').attr('content') || '';

        // Description
        metadata.description = $('meta[name="description"]').attr('content') ||
            $('meta[property="og:description"]').attr('content') || '';

        // H1 tags
        $('h1').each((_, el) => {
            const text = $(el).text().trim();
            if (text) metadata.h1.push(text);
        });

        // Keywords
        const keywordsContent = $('meta[name="keywords"]').attr('content');
        if (keywordsContent) {
            metadata.keywords = keywordsContent.split(',').map(k => k.trim());
        }

        return metadata;
    }

    // Clean and normalize text
    normalizeText(text) {
        return text
            // Collapse multiple spaces
            .replace(/\s+/g, ' ')
            // Remove excessive line breaks
            .replace(/\n\s*\n\s*\n/g, '\n\n')
            // Trim
            .trim();
    }

    // Extract text content with context
    extractTextWithContext($, element) {
        const texts = [];

        // Process different content types
        const contentSelectors = [
            { selector: 'h1', type: 'heading', weight: 5 },
            { selector: 'h2', type: 'heading', weight: 4 },
            { selector: 'h3', type: 'heading', weight: 3 },
            { selector: '[class*="hero"]', type: 'hero', weight: 5 },
            { selector: '[class*="banner"]', type: 'banner', weight: 4 },
            { selector: '[class*="cta"]', type: 'cta', weight: 4 },
            { selector: '[class*="feature"]', type: 'feature', weight: 3 },
            { selector: '[class*="benefit"]', type: 'benefit', weight: 3 },
            { selector: '[class*="value"]', type: 'value', weight: 4 },
            { selector: 'p', type: 'paragraph', weight: 2 },
            { selector: 'li', type: 'list', weight: 2 },
            { selector: '[class*="tagline"]', type: 'tagline', weight: 5 },
            { selector: '[class*="slogan"]', type: 'slogan', weight: 5 },
            { selector: 'section', type: 'section', weight: 2 },
            { selector: 'article', type: 'article', weight: 3 },
            { selector: '.main', type: 'main', weight: 2 }
        ];

        contentSelectors.forEach(({ selector, type, weight }) => {
            $(selector).each((_, el) => {
                const text = this.normalizeText($(el).text());

                // Relaxed constraints: 5 to 2000 chars
                if (text.length < 5 || text.length > 2000) return;

                // Skip if it's just a link
                if ($(el).is('a') && $(el).text().length === text.length) return;

                // Avoid duplicates
                if (texts.some(t => t.text.includes(text.substring(0, 50)))) return;

                texts.push({
                    text: text,
                    type: type,
                    weight: weight
                });
            });
        });

        return texts;
    }

    // Main extraction function
    extract(html, url) {
        const $ = cheerio.load(html);

        // Remove unwanted elements
        this.removeSelectors.forEach(selector => {
            $(selector).remove();
        });

        // Extract metadata
        const metadata = this.extractMetadata($, url);

        // Extract main content
        const mainContent = $('main, [role="main"], article, .content, .main-content, #content, #main').first();
        const contentElement = mainContent.length > 0 ? mainContent : $('body');

        // Extract text with context
        const textBlocks = this.extractTextWithContext($, contentElement);

        // Fallback: If too little content, try to find the largest text container
        if (textBlocks.length === 0 || textBlocks.reduce((sum, b) => sum + b.text.length, 0) < 500) {
            const bodyText = this.normalizeText($('body').text());
            if (bodyText.length > 500) {
                // Find the element with the most text that isn't the body itself
                let bestElement = $('body');
                let maxLen = 0;

                $('div, section, article').each((_, el) => {
                    const t = $(el).text().trim();
                    if (t.length > maxLen && t.length < bodyText.length * 0.9) {
                        maxLen = t.length;
                        bestElement = $(el);
                    }
                });

                const fallbackText = this.normalizeText(bestElement.text());
                if (fallbackText.length > 500) {
                    textBlocks.push({
                        text: fallbackText.substring(0, 5000),
                        type: 'fallback',
                        weight: 1
                    });
                }
            }
        }

        // Combine everything
        const result = {
            url: url,
            metadata: metadata,
            textBlocks: textBlocks,
            extractedAt: new Date().toISOString()
        };

        return result;
    }

    // Extract from multiple pages
    extractFromPages(pages) {
        return pages.map(page => {
            try {
                return this.extract(page.html, page.url);
            } catch (error) {
                console.error(`Error extracting content from ${page.url}:`, error.message);
                return null;
            }
        }).filter(result => result !== null);
    }
}

module.exports = ContentExtractor;
