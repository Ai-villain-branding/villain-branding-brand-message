// Polyfill for File API if not available (Node.js < 20)
if (typeof File === 'undefined' && typeof global !== 'undefined') {
    global.File = class File {
        constructor(blobParts, name, options = {}) {
            this.name = name;
            this.lastModified = options.lastModified || Date.now();
            this.size = blobParts.reduce((acc, part) => acc + (part.length || part.size || 0), 0);
            this.type = options.type || '';
            this._blobParts = blobParts;
        }
        stream() {
            return new ReadableStream({
                start(controller) {
                    for (const part of this._blobParts) {
                        controller.enqueue(part);
                    }
                    controller.close();
                }
            });
        }
    };
}

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { runAnalysisWorkflow } = require('./services/workflow');
const ScreenshotService = require('./services/screenshotService');
const screenshotService = new ScreenshotService();
const StandaloneScreenshotService = require('./services/standaloneScreenshotService');
const standaloneScreenshotService = new StandaloneScreenshotService();
const { captureScreenshot } = require('./services/scrappeyScreenshot');
const supabase = require('./services/supabase');
const config = require('./config');
const googleDriveService = require('./services/googleDrive');
const { saveHtmlEvidence, getHtmlEvidence } = require('./storage');
const { categorizeMessages } = require('./services/messageCategorizer');

const app = express();
const PORT = config.port || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase limit for base64 images
app.use(express.urlencoded({ limit: '50mb', extended: true }));
const path = require('path');
app.use(express.static(path.join(__dirname, '../frontend')));

// --- API Endpoints ---

// 1. Start Analysis
app.post('/api/analyze', async (req, res) => {
    const { url, pages, mode } = req.body;

    // Validate input
    if (mode === 'specific') {
        // For specific pages mode, we need pages array
        if (!pages || !Array.isArray(pages) || pages.length === 0) {
            return res.status(400).json({ error: 'At least one page URL is required for specific pages mode' });
        }
        // Use first page's origin as base URL if url not provided
        if (!url && pages.length > 0) {
            try {
                const firstPageUrl = new URL(pages[0]);
                req.body.url = firstPageUrl.origin;
            } catch (e) {
                return res.status(400).json({ error: 'Invalid page URL format' });
            }
        }
    } else {
        // For full website mode, we need base URL
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }
    }

    try {
        // Run the workflow with mode and pages if provided
        const result = await runAnalysisWorkflow(url, mode === 'specific' ? pages : null);
        res.json({ success: true, companyId: result.companyId });

    } catch (error) {
        console.error('Analysis failed:', error);
        res.status(500).json({ error: 'Analysis failed', details: error.message });
    }
});

// 2. Get Companies (for Dashboard)
app.get('/api/companies', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('companies')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch companies' });
    }
});

// 2b. Delete Company
app.delete('/api/company/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // First, get the company to verify it exists
        const { data: company, error: fetchError } = await supabase
            .from('companies')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Get all screenshots for this company to delete from storage
        const { data: screenshots, error: screenshotsError } = await supabase
            .from('screenshots')
            .select('image_url')
            .eq('company_id', id);

        if (!screenshotsError && screenshots) {
            // Delete screenshots from storage
            for (const screenshot of screenshots) {
                if (screenshot.image_url && screenshot.image_url.includes('supabase.co')) {
                    try {
                        const urlParts = screenshot.image_url.split('/screenshots/');
                        if (urlParts.length > 1) {
                            const filePath = urlParts[1];
                            await supabase.storage
                                .from('screenshots')
                                .remove([filePath]);
                        }
                    } catch (storageErr) {
                        console.warn('Failed to delete screenshot from storage:', storageErr);
                        // Continue even if storage deletion fails
                    }
                }
            }
        }

        // Delete company (cascading deletes will handle messages and screenshots in DB)
        const { error: deleteError } = await supabase
            .from('companies')
            .delete()
            .eq('id', id);

        if (deleteError) throw deleteError;

        res.json({ success: true, message: 'Company deleted successfully' });

    } catch (error) {
        console.error('Delete company failed:', error);
        res.status(500).json({ error: 'Failed to delete company', details: error.message });
    }
});

