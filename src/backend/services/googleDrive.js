const { google } = require('googleapis');
const { Readable } = require('stream');

class GoogleDriveService {
    constructor() {
        this.drive = null;
        this.parentFolderId = '1NTjwH4gkbz40PkcnStZticrIdqNmzkUf'; // Extracted from the provided link
        this.initialized = false;
        // Cache for folder IDs to prevent duplicate lookups and race conditions
        this.folderCache = new Map(); // Key: "parentId/folderName", Value: folderId
    }

    /**
     * Initialize Google Drive API client
     * Uses OAuth2 authentication if credentials are available
     */
    async init() {
        if (this.initialized && this.drive) {
            return;
        }

        try {
            // Check if OAuth2 credentials are available
            const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
            const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
            const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
            
            if (!clientId || !clientSecret) {
                console.warn('Google Drive OAuth credentials not found. Google Drive mirroring will be skipped.');
                console.warn('Please set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET environment variables.');
                this.initialized = false;
                return;
            }

            if (!refreshToken) {
                console.warn('Google Drive refresh token not found. Google Drive mirroring will be skipped.');
                console.warn('Please set GOOGLE_DRIVE_REFRESH_TOKEN environment variable.');
                console.warn('To get a refresh token, you need to complete the OAuth2 flow once.');
                this.initialized = false;
                return;
            }

            // Create OAuth2 client
            const oauth2Client = new google.auth.OAuth2(
                clientId,
                clientSecret,
                'urn:ietf:wg:oauth:2.0:oob' // Redirect URI for installed apps
            );

            // Set the refresh token and configure auto-refresh
            oauth2Client.setCredentials({
                refresh_token: refreshToken
            });
            
            // Ensure token is refreshed if needed
            try {
                await oauth2Client.getAccessToken();
                console.log('[Google Drive] OAuth2 token validated');
            } catch (tokenError) {
                console.error('[Google Drive] Token validation failed:', tokenError.message);
                throw tokenError;
            }

            // Create Drive API client
            this.drive = google.drive({ version: 'v3', auth: oauth2Client });
            this.initialized = true;
            console.log('Google Drive service initialized successfully with OAuth2');
        } catch (error) {
            console.error('Failed to initialize Google Drive service:', error.message);
            this.initialized = false;
            this.drive = null;
        }
    }

