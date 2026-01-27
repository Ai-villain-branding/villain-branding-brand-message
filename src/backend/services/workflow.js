const axios = require('axios');
const { analyzeLinks } = require('./linkAnalyzer');
const { cleanContent } = require('./contentCleaner');
const { classifyContent } = require('./classifier');
const supabase = require('./supabase');
const { v4: uuidv4 } = require('uuid');
const { categorizeMessages } = require('./messageCategorizer');
const ScreenshotService = require('./screenshotService');
const { rateLimiter, generateRandomFingerprint, generateHeaders } = require('./antiDetection');

/**
 * Orchestrates the full analysis workflow for a company
 * @param {string} companyUrl - The URL of the company to analyze
 * @param {Array<string>} specificPages - Optional array of specific pages to analyze (if provided, only these pages will be analyzed)
 * @param {Function} progressCallback - Optional callback for progress updates: (type, message, progress) => void
 * @returns {Promise<Object>} - The analysis result
 */
async function runAnalysisWorkflow(companyUrl, specificPages = null, progressCallback = null) {
    // Helper function to send progress updates
    const sendProgress = (type, message, progress = null) => {
        console.log(`[${type}] ${message}${progress !== null ? ` (${progress}%)` : ''}`);
        if (progressCallback) {
            progressCallback(type, message, progress);
        }
    };

    sendProgress('log', `Starting analysis for: ${companyUrl}`, 0);
    if (specificPages) {
        sendProgress('log', `Specific pages mode: Analyzing ${specificPages.length} pages`);
    }

    try {
        // 1. Create or Get Company in Supabase
        sendProgress('log', 'Setting up company record...', 5);
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
            sendProgress('log', `Found existing company ID: ${companyId}`);
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
            sendProgress('log', `Created new company ID: ${companyId}`);
        }

        // 2. Determine Pages to Visit
        sendProgress('log', 'Discovering pages to analyze...', 10);
        let uniquePages;

        if (specificPages && specificPages.length > 0) {
            // Mode: Specific pages only - use the provided pages
            sendProgress('log', 'Using specific pages provided by user');
            uniquePages = [...new Set(specificPages)]; // Remove duplicates
            sendProgress('log', `Analyzing ${uniquePages.length} specific pages`);
        } else {
            // Mode: Full website scraping - discover pages automatically
            sendProgress('log', 'Fetching homepage for link analysis...');
            const homepageHtml = await fetchHtml(companyUrl);

            // Debug: Log content length to diagnose blocked pages
            sendProgress('log', `Homepage content fetched: ${homepageHtml ? homepageHtml.length : 0} characters`);

            // Check if we got meaningful content
            if (!homepageHtml || homepageHtml.length < 1000) {
                sendProgress('log', `WARNING: Homepage content seems too short (${homepageHtml ? homepageHtml.length : 0} chars) - page may be blocked`);
            }

            sendProgress('log', 'Analyzing links to discover pages...', 15);
            const linkAnalysisResult = await analyzeLinks(homepageHtml, companyUrl);

            // Debug: Log what links were found
            const totalLinksFound = Object.values(linkAnalysisResult).flat().length;
            sendProgress('log', `Link analysis found ${totalLinksFound} links across categories`);
            if (linkAnalysisResult.about_pages?.length > 0) {
                sendProgress('log', `  - About pages: ${linkAnalysisResult.about_pages.length}`);
            }
            if (linkAnalysisResult.product_pages?.length > 0) {
                sendProgress('log', `  - Product pages: ${linkAnalysisResult.product_pages.length}`);
            }

            // Determine Pages to Visit (Analyze all pages)
            const pagesToVisit = new Set([companyUrl]); // Always include homepage

            // Add all pages from link analysis
            if (linkAnalysisResult.homepage) linkAnalysisResult.homepage.forEach(url => pagesToVisit.add(url));
            if (linkAnalysisResult.about_pages) linkAnalysisResult.about_pages.forEach(url => pagesToVisit.add(url));
            if (linkAnalysisResult.product_pages) linkAnalysisResult.product_pages.forEach(url => pagesToVisit.add(url));
            if (linkAnalysisResult.insights_pages) linkAnalysisResult.insights_pages.forEach(url => pagesToVisit.add(url));
            if (linkAnalysisResult.careers_pages) linkAnalysisResult.careers_pages.forEach(url => pagesToVisit.add(url));

            uniquePages = Array.from(pagesToVisit);
            sendProgress('log', `Discovered ${uniquePages.length} pages to analyze`, 20);
        }

        // 4. Process Each Page
        let allMessages = [];
        const pageContents = []; // Store all page contents for cross-page analysis

        // First pass: Collect all page contents
        const totalPages = uniquePages.length;
        for (let i = 0; i < totalPages; i++) {
            const pageUrl = uniquePages[i];
            const pageProgress = 20 + Math.floor((i / totalPages) * 30); // 20-50%
            try {
                sendProgress('log', `Fetching page ${i + 1}/${totalPages}: ${pageUrl}`, pageProgress);

                // Add a small delay to be nice to APIs
                await new Promise(resolve => setTimeout(resolve, 1000));

                const html = await fetchHtml(pageUrl);
                const cleanedContent = cleanContent(html);

                // Debug: Log content sizes
                sendProgress('log', `  Raw HTML: ${html ? html.length : 0} chars, Cleaned: ${cleanedContent.length} chars`);

                // Skip if content is too short
                if (cleanedContent.length < 100) {
                    sendProgress('log', `Skipping ${pageUrl} - content too short (${cleanedContent.length} chars)`);
                    continue;
                }

                pageContents.push({
                    url: pageUrl,
                    content: cleanedContent
                });
            } catch (err) {
                sendProgress('log', `Error fetching ${pageUrl}: ${err.message}`);
            }
        }

        // Second pass: Analyze all pages together so AI can find messages across all pages
        sendProgress('log', 'Analyzing content with AI...', 55);
        // Build a structured object with all page contents
        const allPagesData = {};
        pageContents.forEach(page => {
            allPagesData[page.url] = page.content;
        });

        try {
            sendProgress('log', `Analyzing all ${pageContents.length} pages together to find cross-page messages...`, 60);

            // Pass all page contents together so AI can search for messages across all pages
            const classificationResult = await classifyContent(allPagesData, Object.keys(allPagesData));

            if (classificationResult && classificationResult.messages) {
                sendProgress('log', `AI found ${classificationResult.messages.length} potential messages`, 70);
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
                sendProgress('log', `Verified ${allMessages.length} messages across all pages`, 75);
            }

        } catch (err) {
            sendProgress('log', `Error analyzing pages: ${err.message}`);
            // Fallback: analyze pages individually if batch analysis fails
            sendProgress('log', 'Falling back to individual page analysis...');
            const allUrls = pageContents.map(p => p.url);

            for (const pageData of pageContents) {
                try {
                    sendProgress('log', `Analyzing page: ${pageData.url}`);
                    const classificationResult = await classifyContent(pageData.content, allUrls);

                    if (classificationResult && classificationResult.messages) {
                        const messagesWithLocation = classificationResult.messages.map(msg => {
                            const locations = Array.isArray(msg.Locations) ? [...msg.Locations] : [];
                            if (!locations.includes(pageData.url)) {
                                locations.push(pageData.url);
                            }
                            return {
                                ...msg,
                                Locations: locations,
                                Count: locations.length
                            };
                        });
                        allMessages = allMessages.concat(messagesWithLocation);
                    }

                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (pageErr) {
                    sendProgress('log', `Error analyzing page ${pageData.url}: ${pageErr.message}`);
                }
            }
        }

        // 5. Save Messages to Supabase (Batched)
        sendProgress('log', `Saving ${allMessages.length} messages to database...`, 80);

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
            sendProgress('log', 'Checking for existing duplicates in database...');
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
                    sendProgress('log', `Found ${messages.length} duplicate messages, merging...`);

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
            sendProgress('log', `Inserting ${uniqueMessages.length} new messages...`, 85);
            // Batch inserts to avoid timeouts (chunk size 50)
            const chunkSize = 50;
            for (let i = 0; i < uniqueMessages.length; i += chunkSize) {
                const chunk = uniqueMessages.slice(i, i + chunkSize);
                sendProgress('log', `Inserting batch ${Math.floor(i / chunkSize) + 1}/${Math.ceil(uniqueMessages.length / chunkSize)}...`);

                const { error: insertError } = await supabase
                    .from('brand_messages')
                    .insert(chunk);

                if (insertError) {
                    sendProgress('log', `Error inserting batch: ${insertError.message}`);
                    // Continue to next batch instead of failing everything
                }
            }
        }

        // 6. Categorize Messages with AI
        try {
            sendProgress('log', 'Starting AI categorization...', 90);
            // Fetch all messages for this company (including existing ones)
            const { data: allCompanyMessages, error: fetchError } = await supabase
                .from('brand_messages')
                .select('id, content, message_type, reasoning')
                .eq('company_id', companyId);

            if (!fetchError && allCompanyMessages && allCompanyMessages.length > 0) {
                await categorizeMessages(companyId, allCompanyMessages);
                sendProgress('log', 'AI categorization completed successfully.', 95);
            } else {
                sendProgress('log', 'No messages found for categorization.');
            }
        } catch (categorizationError) {
            // Don't fail the workflow if categorization fails
            sendProgress('log', `Categorization failed (workflow continues): ${categorizationError.message}`);
        }

        sendProgress('log', 'Analysis workflow completed successfully.', 100);
        return {
            companyId,
            messageCount: uniqueMessages.length,
            pagesVisited: uniquePages.length
        };

    } catch (error) {
        // Provide more helpful error messages for DNS errors
        let errorMessage = error.message;
        if (error.code === 'ENOTFOUND' || error.message.includes('ENOTFOUND') || error.message.includes('ERR_NAME_NOT_RESOLVED')) {
            errorMessage = error.message || `Cannot resolve domain. The domain name may be incorrect or the website may be down.`;
        }
        sendProgress('error', `Workflow failed: ${errorMessage}`);
        throw error;
    }
}