// 3. Get Company Messages (for Company View)
app.get('/api/company/:id/messages', async (req, res) => {
    const { id } = req.params;
    const includeCategories = req.query.include_categories === 'true';

    try {
        let query = supabase
            .from('brand_messages')
            .select('*')
            .eq('company_id', id);

        if (includeCategories) {
            // Join with categories directly
            query = supabase
                .from('brand_messages')
                .select(`
                    *,
                    message_categories (
                        id,
                        name,
                        description
                    )
                `)
                .eq('company_id', id);
        }

        const { data, error } = await query;

        if (error) throw error;

        // Transform data if categories are included
        if (includeCategories && data) {
            const transformed = data.map(msg => {
                const category = msg.message_categories;
                return {
                    ...msg,
                    category_id: category?.id || null,
                    category_name: category?.name || null,
                    message_categories: undefined // Remove nested data
                };
            });
            res.json(transformed);
        } else {
            res.json(data);
        }
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages', details: error.message });
    }
});

// 3c. Delete Message (and all associated screenshots)
app.delete('/api/message/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // First, get the message to verify it exists
        const { data: message, error: fetchError } = await supabase
            .from('brand_messages')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        // Get all screenshots associated with this message
        const { data: screenshots, error: screenshotsError } = await supabase
            .from('screenshots')
            .select('*')
            .eq('message_id', id);

        if (!screenshotsError && screenshots && screenshots.length > 0) {
            // Delete screenshots from storage and database
            for (const screenshot of screenshots) {
                // Delete from Supabase Storage if it's a storage URL
                if (screenshot.image_url && screenshot.image_url.includes('supabase.co')) {
                    try {
                        const urlParts = screenshot.image_url.split('/screenshots/');
                        if (urlParts.length > 1) {
                            const filePath = urlParts[1];
                            await supabase.storage
                                .from('screenshots')
                                .remove([filePath]);
                        }
                    } catch (storageErr) {
                        console.warn('Failed to delete screenshot from storage:', storageErr);
                        // Continue even if storage deletion fails
                    }
                }

                // Delete from database
                await supabase
                    .from('screenshots')
                    .delete()
                    .eq('id', screenshot.id);
            }

            console.log(`Deleted ${screenshots.length} screenshots associated with message ${id}`);
        }

        // Delete the message
        const { error: deleteError } = await supabase
            .from('brand_messages')
            .delete()
            .eq('id', id);

        if (deleteError) throw deleteError;

        res.json({
            success: true,
            message: 'Message and associated evidence deleted successfully',
            deletedScreenshots: screenshots ? screenshots.length : 0
        });

    } catch (error) {
        console.error('Delete message failed:', error);
        res.status(500).json({ error: 'Failed to delete message', details: error.message });
    }
});

// 3d. Re-categorize Company Messages (with new theme-based system)
app.post('/api/company/:id/re-categorize', async (req, res) => {
    const { id } = req.params;
    try {
        // Fetch all messages for this company
        const { data: messages, error: fetchError } = await supabase
            .from('brand_messages')
            .select('id, content, message_type, reasoning')
            .eq('company_id', id);

        if (fetchError) throw fetchError;

        if (!messages || messages.length === 0) {
            return res.status(404).json({ error: 'No messages found for this company' });
        }

        // Re-categorize with new theme-based system
        const result = await categorizeMessages(id, messages);

        res.json({
            success: true,
            message: `Re-categorized ${messages.length} messages into ${result.categories.length} theme-based categories`,
            categories: result.categories
        });
    } catch (error) {
        console.error('Error re-categorizing messages:', error);
        res.status(500).json({ error: 'Failed to re-categorize messages', details: error.message });
    }
});

// 3b. Get Company Categories with Messages
app.get('/api/company/:id/categories', async (req, res) => {
    const { id } = req.params;
    try {
        // Fetch categories for this company
        const { data: categories, error: categoriesError } = await supabase
            .from('message_categories')
            .select('*')
            .eq('company_id', id)
            .order('message_count', { ascending: false });

        if (categoriesError) throw categoriesError;

        if (!categories || categories.length === 0) {
            return res.json({ categories: [] });
        }

        // Fetch messages for each category (using direct category_id on messages)
        const categoriesWithMessages = await Promise.all(
            categories.map(async (category) => {
                // Fetch messages directly by category_id
                const { data: messages, error: messagesError } = await supabase
                    .from('brand_messages')
                    .select('*')
                    .eq('category_id', category.id);

                if (messagesError) {
                    console.error(`Error fetching messages for category ${category.id}:`, messagesError);
                    return {
                        ...category,
                        messages: []
                    };
                }

                return {
                    id: category.id,
                    name: category.name,
                    description: category.description,
                    message_count: category.message_count,
                    messages: messages || []
                };
            })
        );

        res.json({ categories: categoriesWithMessages });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'Failed to fetch categories', details: error.message });
    }
});

