const cheerio = require('cheerio');

const removeHtmlTagsButKeepLinks = (htmlString) => {
    if (!htmlString || typeof htmlString !== "string") return ""; // Ensure valid input

    try {
        const $ = cheerio.load(htmlString);

        // Remove unwanted elements
        $('script, style, svg, iframe, noscript, meta, link, head').remove();

        // Process links: Append URL to text if it exists
        $('a').each((i, el) => {
            const $el = $(el);
            const href = $el.attr('href');
            const text = $el.text().trim();

            // Only modify if both text and href exist, and href is not a javascript/anchor link
            if (href && text && !href.startsWith('javascript:') && !href.startsWith('#')) {
                $el.text(`${text} (${href})`);
            }
        });

        // Get text and clean up whitespace
        return $.text()
            .replace(/\s+/g, ' ') // Collapse multiple spaces
            .trim();
    } catch (error) {
        console.error('Error in cleanContent:', error.message);
        return "";
    }
};

// Export the function
module.exports = {
    cleanContent: removeHtmlTagsButKeepLinks
};
