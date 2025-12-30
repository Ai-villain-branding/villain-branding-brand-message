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
const { runAnalysisWorkflow } = require('./services/workflow');
const ScreenshotService = require('./services/screenshotService');
const screenshotService = new ScreenshotService();
const supabase = require('./services/supabase');
const config = require('./config');

const app = express();
const PORT = config.port || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase limit for base64 images
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

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
    try {
        const { data, error } = await supabase
            .from('brand_messages')
            .select('*')
            .eq('company_id', id);

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// 4. Generate Screenshot (Visual Proof)
app.post('/api/screenshot', async (req, res) => {
    const { companyId, messageId, url, text } = req.body;

    try {
        // 1. Capture Screenshot
        // We need to pass the text to highlight/find
        const result = await screenshotService.captureMessage(url, text, messageId);

        if (!result) {
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
                details: `Could not find text "${text}" on page ${url}. The message may not be visible on this page.`,
                screenshot: failedScreenshot // Return the failed record
            });
        }

        const imageBuffer = result.buffer;

        // 2. Upload to Supabase Storage (if bucket exists) or save locally?
        // Let's try Supabase Storage first.
        // Assuming bucket 'screenshots' exists.
        const filename = `${companyId}/${Date.now()}-${Math.random().toString(36).substring(7)}.png`;

        const { data, error } = await supabase.storage
            .from('screenshots')
            .upload(filename, imageBuffer, {
                contentType: 'image/png'
            });

        let publicUrl;

        if (error) {
            console.warn('Supabase upload failed, falling back to base64 return (or local save)', error);
            // Fallback: return base64 for immediate display (not persistent)
            // Or better: save to local public folder and serve
            // For now, let's return base64 data URI
            publicUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;
        } else {
            const { data: publicData } = supabase.storage
                .from('screenshots')
                .getPublicUrl(filename);
            publicUrl = publicData.publicUrl;
        }

        // 3. Save Record in DB
        const { data: screenshotRecord, error: dbError } = await supabase
            .from('screenshots')
            .insert({
                company_id: companyId,
                message_id: messageId,
                image_url: publicUrl,
                original_url: url,
                message_content: text
            })
            .select()
            .single();

        if (dbError) throw dbError;

        res.json({ success: true, screenshot: screenshotRecord });

    } catch (error) {
        console.error('Screenshot failed:', error);
        res.status(500).json({ error: 'Screenshot generation failed' });
    }
});

// 5. Get Screenshots (for Proofs Gallery) - includes both successful and failed attempts
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
        const companiesWithProofs = companies.map(company => ({
            ...company,
            proof_count: proofCounts[company.id] || 0
        }));

        res.json(companiesWithProofs);
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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