// 4. Generate Screenshot (Visual Proof)
app.post('/api/screenshot', async (req, res) => {
    const { companyId, messageId, url, text } = req.body;

    try {
        // 1. Try Playwright first (primary method - complex with extensions)
        let result = await screenshotService.captureMessage(url, text, messageId);
        let screenshotSource = 'playwright';

        // 2. If 1st attempt fails, try standalone Playwright (simpler, no extensions)
        if (!result) {
            console.log(`[Screenshot] 1st attempt (Playwright with extensions) failed for ${url}, trying 2nd attempt (standalone Playwright)...`);
            try {
                result = await standaloneScreenshotService.captureMessage(url, text, messageId);
                if (result) {
                    screenshotSource = 'standalone-playwright';
                    console.log(`[Screenshot] 2nd attempt (standalone Playwright) succeeded for ${url}`);
                }
            } catch (standaloneError) {
                console.error(`[Screenshot] 2nd attempt (standalone Playwright) failed for ${url}:`, standaloneError.message);
                result = null;
            }
        }

        // 3. If 2nd attempt fails, fall back to Scrappey (paid service)
        if (!result) {
            console.log(`[Screenshot] Both Playwright attempts failed for ${url}, trying 3rd attempt (Scrappey)...`);
            try {
                const scrappeyResult = await captureScreenshot({
                    url: url,
                    upload: true, // Prefer public URL for production
                    width: 1920,
                    height: 1080
                });

                // Convert Scrappey result to match Playwright format
                let imageBuffer = null;
                let publicUrl = null;

                if (scrappeyResult.publicUrl) {
                    // Scrappey provided a public URL - download it to get buffer for Supabase/Google Drive
                    publicUrl = scrappeyResult.publicUrl;
                    console.log(`[Screenshot] Scrappey provided public URL: ${publicUrl}, downloading image...`);
                    try {
                        const imageResponse = await axios.get(publicUrl, {
                            responseType: 'arraybuffer',
                            timeout: 30000
                        });
                        imageBuffer = Buffer.from(imageResponse.data);
                        console.log(`[Screenshot] Downloaded image from Scrappey URL (${imageBuffer.length} bytes)`);
                    } catch (downloadError) {
                        console.warn(`[Screenshot] Failed to download image from Scrappey URL: ${downloadError.message}`);
                        // Continue with public URL only if download fails
                    }
                } else if (scrappeyResult.base64) {
                    // Scrappey provided base64 - convert to buffer
                    imageBuffer = Buffer.from(scrappeyResult.base64, 'base64');
                    console.log(`[Screenshot] Scrappey provided base64 (${imageBuffer.length} bytes)`);
                } else {
                    throw new Error('Scrappey returned no screenshot data');
                }

                // Create result object similar to Playwright format
                result = {
                    buffer: imageBuffer,
                    metadata: {
                        id: require('uuid').v4(),
                        messageId: messageId,
                        messageText: text,
                        url: scrappeyResult.finalURL || url,
                        dimensions: { width: 1920, height: 1080 },
                        capturedAt: new Date().toISOString(),
                        source: 'scrappey'
                    },
                    publicUrl: publicUrl // Store public URL if available
                };
                screenshotSource = 'scrappey';
                console.log(`[Screenshot] 3rd attempt (Scrappey) succeeded for ${url}`);
            } catch (scrappeyError) {
                console.error(`[Screenshot] 3rd attempt (Scrappey) also failed for ${url}:`, scrappeyError.message);
                // All three methods failed - continue to failure handling below
                result = null;
            }
        }

        if (!result) {
            // All three attempts failed (Playwright with extensions, standalone Playwright, and Scrappey)
            // Store failed attempt in database so it shows up in proofs page
            const { data: failedScreenshot, error: insertError } = await supabase
                .from('screenshots')
                .insert({
                    company_id: companyId,
                    message_id: messageId,
                    image_url: null, // null indicates failed
                    original_url: url,
                    message_content: text,
                    status: 'failed' // Track status
                })
                .select()
                .single();

            // Return error but also return the failed record so frontend can show placeholder
            return res.status(404).json({
                success: false,
                error: 'Screenshot capture failed',
                details: `Could not capture screenshot of page ${url}. All three methods failed (Playwright with extensions, standalone Playwright, and Scrappey).`,
                screenshot: failedScreenshot // Return the failed record
            });
        }

        // Handle different result formats
        let imageBuffer = result.buffer;
        let scrappeyPublicUrl = result.publicUrl; // May be set if Scrappey provided a public URL
        let htmlEvidencePath = result.htmlEvidencePath || (result.metadata && result.metadata.htmlEvidencePath) || null;

        // Log HTML evidence if available
        if (htmlEvidencePath) {
            console.log(`[Evidence] HTML evidence linked to screenshot: ${htmlEvidencePath}`);
        }

        // 2. Upload to Supabase Storage (always upload to Supabase, even if Scrappey provided a public URL)
        let publicUrl;

        if (imageBuffer) {
            // Upload buffer to Supabase Storage (Playwright, Scrappey base64, or downloaded from Scrappey URL)
            const filename = `${companyId}/${Date.now()}-${Math.random().toString(36).substring(7)}.png`;

            const { data, error } = await supabase.storage
                .from('screenshots')
                .upload(filename, imageBuffer, {
                    contentType: 'image/png'
                });

            if (error) {
                console.warn('Supabase upload failed, falling back to Scrappey URL or base64', error);
                // Fallback: use Scrappey's public URL if available, otherwise base64
                if (scrappeyPublicUrl && screenshotSource === 'scrappey') {
                    publicUrl = scrappeyPublicUrl;
                    console.log(`[Screenshot] Using Scrappey's public URL as fallback: ${publicUrl}`);
                } else {
                    publicUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;
                }
            } else {
                const { data: publicData } = supabase.storage
                    .from('screenshots')
                    .getPublicUrl(filename);
                publicUrl = publicData.publicUrl;
                console.log(`[Screenshot] Uploaded to Supabase Storage: ${publicUrl}`);
            }
        } else if (scrappeyPublicUrl && screenshotSource === 'scrappey') {
            // Only use Scrappey URL directly if we couldn't download it (fallback case)
            publicUrl = scrappeyPublicUrl;
            console.log(`[Screenshot] Using Scrappey's public URL (download failed): ${publicUrl}`);
        } else {
            throw new Error('No image data available from screenshot service');
        }

        // 3. Save Record in DB
        const screenshotData = {
            company_id: companyId,
            message_id: messageId,
            image_url: publicUrl,
            original_url: url,
            message_content: text,
            status: 'success' // Track status
        };

        // If HTML evidence path exists, try to include it in the database record
        // Gracefully handle if the column doesn't exist (migration not run)
        if (htmlEvidencePath) {
            screenshotData.html_evidence_path = htmlEvidencePath;
            console.log(`[Evidence] Screenshot ${companyId}/${messageId} has HTML evidence at: ${htmlEvidencePath}`);
        }

        let screenshotRecord;
        let dbError;

        // Try to insert with html_evidence_path if provided
        const { data, error } = await supabase
            .from('screenshots')
            .insert(screenshotData)
            .select()
            .single();

        if (error) {
            // If error is due to missing column, retry without html_evidence_path
            if (htmlEvidencePath && (
                (error.message?.includes('column') && error.message?.includes('html_evidence_path')) ||
                error.code === '42703' || // PostgreSQL undefined column error
                error.message?.includes('does not exist')
            )) {
                console.warn('[Evidence] html_evidence_path column not found, inserting without it');
                // Remove html_evidence_path and retry
                const { html_evidence_path, ...dataWithoutEvidence } = screenshotData;
                const { data: retryData, error: retryError } = await supabase
                    .from('screenshots')
                    .insert(dataWithoutEvidence)
                    .select()
                    .single();

                if (retryError) {
                    dbError = retryError;
                } else {
                    screenshotRecord = retryData;
                }
            } else {
                dbError = error;
            }
        } else {
            screenshotRecord = data;
        }

        if (dbError) throw dbError;

        // 4. Mirror to Google Drive (mirror every successful screenshot)
        // Mirror if we have an image buffer (always available now since we download from Scrappey URL)
        if (screenshotRecord && imageBuffer) {
            console.log(`[Google Drive] Attempting to mirror screenshot ${screenshotRecord.id} for messageId: ${messageId || 'N/A'}...`);
            try {
                // Get company name (or domain as fallback) from database
                const { data: company, error: companyError } = await supabase
                    .from('companies')
                    .select('name, domain')
                    .eq('id', companyId)
                    .single();

                if (!companyError && company) {
                    // Use company name if available, otherwise fall back to domain
                    const companyName = company.name || company.domain;

                    if (companyName) {
                        // Parse created_at timestamp
                        const createdAt = screenshotRecord.created_at
                            ? new Date(screenshotRecord.created_at)
                            : new Date();

                        console.log(`[Google Drive] Mirroring screenshot for company: ${companyName}, date: ${createdAt.toISOString().split('T')[0]}`);

                        // Mirror screenshot to Google Drive (non-blocking, don't fail if this errors)
                        googleDriveService.mirrorScreenshot(
                            imageBuffer,
                            companyName,
                            createdAt,
                            screenshotRecord.id
                        ).then(success => {
                            if (success) {
                                console.log(`[Google Drive] Successfully mirrored screenshot ${screenshotRecord.id}`);
                            } else {
                                console.warn(`[Google Drive] Failed to mirror screenshot ${screenshotRecord.id}`);
                            }
                        }).catch(error => {
                            console.error('[Google Drive] Mirror failed (non-critical):', error.message);
                            console.error('[Google Drive] Error stack:', error.stack);
                        });
                    } else {
                        console.warn(`[Google Drive] Company name and domain are both missing for companyId ${companyId}, skipping Google Drive mirror`);
                    }
                } else {
                    console.warn(`[Google Drive] Could not fetch company for companyId ${companyId}, error:`, companyError?.message);
                }
            } catch (mirrorError) {
                // Don't fail the request if Google Drive mirroring fails
                console.error('[Google Drive] Error during mirror (non-critical):', mirrorError.message);
                console.error('[Google Drive] Error stack:', mirrorError.stack);
            }
        } else if (screenshotSource === 'scrappey' && !imageBuffer) {
            console.log(`[Google Drive] Skipping mirror - Scrappey provided public URL only (no buffer available)`);
        } else {
            console.warn('[Google Drive] Skipping mirror - screenshotRecord or imageBuffer is null');
        }

        res.json({ success: true, screenshot: screenshotRecord });

    } catch (error) {
        console.error('Screenshot failed:', error);
        res.status(500).json({ error: 'Screenshot generation failed' });
    }
});