async function fetchHtml(url, retryAttempt = 0) {
    const screenshotService = new ScreenshotService(); // Create new instance for each request
    const maxRetries = 3;
    const timeout = parseInt(process.env.REQUEST_TIMEOUT_MS) || 30000;

    try {
        // Use Playwright for robust fetching (handles dynamic content & anti-bot)
        console.log(`Fetching HTML for ${url} using Playwright (Attempt ${retryAttempt + 1}/${maxRetries})...`);
        const content = await screenshotService.fetchPageContent(url);
        if (content && content.length > 0) {
            return content;
        }
        throw new Error('Playwright returned empty content');
    } catch (playwrightError) {
        console.warn(`Playwright fetch failed for ${url}, falling back to axios:`, playwrightError.message);

        // Check for DNS errors early (before trying axios)
        const isDnsError = playwrightError.message.includes('ERR_NAME_NOT_RESOLVED') ||
                          playwrightError.message.includes('net::ERR_NAME_NOT_RESOLVED');

        if (isDnsError) {
            // Extract domain from URL for better error message
            let domain = url;
            try {
                const urlObj = new URL(url);
                domain = urlObj.hostname;
            } catch (e) {
                // If URL parsing fails, use the original URL
            }

            // Suggest common typo fixes
            let suggestion = '';
            if (domain.includes('bluesheild')) {
                suggestion = ' Did you mean "blueshield" (with an "i")?';
            } else if (domain.includes('blueshield') && !domain.includes('bluecross')) {
                suggestion = ' Did you mean "bluecrossblueshield.com"?';
            }

            const errorMessage = `Cannot resolve domain "${domain}". The domain name may be incorrect or the website may be down.${suggestion}`;
            const dnsError = new Error(errorMessage);
            dnsError.code = 'ENOTFOUND';
            dnsError.originalError = playwrightError;
            throw dnsError;
        }

        // Check if it's an HTTP/2 error that we should retry with different approach
        const isHttp2Error = playwrightError.message.includes('ERR_HTTP2_') ||
            playwrightError.message.includes('PROTOCOL_ERROR');

        // Fallback to axios with randomized browser-like headers
        try {
            const https = require('https');
            const http = require('http');

            // Apply rate limiting
            await rateLimiter.wait(url);

            // Generate random fingerprint for axios request
            const fingerprint = generateRandomFingerprint();
            const headers = generateHeaders(fingerprint);
            headers['User-Agent'] = fingerprint.userAgent;
            headers['Connection'] = 'keep-alive';

            // Create agents that force HTTP/1.1 (disable HTTP/2)
            const httpsAgent = new https.Agent({
                keepAlive: true,
                maxVersion: 'TLSv1.3',
                minVersion: 'TLSv1.2',
                // These settings help with some anti-bot measures
                rejectUnauthorized: true,
                timeout: timeout
            });

            const httpAgent = new http.Agent({
                keepAlive: true,
                timeout: timeout
            });

            const response = await axios.get(url, {
                headers: headers,
                timeout: timeout,
                httpsAgent: httpsAgent,
                httpAgent: httpAgent,
                maxRedirects: 10,
                validateStatus: (status) => status >= 200 && status < 400 // Accept redirects
            });
            return response.data;
        } catch (axiosError) {
            console.error(`Failed to fetch ${url} with axios:`, axiosError.message);

            // Check for DNS resolution errors (domain doesn't exist)
            const isDnsError = axiosError.code === 'ENOTFOUND' || 
                              axiosError.message.includes('ENOTFOUND') ||
                              axiosError.message.includes('ERR_NAME_NOT_RESOLVED') ||
                              playwrightError.message.includes('ERR_NAME_NOT_RESOLVED');

            if (isDnsError) {
                // Extract domain from URL for better error message
                let domain = url;
                try {
                    const urlObj = new URL(url);
                    domain = urlObj.hostname;
                } catch (e) {
                    // If URL parsing fails, use the original URL
                }

                // Suggest common typo fixes
                let suggestion = '';
                if (domain.includes('bluesheild')) {
                    suggestion = ' Did you mean "blueshield" (with an "i")?';
                } else if (domain.includes('blueshield') && !domain.includes('bluecross')) {
                    suggestion = ' Did you mean "bluecrossblueshield.com"?';
                }

                const errorMessage = `Cannot resolve domain "${domain}". The domain name may be incorrect or the website may be down.${suggestion}`;
                const dnsError = new Error(errorMessage);
                dnsError.code = 'ENOTFOUND';
                dnsError.originalError = axiosError;
                throw dnsError;
            }

            // If we haven't exhausted retries and it's a retriable error, try again
            if (retryAttempt < maxRetries - 1) {
                const isRetriableError =
                    axiosError.code === 'ECONNABORTED' ||
                    axiosError.code === 'ETIMEDOUT' ||
                    axiosError.code === 'ECONNRESET' ||
                    axiosError.message.includes('timeout') ||
                    axiosError.message.includes('PROTOCOL_ERROR') ||
                    isHttp2Error;

                if (isRetriableError) {
                    console.log(`Retrying fetch for ${url} (Attempt ${retryAttempt + 2}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, 2000 * (retryAttempt + 1))); // Exponential backoff
                    return fetchHtml(url, retryAttempt + 1);
                }
            }

            throw axiosError; // Throw error if all retries failed
        }
    } finally {
        // Ensure browser is closed to prevent resource leaks
        await screenshotService.close().catch(() => { });
    }
}

module.exports = {
    runAnalysisWorkflow,
    fetchHtml
};
