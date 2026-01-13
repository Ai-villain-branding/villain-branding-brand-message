const axios = require('axios');
const { analyzeLinks } = require('./linkAnalyzer');
const { cleanContent } = require('./contentCleaner');
const { classifyContent } = require('./classifier');
const supabase = require('./supabase');
const { v4: uuidv4 } = require('uuid');
const { categorizeMessages } = require('./messageCategorizer');
const ContentExtractor = require('./contentExtractor');

/**
 * Orchestrates the full analysis workflow for a company
 * @param {string} companyUrl - The URL of the company to analyze
 * @param {Array<string>} specificPages - Optional array of specific pages to analyze (if provided, only these pages will be analyzed)
 * @returns {Promise<Object>} - The analysis result
 */
async function runAnalysisWorkflow(companyUrl, specificPages = null) {
    console.log(`Starting analysis for: ${companyUrl}`);
    if (specificPages) {
        console.log(`Specific pages mode: Analyzing ${specificPages.length} pages`);
    }

    const contentExtractor = new ContentExtractor();

    try {
        // 1. Create or Get Company in Supabase
        let companyId;
        const { data: existingCompany } = await supabase
            .from('companies')
            .select('id')
            .eq('url', companyUrl)
            .single();

        // Determine analysis mode
        const analysisMode = specificPages && specificPages.length > 0 ? 'specific_pages' : 'full_website';
        const pagesCount = specificPages ? specificPages.length : null;

        if (existingCompany) {
            companyId = existingCompany.id;
            console.log(`Found existing company ID: ${companyId}`);
            // Update analysis mode if it changed
            await supabase
                .from('companies')
                .update({
                    analysis_mode: analysisMode,
                    pages_analyzed: pagesCount
                })
                .eq('id', companyId);
        } else {
            const domain = new URL(companyUrl).hostname;
            const { data: newCompany, error: createError } = await supabase
                .from('companies')
                .insert({
                    url: companyUrl,
                    domain: domain,
                    name: domain,
                    analysis_mode: analysisMode,
                    pages_analyzed: pagesCount
                })
                .select()
                .single();

            if (createError) throw createError;
            companyId = newCompany.id;
            console.log(`Created new company ID: ${companyId}`);
        }

        // 2. Determine Pages to Visit
        let uniquePages;

        if (specificPages && specificPages.length > 0) {
            // Mode: Specific pages only - use the provided pages
            console.log('Using specific pages provided by user');
            uniquePages = [...new Set(specificPages)]; // Remove duplicates
            console.log(`Analyzing ${uniquePages.length} specific pages:`, uniquePages);
        } else {
            // Mode: Full website scraping - discover pages automatically
            console.log('Fetching homepage for link analysis...');
            const fetchResult = await fetchHtml(companyUrl);
            const homepageHtml = fetchResult.html;

            console.log('Analyzing links...');
            const linkAnalysisResult = await analyzeLinks(homepageHtml, companyUrl, fetchResult.links);
            console.log('Link Analysis Result:', JSON.stringify(linkAnalysisResult, null, 2));

            // Determine Pages to Visit (Analyze all pages)
            const pagesToVisit = new Set([companyUrl]); // Always include homepage

            // Add all pages from link analysis
            if (linkAnalysisResult.homepage) linkAnalysisResult.homepage.forEach(url => pagesToVisit.add(url));
            if (linkAnalysisResult.about_pages) linkAnalysisResult.about_pages.forEach(url => pagesToVisit.add(url));
            if (linkAnalysisResult.product_pages) linkAnalysisResult.product_pages.forEach(url => pagesToVisit.add(url));
            if (linkAnalysisResult.insights_pages) linkAnalysisResult.insights_pages.forEach(url => pagesToVisit.add(url));
            if (linkAnalysisResult.careers_pages) linkAnalysisResult.careers_pages.forEach(url => pagesToVisit.add(url));

            uniquePages = Array.from(pagesToVisit);
            console.log(`Identified ${uniquePages.length} pages to visit:`, uniquePages);
        }

        // 4. Process Each Page
        let allMessages = [];
        const pageContents = []; // Store all page contents for cross-page analysis

        // First pass: Collect all page contents
        for (const pageUrl of uniquePages) {
            try {
                console.log(`[fetchHtml] Fetching page: ${pageUrl}`);

                // Add a small delay to be nice to APIs
                await new Promise(resolve => setTimeout(resolve, 1000));

                const fetchResult = await fetchHtml(pageUrl);
                const html = fetchResult.html;
                console.log(`[Content] Raw HTML length: ${html.length} chars`);

                let extracted;
                if (fetchResult.extractedContent && fetchResult.extractedContent.length > 500) {
                    console.log(`[Content] Using pre-extracted content from Playwright (${fetchResult.extractedContent.length} chars)`);
                    extracted = {
                        metadata: fetchResult.metadata || { title: '', description: '', h1: [] },
                        textBlocks: [{ text: fetchResult.extractedContent, type: 'pre-extracted', weight: 5 }]
                    };
                } else {
                    extracted = contentExtractor.extract(html, pageUrl);
                }

                // Build weighted content
                let weightedContent = '';

                if (extracted.metadata.title) {
                    weightedContent += `TITLE: ${extracted.metadata.title}\n\n`;
                }
                if (extracted.metadata.description) {
                    weightedContent += `DESCRIPTION: ${extracted.metadata.description}\n\n`;
                }
                if (extracted.metadata.h1 && extracted.metadata.h1.length > 0) {
                    weightedContent += `H1 HEADINGS: ${extracted.metadata.h1.join(' | ')}\n\n`;
                }

                // Sort text blocks by weight descending
                const sortedBlocks = extracted.textBlocks.sort((a, b) => b.weight - a.weight);
                sortedBlocks.forEach(block => {
                    weightedContent += `${block.text}\n`;
                });

                const cleanedContent = weightedContent.trim();
                console.log(`[Content] Extracted content length: ${cleanedContent.length} chars`);
                console.log(`[Content] Text blocks extracted: ${extracted.textBlocks.length}`);

                // Enhanced content validation
                if (cleanedContent.length < 500) {
                    console.warn(`[Content] ❌ Insufficient content extracted from ${pageUrl}: ${cleanedContent.length} chars (min 500 required)`);
                    continue;
                }

                // Meaningful text check (strip special characters)
                const meaningfulText = cleanedContent.replace(/[^\w\s]/g, '').trim();
                if (meaningfulText.length < 300) {
                    console.warn(`[Content] ❌ Insufficient meaningful content from ${pageUrl}: ${meaningfulText.length} chars (min 300 required)`);
                    continue;
                }

                console.log(`[Content] ✅ Content validation passed for ${pageUrl}: ${cleanedContent.length} chars`);

                pageContents.push({
                    url: pageUrl,
                    content: cleanedContent
                });
            } catch (err) {
                console.error(`[Content] Error fetching/extracting page ${pageUrl}:`, err.message);
            }
        }

        // Second pass: Analyze all pages together so AI can find messages across all pages
        // Build a structured object with all page contents
        const allPagesData = {};
        pageContents.forEach(page => {
            allPagesData[page.url] = page.content;
        });

        // Pre-AI validation gate
        if (pageContents.length === 0) {
            console.error(`[Content] ❌ FATAL: No valid content extracted from any pages for ${companyUrl}`);
            console.error(`[Content] Total pages attempted: ${uniquePages.length}`);
            console.error(`[Content] All pages either failed to fetch or had insufficient content. This usually indicates bot protection, JavaScript-heavy site, or network issues.`);

            return {
                companyId,
                messageCount: 0,
                pagesVisited: uniquePages.length,
                error: 'No valid content extracted - site may require special handling'
            };
        }

        console.log(`[Content] ✅ Content validation passed: ${pageContents.length} pages with valid content`);
        const totalContentLength = Object.values(allPagesData).reduce((sum, content) => sum + content.length, 0);
        console.log(`[Content] Total content length: ${totalContentLength.toLocaleString()} chars`);
        console.log(`[Content] Average per page: ${Math.round(totalContentLength / pageContents.length).toLocaleString()} chars`);

        try {
            console.log(`[AI] Analyzing all ${pageContents.length} pages together to find cross-page messages...`);

            // Pass all page contents together so AI can search for messages across all pages
            // Wrap in try-catch to return empty results on error instead of throwing
            let classificationResult;
            try {
                classificationResult = await classifyContent(allPagesData, Object.keys(allPagesData));
            } catch (err) {
                console.error(`[AI] Error during AI classification:`, err.message);
                classificationResult = { messages: [] };
            }

            // Post-AI classification check for zero results
            if (!classificationResult || !classificationResult.messages || classificationResult.messages.length === 0) {
                console.warn(`[AI] ⚠️ AI returned 0 messages with strict mode`);
                console.warn(`[AI] Attempting RELAXED MODE as fallback (TODO: implement relaxed mode classifier)`);
                console.warn(`[AI] Content available: ${totalContentLength.toLocaleString()} chars across ${pageContents.length} pages`);
                console.error(`[AI] ❌ No messages extracted even with available content. This indicates AI guidelines may be too strict. Suggest manual review, guideline relaxation, or domain-specific prompts.`);
            }

            if (classificationResult && classificationResult.messages) {
                // The AI should return messages with all locations where they appear
                // But we'll also do a verification pass to ensure we catch all occurrences
                const messagesWithVerifiedLocations = [];

                for (const msg of classificationResult.messages) {
                    const messageText = msg.Message;
                    const reportedLocations = Array.isArray(msg.Locations) ? [...msg.Locations] : [];

                    // Verify and find all actual occurrences across all pages
                    const verifiedLocations = new Set(reportedLocations);

                    // Normalize message for searching (remove punctuation, normalize whitespace)
                    const normalizeForSearch = (text) => {
                        return text.toLowerCase()
                            .trim()
                            .replace(/[^\w\s]/g, '') // Remove punctuation
                            .replace(/\s+/g, ' '); // Normalize whitespace
                    };

                    const normalizedMessage = normalizeForSearch(messageText);

                    // Search for this message text in all pages
                    for (const pageData of pageContents) {
                        const normalizedContent = normalizeForSearch(pageData.content);

                        // Check if message appears in this page's content
                        // Use word boundary matching for better accuracy
                        const messageWords = normalizedMessage.split(' ').filter(w => w.length > 0);
                        if (messageWords.length > 0) {
                            // Check if all significant words appear in the content
                            const allWordsFound = messageWords.every(word =>
                                normalizedContent.includes(word)
                            );

                            // Also check if the full phrase appears (for exact matches)
                            const fullPhraseFound = normalizedContent.includes(normalizedMessage);

                            if (allWordsFound || fullPhraseFound) {
                                verifiedLocations.add(pageData.url);
                            }
                        }
                    }

                    // Convert Set to Array and use verified locations
                    const finalLocations = Array.from(verifiedLocations);

                    messagesWithVerifiedLocations.push({
                        ...msg,
                        Locations: finalLocations,
                        Count: finalLocations.length
                    });
                }

                allMessages = messagesWithVerifiedLocations;
                console.log(`[AI] Found ${allMessages.length} messages across all pages`);
            }

        } catch (err) {
            console.error(`[AI] Fatal error during analysis:`, err.message);
            // Return empty results as requested for robustness
            allMessages = [];
        }

        // 5. Save Messages to Supabase (Batched)
        console.log(`Saving ${allMessages.length} messages to Supabase...`);

        // Helper function to normalize message content for comparison
        // Handles case, punctuation, and whitespace differences
        function normalizeMessageContent(text) {
            return text
                .toLowerCase()
                .trim()
                .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
                .replace(/[^\w\s]/g, '') // Remove punctuation for comparison
                .trim();
        }

        // First, check for existing messages in database to avoid duplicates
        const { data: existingMessages } = await supabase
            .from('brand_messages')
            .select('*')
            .eq('company_id', companyId);

        // Clean up existing duplicates in database
        if (existingMessages && existingMessages.length > 0) {
            console.log('Checking for existing duplicates in database...');
            const duplicateGroups = new Map();

            existingMessages.forEach(msg => {
                const normalized = normalizeMessageContent(msg.content);
                const key = `${msg.message_type}-${normalized}`;

                if (!duplicateGroups.has(key)) {
                    duplicateGroups.set(key, []);
                }
                duplicateGroups.get(key).push(msg);
            });

            // Merge duplicates
            for (const [key, messages] of duplicateGroups.entries()) {
                if (messages.length > 1) {
                    console.log(`Found ${messages.length} duplicate messages for key: ${key}, merging...`);

                    // Keep the first message, merge others into it
                    const primary = messages[0];
                    const toMerge = messages.slice(1);

                    // Collect all unique locations
                    let allLocations = [...(primary.locations || [])];
                    toMerge.forEach(msg => {
                        if (msg.locations) {
                            allLocations = [...allLocations, ...msg.locations];
                        }
                    });
                    const uniqueLocations = [...new Set(allLocations)];

                    // Update primary message
                    await supabase
                        .from('brand_messages')
                        .update({
                            locations: uniqueLocations,
                            count: uniqueLocations.length
                        })
                        .eq('id', primary.id);

                    // Delete duplicate messages
                    const duplicateIds = toMerge.map(m => m.id);
                    await supabase
                        .from('brand_messages')
                        .delete()
                        .in('id', duplicateIds);

                    console.log(`Merged ${toMerge.length} duplicates into message ID: ${primary.id}`);
                }
            }
        }

        const existingMessagesMap = new Map();
        if (existingMessages) {
            existingMessages.forEach(msg => {
                const normalized = normalizeMessageContent(msg.content);
                const key = `${msg.message_type}-${normalized}`;
                if (!existingMessagesMap.has(key)) {
                    existingMessagesMap.set(key, msg);
                }
            });
        }

        // Deduplicate messages based on content and type
        const uniqueMessages = [];
        const seenMessages = new Set();

        for (const msg of allMessages) {
            const type = msg['Message Type'];
            const content = msg.Message;
            // Normalize for case-insensitive, punctuation-insensitive comparison
            const normalizedContent = normalizeMessageContent(content);
            const key = `${type}-${normalizedContent}`;

            // Check if this message already exists in database
            if (existingMessagesMap.has(key)) {
                const existingDbMsg = existingMessagesMap.get(key);
                // Update existing message with new locations
                const newLocations = msg.Locations || [];
                const mergedLocations = [...new Set([...existingDbMsg.locations, ...newLocations])];

                // Update in database
                await supabase
                    .from('brand_messages')
                    .update({
                        locations: mergedLocations,
                        count: mergedLocations.length
                    })
                    .eq('id', existingDbMsg.id);

                continue; // Skip adding to uniqueMessages since it already exists
            }

            if (!seenMessages.has(key)) {
                seenMessages.add(key);
                const locations = msg.Locations || [];
                uniqueMessages.push({
                    company_id: companyId,
                    message_type: type,
                    content: content, // Preserve original casing from first occurrence
                    count: locations.length || 1, // Count should match number of locations
                    reasoning: msg.Reasoning,
                    locations: locations
                });
            } else {
                // Use normalized comparison to find existing message
                const existing = uniqueMessages.find(m => {
                    const existingNormalized = normalizeMessageContent(m.content);
                    return existingNormalized === normalizedContent && m.message_type === type;
                });
                if (existing) {
                    // Merge locations and update count to match locations length
                    if (msg.Locations) {
                        existing.locations = [...new Set([...existing.locations, ...msg.Locations])];
                    }
                    // Count should reflect the number of unique locations
                    existing.count = existing.locations.length;
                }
            }
        }

        if (uniqueMessages.length > 0) {
            // Batch inserts to avoid timeouts (chunk size 50)
            const chunkSize = 50;
            for (let i = 0; i < uniqueMessages.length; i += chunkSize) {
                const chunk = uniqueMessages.slice(i, i + chunkSize);
                console.log(`Inserting batch ${Math.floor(i / chunkSize) + 1}/${Math.ceil(uniqueMessages.length / chunkSize)}...`);

                const { error: insertError } = await supabase
                    .from('brand_messages')
                    .insert(chunk);

                if (insertError) {
                    console.error('Error inserting batch:', insertError);
                    // Continue to next batch instead of failing everything
                }
            }
        }

        // 6. Categorize Messages with AI
        try {
            console.log('Starting AI categorization...');
            // Fetch all messages for this company (including existing ones)
            const { data: allCompanyMessages, error: fetchError } = await supabase
                .from('brand_messages')
                .select('id, content, message_type, reasoning')
                .eq('company_id', companyId);

            if (!fetchError && allCompanyMessages && allCompanyMessages.length > 0) {
                await categorizeMessages(companyId, allCompanyMessages);
                console.log('AI categorization completed successfully.');
            } else {
                console.log('No messages found for categorization.');
            }
        } catch (categorizationError) {
            // Don't fail the workflow if categorization fails
            console.error('Categorization failed (workflow continues):', categorizationError.message);
        }

        console.log('Analysis workflow completed successfully.');
        return {
            companyId,
            messageCount: uniqueMessages.length,
            pagesVisited: uniquePages.length
        };

    } catch (error) {
        console.error('Workflow failed:', error);
        throw error;
    }
}