// 4a. Receive HTML Evidence from CloudFlare Bypass Extension
app.post('/api/evidence/html', async (req, res) => {
    const { url, html, timestamp, tabId } = req.body;

    try {
        // Validate required parameters
        if (!url || !html) {
            return res.status(400).json({
                success: false,
                error: 'URL and HTML content are required',
                details: 'Please provide both url and html in the request body'
            });
        }

        // Validate URL format
        try {
            new URL(url);
        } catch (e) {
            return res.status(400).json({
                success: false,
                error: 'Invalid URL format',
                details: e.message
            });
        }

        console.log(`[Evidence] Receiving HTML evidence for ${url}...`);

        // Save HTML evidence
        const evidenceResult = await saveHtmlEvidence(html, url, {
            timestamp: timestamp || new Date().toISOString(),
            tabId: tabId,
            source: 'cloudflare-bypass-extension'
        });

        console.log(`[Evidence] HTML evidence saved: ${evidenceResult.relativePath}`);

        // Return success response with file path
        res.json({
            success: true,
            filePath: evidenceResult.filePath,
            relativePath: evidenceResult.relativePath,
            filename: evidenceResult.filename,
            metadata: evidenceResult.metadata
        });

    } catch (error) {
        console.error('[Evidence] Error saving HTML evidence:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save HTML evidence',
            details: error.message
        });
    }
});