    /**
     * Find a folder by name in a parent folder
     * @param {string} folderName - Name of the folder to find
     * @param {string} parentFolderId - ID of the parent folder
     * @returns {Promise<string|null>} - Folder ID if found, null otherwise
     */
    async findFolder(folderName, parentFolderId) {
        if (!this.initialized || !this.drive) {
            return null;
        }

        // Check cache first
        const cacheKey = `${parentFolderId}/${folderName}`;
        if (this.folderCache.has(cacheKey)) {
            return this.folderCache.get(cacheKey);
        }

        try {
            // Escape single quotes in folder name for query
            const escapedFolderName = folderName.replace(/'/g, "\\'");
            const response = await this.drive.files.list({
                q: `name='${escapedFolderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
                fields: 'files(id, name)',
                spaces: 'drive'
            });

            if (response.data.files && response.data.files.length > 0) {
                const folderId = response.data.files[0].id;
                // Cache the result
                this.folderCache.set(cacheKey, folderId);
                return folderId;
            }
            return null;
        } catch (error) {
            console.error(`Error finding folder "${folderName}":`, error.message);
            return null;
        }
    }

    /**
     * Create a folder in a parent folder
     * @param {string} folderName - Name of the folder to create
     * @param {string} parentFolderId - ID of the parent folder
     * @returns {Promise<string|null>} - Folder ID if created, null otherwise
     */
    async createFolder(folderName, parentFolderId) {
        if (!this.initialized || !this.drive) {
            return null;
        }

        const cacheKey = `${parentFolderId}/${folderName}`;

        try {
            const fileMetadata = {
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentFolderId]
            };

            const response = await this.drive.files.create({
                resource: fileMetadata,
                fields: 'id, name'
            });

            const folderId = response.data.id;
            // Cache the newly created folder
            this.folderCache.set(cacheKey, folderId);
            console.log(`Created folder "${folderName}" with ID: ${folderId}`);
            return folderId;
        } catch (error) {
            // If folder already exists (race condition), try to find it
            if (error.code === 409 || error.message.includes('duplicate') || error.message.includes('already exists')) {
                console.log(`Folder "${folderName}" already exists, looking it up...`);
                // Try to find it again (another process might have created it)
                const foundFolderId = await this.findFolder(folderName, parentFolderId);
                if (foundFolderId) {
                    return foundFolderId;
                }
            }
            console.error(`Error creating folder "${folderName}":`, error.message);
            return null;
        }
    }

    /**
     * Get or create a folder (finds existing or creates new)
     * @param {string} folderName - Name of the folder
     * @param {string} parentFolderId - ID of the parent folder
     * @returns {Promise<string|null>} - Folder ID
     */
    async getOrCreateFolder(folderName, parentFolderId) {
        if (!this.initialized || !this.drive) {
            return null;
        }

        // Try to find existing folder
        let folderId = await this.findFolder(folderName, parentFolderId);
        
        if (!folderId) {
            // Create if doesn't exist
            folderId = await this.createFolder(folderName, parentFolderId);
        }

        return folderId;
    }

    /**
     * Upload a file to Google Drive
     * @param {Buffer} fileBuffer - File buffer to upload
     * @param {string} fileName - Name of the file
     * @param {string} parentFolderId - ID of the parent folder
     * @returns {Promise<string|null>} - File ID if uploaded, null otherwise
     */
    async uploadFile(fileBuffer, fileName, parentFolderId) {
        if (!this.initialized || !this.drive) {
            console.error('[Google Drive] Cannot upload - service not initialized');
            return null;
        }

        try {
            console.log(`[Google Drive] Uploading file "${fileName}" to folder ${parentFolderId}...`);
            console.log(`[Google Drive] Buffer size: ${fileBuffer.length} bytes`);
            
            const fileMetadata = {
                name: fileName,
                parents: [parentFolderId]
            };

            // Convert Buffer to Readable stream for Google Drive API
            const stream = Readable.from(fileBuffer);

            const media = {
                mimeType: 'image/png',
                body: stream
            };

            const response = await this.drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id, name, webViewLink'
            });

            console.log(`[Google Drive] Successfully uploaded file "${fileName}" with ID: ${response.data.id}`);
            return response.data.id;
        } catch (error) {
            console.error(`[Google Drive] Error uploading file "${fileName}":`, error.message);
            console.error(`[Google Drive] Error details:`, error);
            if (error.response) {
                console.error(`[Google Drive] Error response:`, error.response.data);
            }
            return null;
        }
    }

    /**
     * Mirror screenshot to Google Drive with structured folder hierarchy
     * @param {Buffer} screenshotBuffer - Screenshot image buffer
     * @param {string} companyName - Company name
     * @param {Date} createdAt - Screenshot creation date
     * @param {string} screenshotId - Screenshot ID for filename
     * @returns {Promise<boolean>} - True if successful, false otherwise
     */
    async mirrorScreenshot(screenshotBuffer, companyName, createdAt, screenshotId) {
        try {
            console.log('[Google Drive] Starting mirror process...');
            await this.init();

            if (!this.initialized || !this.drive) {
                console.warn('[Google Drive] Not initialized, skipping mirror. Check credentials.');
                return false;
            }
            
            console.log('[Google Drive] Service initialized, proceeding with upload...');

            // Sanitize company name for folder name (remove invalid characters)
            const sanitizedCompanyName = companyName
                .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid folder name characters
                .trim();

            if (!sanitizedCompanyName) {
                console.error('Invalid company name for Google Drive folder');
                return false;
            }

            // Format date as YYYY-MM-DD
            const dateStr = createdAt.toISOString().split('T')[0];

            // 1. Get or create company folder
            const companyFolderId = await this.getOrCreateFolder(
                sanitizedCompanyName,
                this.parentFolderId
            );

            if (!companyFolderId) {
                console.error(`Failed to get or create company folder: ${sanitizedCompanyName}`);
                return false;
            }

            // 2. Get or create date folder inside company folder
            const dateFolderId = await this.getOrCreateFolder(
                dateStr,
                companyFolderId
            );

            if (!dateFolderId) {
                console.error(`Failed to get or create date folder: ${dateStr}`);
                return false;
            }

            // 3. Generate filename for screenshot
            const fileName = `screenshot-${screenshotId || Date.now()}.png`;

            // 4. Upload screenshot to date folder
            const fileId = await this.uploadFile(
                screenshotBuffer,
                fileName,
                dateFolderId
            );

            if (fileId) {
                console.log(`Successfully mirrored screenshot to Google Drive: ${sanitizedCompanyName}/${dateStr}/${fileName}`);
                return true;
            } else {
                console.error('Failed to upload screenshot to Google Drive');
                return false;
            }
        } catch (error) {
            console.error('Error mirroring screenshot to Google Drive:', error.message);
            return false;
        }
    }
}

module.exports = new GoogleDriveService();

