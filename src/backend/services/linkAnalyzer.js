const OpenAI = require('openai');
const cheerio = require('cheerio');
const config = require('../config');

const openai = new OpenAI({
    apiKey: config.openaiApiKey,
});

const SYSTEM_PROMPT = `# HTML Link Categorizer
You are an expert at identifying the most important pages on a company website for brand analysis.
Categorize the provided links into the following structure. 

## Categories:
- homepage: The main landing page.
- product_pages: Pages describing specific products, services, or solutions.
- about_pages: Pages about the company, mission, values, or leadership.
- contact_pages: Contact or support pages.
- insights_pages: Blogs, news, or resource libraries.
- careers_pages: Job openings and culture.

## Rules:
1. Return ONLY valid JSON.
2. Use absolute URLs.
3. Limit each category to the top 5 most relevant links.
4. If no links fit, return an empty array.

Output Schema:
{
  "homepage": [],
  "product_pages": [],
  "about_pages": [],
  "contact_pages": [],
  "insights_pages": [],
  "careers_pages": []
}`;

/**
 * Analyzes links using a hybrid approach (Cheerio + GPT-4o-mini)
 * @param {string} htmlContent - Raw HTML of the page
 * @param {string} baseUrl - The base URL of the website
 * @param {Array} preExtractedLinks - Optional links already extracted by Playwright
 * @returns {Promise<Object>} - Categorized links
 */
async function analyzeLinks(htmlContent, baseUrl, preExtractedLinks = null) {
    try {
        const $ = cheerio.load(htmlContent);
        const links = [];
        const seen = new Set();
        const baseHostname = new URL(baseUrl).hostname;

        // Add pre-extracted links first
        if (preExtractedLinks && Array.isArray(preExtractedLinks)) {
            preExtractedLinks.forEach(link => {
                try {
                    const absoluteUrl = new URL(link.href, baseUrl).href;
                    const urlObj = new URL(absoluteUrl);
                    if (urlObj.hostname === baseHostname && !seen.has(absoluteUrl)) {
                        seen.add(absoluteUrl);
                        links.push({ text: link.text.substring(0, 50), href: absoluteUrl });
                    }
                } catch (e) { }
            });
        }

        $('a').each((i, el) => {
            let href = $(el).attr('href');
            const text = $(el).text().trim();

            if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

            try {
                const absoluteUrl = new URL(href, baseUrl).href;
                const urlObj = new URL(absoluteUrl);

                // Only include links from the same domain
                if (urlObj.hostname === baseHostname && !seen.has(absoluteUrl)) {
                    seen.add(absoluteUrl);
                    links.push({ text: text.substring(0, 50), href: absoluteUrl });
                }
            } catch (e) {
                // Ignore malformed URLs
            }
        });

        // Truncate links list to avoid token limits (max 100 links for categorization)
        const truncatedLinks = links.slice(0, 100);

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                {
                    role: "user",
                    content: JSON.stringify({
                        main_website: baseUrl,
                        links: truncatedLinks
                    })
                }
            ],
            temperature: 0,
            response_format: { type: "json_object" }
        });

        return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
        console.error("Error in Link Analyzer:", error.message);
        // Fallback to basic categorization if AI fails
        return {
            homepage: [baseUrl],
            product_pages: [],
            about_pages: [],
            contact_pages: [],
            insights_pages: [],
            careers_pages: []
        };
    }
}

module.exports = { analyzeLinks };