// 4b. Generate Screenshot using Scrappey API (Alternative service)
app.post('/api/screenshot-scrappey', async (req, res) => {
    const { url, upload, width, height } = req.body;

    // Validate required parameters
    if (!url) {
        return res.status(400).json({
            success: false,
            error: 'URL is required',
            details: 'Please provide a valid URL in the request body'
        });
    }

    // Validate URL format
    try {
        new URL(url);
    } catch (e) {
        return res.status(400).json({
            success: false,
            error: 'Invalid URL format',
            details: `"${url}" is not a valid URL`
        });
    }

    // Validate optional parameters
    const uploadFlag = upload === true || upload === 'true';
    const screenshotWidth = width ? parseInt(width) : undefined;
    const screenshotHeight = height ? parseInt(height) : undefined;

    if (screenshotWidth !== undefined && (isNaN(screenshotWidth) || screenshotWidth < 100 || screenshotWidth > 5000)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid width',
            details: 'Width must be a number between 100 and 5000 pixels'
        });
    }

    if (screenshotHeight !== undefined && (isNaN(screenshotHeight) || screenshotHeight < 100 || screenshotHeight > 5000)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid height',
            details: 'Height must be a number between 100 and 5000 pixels'
        });
    }

    try {
        // Call Scrappey screenshot service
        const screenshotOptions = {
            url: url,
            upload: uploadFlag
        };

        // Only include width/height if provided
        if (screenshotWidth !== undefined) {
            screenshotOptions.width = screenshotWidth;
        }
        if (screenshotHeight !== undefined) {
            screenshotOptions.height = screenshotHeight;
        }

        const result = await captureScreenshot(screenshotOptions);

        // Return success response
        res.json({
            success: true,
            screenshot: result
        });

    } catch (error) {
        console.error('Scrappey screenshot failed:', error);

        // Determine appropriate status code
        let statusCode = 500;
        if (error.message.includes('required') || error.message.includes('Invalid URL')) {
            statusCode = 400;
        } else if (error.message.includes('timeout') || error.message.includes('network')) {
            statusCode = 504; // Gateway Timeout
        }

        res.status(statusCode).json({
            success: false,
            error: 'Screenshot capture failed',
            details: error.message
        });
    }
});

