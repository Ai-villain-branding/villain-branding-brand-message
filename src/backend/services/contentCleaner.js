/**
 * Content Cleaner Service
 * Ported from n8n "Code26" Node
 */

const removeHtmlTagsButKeepLinks = (htmlString) => {
    if (!htmlString || typeof htmlString !== "string") return ""; // Ensure valid input

    const linkRegex = /<a\s+[^>]*?href=(["'])(.*?)\1[^>]*>(.*?)<\/a>/gi;
    let links = [];

    // Preserve links by replacing them with placeholders
    htmlString = htmlString.replace(linkRegex, (match, quote, url, text) => {
        text = text.trim();
        if (!text) text = url; // If no anchor text, use URL
        links.push({ url, text });
        return `[[LINK-${links.length - 1}]]`; // Temporary placeholder
    });

    // Remove inline scripts, styles, and all HTML tags
    let textOnly = htmlString
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')  // Remove scripts
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')    // Remove styles
        .replace(/<\/?\w+[^>]*>/gi, '')                    // Remove remaining HTML tags
        .replace(/\s+/g, ' ')                              // Collapse multiple spaces
        .trim();

    // Restore links in "Text (URL)" format
    textOnly = textOnly.replace(/\[\[LINK-(\d+)\]\]/g, (match, index) => {
        let link = links[parseInt(index, 10)];
        return link ? `${link.text} (${link.url})` : "";
    });

    return textOnly;
};

// Export the function
module.exports = {
    cleanContent: removeHtmlTagsButKeepLinks
};