/**
 * Fetches HTML from a URL, trying axios first and falling back to Playwright for JS-heavy sites
 * @param {string} url - The URL to fetch
 * @param {boolean} usePlaywright - Whether to use Playwright for rendering
 * @returns {Promise<Object>} - Object containing html, extractedContent, and links
 */
async function fetchHtml(url, usePlaywright = false) {
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    if (!usePlaywright) {
        try {
            console.log(`[fetchHtml] Trying axios for ${url}`);
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': userAgent
                },
                timeout: 15000,
                maxRedirects: 5
            });

            const html = response.data;

            // Validate content quality
            if (html.length < 1000) {
                console.warn(`[fetchHtml] Axios returned insufficient content (${html.length} chars), trying Playwright...`);
                return await fetchHtml(url, true);
            }

            // Check for JavaScript requirement indicators
            const jsIndicators = ['window.INITIAL_STATE', 'data-react-helmet', 'NEXT_DATA'];
            const hasJsIndicator = jsIndicators.some(indicator => html.includes(indicator));
            const noscriptCount = (html.match(/<noscript/g) || []).length;

            if (hasJsIndicator || noscriptCount > 3) {
                console.log(`[fetchHtml] Page appears to require JavaScript, using Playwright...`);
                return await fetchHtml(url, true);
            }

            console.log(`[fetchHtml] Axios success: ${html.length} chars`);
            return { html, extractedContent: null, links: null };
        } catch (error) {
            console.error(`[fetchHtml] Axios failed: ${error.message}, trying Playwright...`);
            return await fetchHtml(url, true);
        }
    } else {
        console.log(`[fetchHtml] Using Playwright for ${url}`);
        let browser;
        try {
            const { chromium } = require('playwright');
            browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            const context = await browser.newContext({
                userAgent: userAgent,
                viewport: { width: 1440, height: 900 }
            });

            const page = await context.newPage();

            // Apply stealth
            await page.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                window.chrome = { runtime: {} };
            });

            // Block analytics to speed up loading
            await page.route('**/*', (route) => {
                const url = route.request().url().toLowerCase();
                const blockedDomains = ['google-analytics.com', 'googletagmanager.com', 'facebook.com/tr', 'doubleclick.net'];
                if (blockedDomains.some(d => url.includes(d))) {
                    return route.abort();
                }
                return route.continue();
            });

            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });

            // Wait for page to stabilize
            await page.waitForTimeout(3000);

            // Scroll to trigger lazy loading
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight * 0.5);
            });
            await page.waitForTimeout(2000);
            await page.evaluate(() => {
                window.scrollTo(0, 0);
            });
            await page.waitForTimeout(2000);

            // Wait for content to appear
            try {
                await page.waitForFunction(
                    () => document.body.innerText.length > 500,
                    { timeout: 15000 }
                );
            } catch (e) {
                console.log(`[fetchHtml] Warning: Page content < 500 chars after wait.`);
            }

            // Extract content using simple innerText
            const extractionResult = await page.evaluate(() => {
                const results = {
                    content: '',
                    links: [],
                    title: document.title,
                    description: document.querySelector('meta[name="description"]')?.content || ''
                };

                const seenLinks = new Set();
                const baseHost = window.location.hostname;

                // Capture all links
                document.querySelectorAll('a[href]').forEach(a => {
                    try {
                        const url = new URL(a.href);
                        if (url.hostname === baseHost && !seenLinks.has(a.href)) {
                            seenLinks.add(a.href);
                            results.links.push({
                                text: (a.innerText || a.textContent || '').trim().substring(0, 100),
                                href: a.href
                            });
                        }
                    } catch (e) { }
                });

                // Capture visible text from main content areas
                const contentSelectors = [
                    'main', 'article', '[role="main"]', '.content', '#content',
                    '.hero', '.banner', 'section', '.main-content'
                ];

                let mainContent = '';
                for (const selector of contentSelectors) {
                    const el = document.querySelector(selector);
                    if (el && el.innerText) {
                        mainContent += el.innerText + '\n';
                    }
                }

                // Fallback to body if still not enough
                if (mainContent.length < 500) {
                    mainContent = document.body.innerText || document.body.textContent || '';
                }

                // Clean up the content
                results.content = mainContent
                    .replace(/\s+/g, ' ')
                    .substring(0, 50000);

                return results;
            });

            const html = await page.content();
            console.log(`[fetchHtml] Playwright success: ${html.length} chars HTML, ${extractionResult.content.length} chars extracted content`);

            return {
                html,
                extractedContent: extractionResult.content,
                links: extractionResult.links,
                metadata: {
                    title: extractionResult.title,
                    description: extractionResult.description
                }
            };
        } catch (error) {
            console.error(`[fetchHtml] Playwright failed for ${url}: ${error.message}`);
            throw error;
        } finally {
            if (browser) {
                try {
                    await browser.close();
                } catch (closeError) {
                    console.error(`[fetchHtml] Error closing browser: ${closeError.message}`);
                }
            }
        }
    }
}

module.exports = { runAnalysisWorkflow };