// 5. Get Screenshots (for Evidences Gallery) - includes both successful and failed attempts
app.get('/api/company/:id/screenshots', async (req, res) => {
    const { id } = req.params;
    try {
        const { data, error } = await supabase
            .from('screenshots')
            .select('*')
            .eq('company_id', id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch screenshots' });
    }
});

// 7. Get Companies with Proof Counts
app.get('/api/companies-with-proofs', async (req, res) => {
    try {
        // Get all companies
        const { data: companies, error: companiesError } = await supabase
            .from('companies')
            .select('*')
            .order('created_at', { ascending: false });

        if (companiesError) throw companiesError;

        // Get proof counts for each company
        const { data: screenshots, error: screenshotsError } = await supabase
            .from('screenshots')
            .select('company_id');

        if (screenshotsError) throw screenshotsError;

        // Count proofs per company
        const proofCounts = {};
        if (screenshots) {
            screenshots.forEach(screenshot => {
                proofCounts[screenshot.company_id] = (proofCounts[screenshot.company_id] || 0) + 1;
            });
        }

        // Add proof count to each company
        const companiesWithEvidences = companies.map(company => ({
            ...company,
            proof_count: proofCounts[company.id] || 0
        }));

        res.json(companiesWithEvidences);
    } catch (error) {
        console.error('Error fetching companies with proofs:', error);
        res.status(500).json({ error: 'Failed to fetch companies with proofs' });
    }
});

// 6. Update Screenshot (with cropped image)
app.put('/api/screenshot/:id', async (req, res) => {
    const { id } = req.params;
    const { image } = req.body; // Base64 image data

    console.log(`Update screenshot request for ID: ${id}`);
    console.log(`Image data length: ${image ? image.length : 0}`);

    if (!image) {
        console.error('No image data provided');
        return res.status(400).json({ error: 'Image data is required' });
    }

    if (typeof image !== 'string' || !image.startsWith('data:image')) {
        console.error('Invalid image format');
        return res.status(400).json({ error: 'Invalid image format. Expected base64 data URI.' });
    }

    try {
        // Get the screenshot record
        const { data: screenshot, error: fetchError } = await supabase
            .from('screenshots')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !screenshot) {
            return res.status(404).json({ error: 'Screenshot not found' });
        }

        // Convert base64 to buffer
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        let imageBuffer;

        try {
            imageBuffer = Buffer.from(base64Data, 'base64');
            if (imageBuffer.length === 0) {
                throw new Error('Empty buffer after base64 conversion');
            }
            console.log(`Image buffer size: ${imageBuffer.length} bytes`);
        } catch (bufferError) {
            console.error('Error converting base64 to buffer:', bufferError);
            throw new Error('Failed to convert image data: ' + bufferError.message);
        }

        // Upload new image to Supabase Storage
        const filename = `${screenshot.company_id}/${Date.now()}-${Math.random().toString(36).substring(7)}.png`;

        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('screenshots')
            .upload(filename, imageBuffer, {
                contentType: 'image/png',
                upsert: false
            });

        let publicUrl;

        if (uploadError) {
            console.warn('Supabase upload failed, using base64:', uploadError);
            console.warn('Upload error details:', JSON.stringify(uploadError));
            // Fallback to base64
            publicUrl = image;
        } else {
            console.log('Image uploaded successfully to Supabase');
            const { data: publicData } = supabase.storage
                .from('screenshots')
                .getPublicUrl(filename);
            publicUrl = publicData.publicUrl;

            // Delete old image from storage if it exists and is a storage URL
            if (screenshot.image_url && screenshot.image_url.includes('supabase.co')) {
                try {
                    const urlParts = screenshot.image_url.split('/screenshots/');
                    if (urlParts.length > 1) {
                        const oldFilePath = urlParts[1];
                        await supabase.storage
                            .from('screenshots')
                            .remove([oldFilePath]);
                    }
                } catch (deleteErr) {
                    console.warn('Failed to delete old image from storage:', deleteErr);
                    // Continue even if old image deletion fails
                }
            }
        }

        // Update database with new image URL
        console.log('Updating database with new image URL...');
        const { data: updatedScreenshot, error: updateError } = await supabase
            .from('screenshots')
            .update({ image_url: publicUrl })
            .eq('id', id)
            .select()
            .single();

        if (updateError) {
            console.error('Database update error:', updateError);
            throw updateError;
        }

        console.log('Screenshot updated successfully');
        res.json({ success: true, screenshot: updatedScreenshot });

    } catch (error) {
        console.error('Update screenshot failed:', error);
        res.status(500).json({ error: 'Failed to update screenshot', details: error.message });
    }
});

// 6b. Copy Screenshot (save cropped image as new screenshot)
app.post('/api/screenshot/:id/copy', async (req, res) => {
    const { id } = req.params;
    const { image } = req.body; // Base64 image data

    console.log(`Copy screenshot request for ID: ${id}`);
    console.log(`Image data length: ${image ? image.length : 0}`);

    if (!image) {
        console.error('No image data provided');
        return res.status(400).json({ error: 'Image data is required' });
    }

    if (typeof image !== 'string' || !image.startsWith('data:image')) {
        console.error('Invalid image format');
        return res.status(400).json({ error: 'Invalid image format. Expected base64 data URI.' });
    }

    try {
        // Get the original screenshot record for metadata
        const { data: originalScreenshot, error: fetchError } = await supabase
            .from('screenshots')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !originalScreenshot) {
            return res.status(404).json({ error: 'Screenshot not found' });
        }

        // Convert base64 to buffer
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        let imageBuffer;

        try {
            imageBuffer = Buffer.from(base64Data, 'base64');
            if (imageBuffer.length === 0) {
                throw new Error('Empty buffer after base64 conversion');
            }
            console.log(`Image buffer size: ${imageBuffer.length} bytes`);
        } catch (bufferError) {
            console.error('Error converting base64 to buffer:', bufferError);
            throw new Error('Failed to convert image data: ' + bufferError.message);
        }

        // Upload new image to Supabase Storage
        const filename = `${originalScreenshot.company_id}/${Date.now()}-${Math.random().toString(36).substring(7)}.png`;

        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('screenshots')
            .upload(filename, imageBuffer, {
                contentType: 'image/png',
                upsert: false
            });

        let publicUrl;

        if (uploadError) {
            console.warn('Supabase upload failed, using base64:', uploadError);
            console.warn('Upload error details:', JSON.stringify(uploadError));
            // Fallback to base64
            publicUrl = image;
        } else {
            console.log('Image uploaded successfully to Supabase');
            const { data: publicData } = supabase.storage
                .from('screenshots')
                .getPublicUrl(filename);
            publicUrl = publicData.publicUrl;
        }

        // Create new screenshot record in database (copying metadata from original)
        console.log('Creating new screenshot record...');
        const { data: newScreenshot, error: insertError } = await supabase
            .from('screenshots')
            .insert({
                company_id: originalScreenshot.company_id,
                message_id: originalScreenshot.message_id,
                image_url: publicUrl,
                original_url: originalScreenshot.original_url,
                message_content: originalScreenshot.message_content
            })
            .select()
            .single();

        if (insertError) {
            console.error('Database insert error:', insertError);
            throw insertError;
        }

        console.log('Screenshot copy created successfully');
        res.json({ success: true, screenshot: newScreenshot });

    } catch (error) {
        console.error('Copy screenshot failed:', error);
        res.status(500).json({ error: 'Failed to copy screenshot', details: error.message });
    }
});

// 6c. Cleanup Duplicate Messages for a Company
app.post('/api/company/:id/cleanup-duplicates', async (req, res) => {
    const { id } = req.params;

    try {
        // Get all messages for this company
        const { data: messages, error: fetchError } = await supabase
            .from('brand_messages')
            .select('*')
            .eq('company_id', id);

        if (fetchError) throw fetchError;
        if (!messages || messages.length === 0) {
            return res.json({ success: true, message: 'No messages to clean up', merged: 0 });
        }

        // Helper function to normalize message content for comparison
        function normalizeMessageContent(text) {
            return text
                .toLowerCase()
                .trim()
                .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
                .replace(/[^\w\s]/g, '') // Remove punctuation for comparison
                .trim();
        }

        // Group messages by normalized content and type
        const duplicateGroups = new Map();

        messages.forEach(msg => {
            const normalized = normalizeMessageContent(msg.content);
            const key = `${msg.message_type}-${normalized}`;

            if (!duplicateGroups.has(key)) {
                duplicateGroups.set(key, []);
            }
            duplicateGroups.get(key).push(msg);
        });

        let mergedCount = 0;

        // Merge duplicates
        for (const [key, group] of duplicateGroups.entries()) {
            if (group.length > 1) {
                // Keep the first message, merge others into it
                const primary = group[0];
                const toMerge = group.slice(1);

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

                mergedCount += toMerge.length;
            }
        }

        res.json({
            success: true,
            message: `Cleaned up ${mergedCount} duplicate messages`,
            merged: mergedCount
        });

    } catch (error) {
        console.error('Cleanup duplicates failed:', error);
        res.status(500).json({ error: 'Failed to cleanup duplicates', details: error.message });
    }
});

// 7. Delete Screenshot
app.delete('/api/screenshot/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // First, get the screenshot record to find the image URL
        const { data: screenshot, error: fetchError } = await supabase
            .from('screenshots')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !screenshot) {
            return res.status(404).json({ error: 'Screenshot not found' });
        }

        // Delete from Supabase Storage if it's a storage URL
        if (screenshot.image_url && screenshot.image_url.includes('supabase.co')) {
            try {
                // Extract the file path from the URL
                // URL format: https://[project].supabase.co/storage/v1/object/public/screenshots/[path]
                const urlParts = screenshot.image_url.split('/screenshots/');
                if (urlParts.length > 1) {
                    const filePath = urlParts[1];
                    const { error: storageError } = await supabase.storage
                        .from('screenshots')
                        .remove([filePath]);

                    if (storageError) {
                        console.warn('Failed to delete from storage:', storageError);
                        // Continue with DB deletion even if storage deletion fails
                    }
                }
            } catch (storageErr) {
                console.warn('Error deleting from storage:', storageErr);
                // Continue with DB deletion
            }
        }

        // Delete from database
        const { error: deleteError } = await supabase
            .from('screenshots')
            .delete()
            .eq('id', id);

        if (deleteError) throw deleteError;

        res.json({ success: true, message: 'Screenshot deleted successfully' });

    } catch (error) {
        console.error('Delete screenshot failed:', error);
        res.status(500).json({ error: 'Failed to delete screenshot', details: error.message });
    }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {}
    };

    // Check Supabase connection
    try {
        const { error } = await supabase.from('companies').select('id').limit(1);
        health.services.supabase = error ? 'error' : 'ok';
        if (error) health.services.supabase_error = error.message;
    } catch (err) {
        health.services.supabase = 'error';
        health.services.supabase_error = err.message;
    }

    // Check OpenAI API key
    health.services.openai = config.openaiApiKey ? 'configured' : 'missing';

    // Check optional services
    health.services.scrappey = config.scrappeyApiKey ? 'configured' : 'optional';
    health.services.googleDrive = config.googleDriveClientId ? 'configured' : 'optional';

    const allCriticalOk = health.services.supabase === 'ok' && health.services.openai === 'configured';
    res.status(allCriticalOk ? 200 : 503).json(health);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
