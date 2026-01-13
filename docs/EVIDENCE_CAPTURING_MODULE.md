# Evidence Capturing Module - Implementation Details

## Overview
The Evidence Capturing Module is a sophisticated system designed to automatically capture visual proof (screenshots) of brand messages found on company websites. It uses a multi-tier fallback approach with three different screenshot capture methods to ensure maximum success rate.

---

## Architecture

### 1. **Three-Tier Fallback System**

The module employs a cascading fallback strategy:

1. **Primary Method**: Playwright with Chrome Extensions (Complex)
   - Uses persistent browser context with custom extensions
   - Includes screenshot stabilizer extension
   - Supports CloudFlare bypass extension
   - Most feature-rich but can fail on complex sites

2. **Secondary Method**: Standalone Playwright (Simplified)
   - Simpler Playwright implementation without extensions
   - Faster initialization
   - Better for straightforward websites

3. **Tertiary Method**: Scrappey API (Paid Service)
   - External cloud-based screenshot service
   - Handles difficult sites and anti-bot protection
   - Provides public URLs or base64 images

---

## Core Components

### A. Screenshot Service (`services/screenshotService.js`)

**Purpose**: Primary screenshot capture service using Playwright with extensions

**Key Features**:
- Persistent browser context with Chrome extensions
- CloudFlare challenge detection and bypass
- Error page detection (403, 404, access denied)
- Popup/modal/cookie banner auto-closing
- Smart text element finding with multiple strategies
- Screenshot stabilization (fonts, animations, lazy content)
- Element highlighting for better visibility
- Intelligent bounding box calculation with context

**Main Methods**:

```javascript
class ScreenshotService {
  // Initialize browser with persistent context
  async init()
  
  // Capture screenshot for a message
  async captureMessage(url, messageText, messageId, retries = 2)
  
  // Capture with CloudFlare bypass
  async captureWithCloudflareBypass(url, messageText, messageId, retries = 2)
  
  // Detect CloudFlare challenge
  async detectCloudflareChallenge(page)
  
  // Detect error/blocked pages
  async detectErrorPage(page)
  
  // Find element containing text (5 strategies)
  async findElementWithText(page, text)
  
  // Close popups, modals, cookie banners
  async closePopups(page)
  
  // Scroll page to reveal content
  async scrollPageToRevealContent(page)
  
  // Calculate bounding box with context
  async calculateBoundingBox(element, page)
  
  // Wait for extension to stabilize page
  async waitForExtensionReady(page)
  
  // Highlight element for visibility
  async highlightElement(element)
}
```

**Configuration** (via environment variables):
- `SCREENSHOT_WIDTH`: Default 1440px
- `SCREENSHOT_HEIGHT`: Default 900px
- `CLOUDFLARE_EXTENSION_ENABLED`: Enable/disable CloudFlare bypass
- `CLOUDFLARE_BYPASS_TIMEOUT`: Timeout for bypass (default 180000ms)
- `PLAYWRIGHT_USER_DATA_DIR`: Browser user data directory

### B. Standalone Screenshot Service (`services/standaloneScreenshotService.js`)

**Purpose**: Simplified Playwright implementation without extensions

**Key Features**:
- Lightweight browser initialization
- No extension dependencies
- Faster startup time
- Same text-finding strategies
- Simpler error handling

### C. Scrappey Screenshot Service (`services/scrappeyScreenshot.js`)

**Purpose**: Cloud-based screenshot service integration

**Key Features**:
- External API integration
- Handles anti-bot protection
- Returns public URLs or base64 images
- Configurable dimensions
- Upload to cloud storage option

**Configuration**:
- `SCRAPPEY_API_KEY`: API key for Scrappey service

---

## Database Schema

### Screenshots Table

```sql
CREATE TABLE screenshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  message_id UUID REFERENCES brand_messages(id) ON DELETE SET NULL,
  image_url TEXT,                    -- Can be NULL for failed attempts
  original_url TEXT,                 -- The page URL where screenshot was taken
  message_content TEXT,              -- The text that was highlighted/captured
  status TEXT DEFAULT 'success',     -- 'success' or 'failed'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Key Fields**:
- `image_url`: NULL indicates failed capture attempt
- `status`: Tracks success/failure state
- `message_id`: Links to the brand message (SET NULL on message deletion)
- `company_id`: Links to company (CASCADE delete)

---

## API Endpoints

### 1. Generate Screenshot
**Endpoint**: `POST /api/screenshot`

**Request Body**:
```json
{
  "companyId": "uuid",
  "messageId": "uuid",
  "url": "https://example.com/page",
  "text": "Brand message text to find"
}
```

**Response (Success)**:
```json
{
  "success": true,
  "screenshot": {
    "id": "uuid",
    "company_id": "uuid",
    "message_id": "uuid",
    "image_url": "https://storage.url/screenshot.png",
    "original_url": "https://example.com/page",
    "message_content": "Brand message text",
    "status": "success",
    "created_at": "2026-01-13T10:00:00Z"
  }
}
```

**Response (Failure)**:
```json
{
  "success": false,
  "error": "Screenshot capture failed",
  "details": "Could not capture screenshot...",
  "screenshot": {
    "id": "uuid",
    "image_url": null,
    "status": "failed",
    ...
  }
}
```

**Process Flow**:
1. Try Playwright with extensions
2. If fails, try standalone Playwright
3. If fails, try Scrappey API
4. If all fail, create failed record in database
5. Upload successful screenshots to Supabase Storage
6. Mirror to Google Drive (non-blocking)
7. Return screenshot record

### 2. Get Screenshots
**Endpoint**: `GET /api/company/:id/screenshots`

**Response**:
```json
[
  {
    "id": "uuid",
    "company_id": "uuid",
    "message_id": "uuid",
    "image_url": "https://...",
    "original_url": "https://...",
    "message_content": "text",
    "status": "success",
    "created_at": "2026-01-13T10:00:00Z"
  },
  ...
]
```

### 3. Delete Screenshot
**Endpoint**: `DELETE /api/screenshot/:id`

**Response**:
```json
{
  "success": true,
  "message": "Screenshot deleted successfully"
}
```

**Process**:
1. Fetch screenshot record
2. Delete image from Supabase Storage (if exists)
3. Delete database record
4. Return success

### 4. Update Screenshot (Crop/Edit)
**Endpoint**: `PUT /api/screenshot/:id`

**Request Body**:
```json
{
  "image": "data:image/png;base64,..."
}
```

**Process**:
1. Convert base64 to buffer
2. Upload new image to Supabase Storage
3. Delete old image from storage
4. Update database record with new URL
5. Return updated screenshot

### 5. Copy Screenshot (Save as New)
**Endpoint**: `POST /api/screenshot/:id/copy`

**Request Body**:
```json
{
  "image": "data:image/png;base64,..."
}
```

**Process**:
1. Fetch original screenshot metadata
2. Convert base64 to buffer
3. Upload as new image to Supabase Storage
4. Create new database record
5. Return new screenshot record

### 6. Receive HTML Evidence
**Endpoint**: `POST /api/evidence/html`

**Request Body**:
```json
{
  "url": "https://example.com",
  "html": "<html>...</html>",
  "timestamp": "2026-01-13T10:00:00Z",
  "tabId": "123"
}
```

**Purpose**: Receives HTML evidence from CloudFlare bypass extension

---

## Frontend Implementation

### A. Evidence Gallery (`public/proofs.html`)

**Key Features**:
- Grouped by date (latest first)
- Displays both successful and failed screenshots
- Failed attempts show placeholder with "RE-GENERATE" button
- Successful screenshots show:
  - Image preview
  - Message text
  - "Found on" link to original page
  - Edit button (crop/edit)
  - Delete button
  - RE-CAPTURE button
- Lightbox for full-size image viewing
- Crop modal with CropperJS integration
- Export evidences functionality

**Main Functions**:

```javascript
// Load and render all screenshots
async function init()

// Render screenshots grouped by date
function renderAllPages(messages, existingEvidences, company)

// Render single proof card
function renderProofCard(proof, messagesMap, company)

// Re-capture screenshot (for failed or outdated)
async function reCaptureScreenshot(messageId, url, text, screenshotId, event)

// Delete screenshot
async function deleteProof(proofId, cardId, event)

// Edit/crop screenshot
async function editProof(proofId, imageUrl, event)

// Save cropped image
async function saveCroppedImage()

// Open lightbox for full view
function openLightbox(imageUrl)

// Export all evidences
async function exportEvidences()
```

### B. Companies with Evidences List (`public/companies-proofs.html`)

**Features**:
- Lists all companies that have evidence
- Shows evidence count per company
- Click to view company's evidence gallery
- "VIEW EVIDENCES" button

### C. API Client (`public/js/app.js`)

**Screenshot-Related Methods**:

```javascript
window.api = {
  // Generate screenshot
  generateScreenshot: (companyId, messageId, url, text),
  
  // Get all screenshots for company
  getScreenshots: (companyId),
  
  // Delete screenshot
  deleteScreenshot: (screenshotId),
  
  // Update screenshot (replace with cropped)
  updateScreenshot: (screenshotId, base64Image),
  
  // Copy screenshot (save cropped as new)
  copyScreenshot: (screenshotId, base64Image),
  
  // Batch processing utility
  processInBatches: (items, processor, options)
}
```

**Batch Processing**:
- Controlled concurrency (default: 2 concurrent)
- Delays between batches (default: 1500ms)
- Delays within batches (default: 200ms)
- Automatic retries with exponential backoff
- Progress tracking
- Error handling

---

## Screenshot Capture Workflow

### Standard Capture Flow

1. **Initialize Browser**
   - Launch persistent context with extensions
   - Wait for service worker initialization
   - Set viewport dimensions

2. **Navigate to Page**
   - Go to target URL
   - Wait for page load
   - Inject stabilizer script

3. **Detect Issues**
   - Check for CloudFlare challenge
   - Check for error pages (403, 404, etc.)
   - If detected, switch to CloudFlare bypass method

4. **Stabilize Page**
   - Wait for fonts to load
   - Wait for animations to complete
   - Force load lazy content
   - Close popups/modals/cookie banners

5. **Find Target Element**
   - Strategy 1: Custom script (smallest element with full text)
   - Strategy 2: Text split across elements
   - Strategy 3: Playwright's getByText
   - Strategy 4: Search in iframes
   - Strategy 5: Partial text match (first 30 chars)

6. **Prepare Screenshot**
   - Scroll element into view
   - Highlight element with subtle outline
   - Calculate bounding box with context
   - Ensure reasonable dimensions

7. **Capture**
   - Take screenshot (PNG format)
   - Generate unique ID
   - Create metadata object

8. **Upload & Store**
   - Upload to Supabase Storage
   - Get public URL
   - Save record to database
   - Mirror to Google Drive (async)

9. **Return Result**
   - Return screenshot record to frontend
   - Frontend updates UI with new screenshot

### CloudFlare Bypass Flow

1. **Navigate with Extension**
   - Extension detects CloudFlare challenge
   - Automatically solves challenge
   - Sends HTML evidence to backend

2. **Wait for Bypass**
   - Poll for bypass completion
   - Timeout: 3 minutes (configurable)
   - Store HTML evidence path

3. **Continue Standard Flow**
   - Once bypassed, proceed with standard capture
   - Link HTML evidence to screenshot record

### Failed Capture Handling

1. **All Methods Fail**
   - Create database record with `status: 'failed'`
   - Set `image_url` to NULL
   - Store message content and URL

2. **Frontend Display**
   - Show placeholder with warning icon
   - Display "Failed to Capture" message
   - Provide "RE-GENERATE" button
   - Allow deletion of failed attempt

3. **Re-Generation**
   - Delete old failed record
   - Attempt capture again with all three methods
   - Show loading spinner during capture

---

## Text Finding Strategies

### Strategy 1: Custom Script (Smallest Element)
- Searches all text-containing elements
- Case-insensitive matching
- Handles punctuation variations
- Finds smallest element containing text
- Scores based on match quality
- Prefers visible elements

### Strategy 2: Text Split Across Elements
- Handles text split across multiple nodes
- Checks adjacent text nodes
- Finds common ancestor container
- Useful for formatted text (bold, italic, etc.)

### Strategy 3: Playwright's getByText
- Uses Playwright's built-in text locator
- Exact: false for partial matching
- Fallback for simple cases

### Strategy 4: iframe Search
- Searches within all iframes
- Same strategies as main frame
- Handles embedded content

### Strategy 5: Partial Text Match
- Uses first 30 characters
- Last resort when full text not found
- Logs partial match for debugging

---

## Bounding Box Calculation

### Context-Aware Cropping

1. **Find Parent Container**
   - Look up to 5 levels up the DOM
   - Prefer semantic containers (article, section)
   - Avoid large containers (grids, lists)
   - Score based on size ratio

2. **Scoring System**
   - Cards/articles: Score 10
   - Hero/banner: Score 8
   - Small sections: Score 5
   - Small containers: Score 3
   - Too large (>10x element): Score 0

3. **Size Constraints**
   - Add 40px padding around context
   - Min width: 300px, max: 1200px
   - Min height: 200px, max: 800px
   - Ensure within viewport bounds

4. **Adjustment**
   - Adjust X if width exceeds viewport
   - Adjust Y if height exceeds viewport
   - Prevent negative coordinates

---

## Popup/Modal Handling

### Auto-Close Selectors

**Cookie Banners**:
- `[id*="cookie"]`, `[class*="cookie"]`
- `[id*="consent"]`, `[class*="consent"]`
- `[id*="gdpr"]`, `[class*="gdpr"]`
- `[id*="privacy"]`, `[class*="privacy"]`

**Close Buttons**:
- `button[aria-label*="close"]`
- `button[aria-label*="dismiss"]`
- `button[aria-label*="accept"]`
- `.modal-close`, `.popup-close`
- `button:has-text("Accept")`
- `button:has-text("Got it")`
- `button:has-text("×")`

**Process**:
1. Find all matching elements
2. Check visibility
3. Click if visible and matches patterns
4. Wait for animation (500ms)
5. Press Escape key
6. Scroll to top

---

## Error Detection

### CloudFlare Challenge Detection

**Indicators**:
- Body text: "checking your browser", "just a moment"
- DOM elements: `#cf-wrapper`, `.cf-wrapper`
- CloudFlare Ray ID in HTML
- Title contains CloudFlare patterns

### Error Page Detection

**Patterns**:
- "access denied", "403 forbidden"
- "404 not found", "page not found"
- "unauthorized", "blocked"
- "you don't have permission"
- Akamai error pages
- Very short content (<200 chars) with error title

---

## Storage & Mirroring

### Supabase Storage

**Bucket**: `screenshots`

**Path Structure**: `{companyId}/{timestamp}-{random}.png`

**Upload Process**:
1. Convert buffer to PNG
2. Upload with content-type: image/png
3. Get public URL
4. Store URL in database

**Deletion**:
1. Parse URL to extract file path
2. Remove from storage bucket
3. Delete database record

### Google Drive Mirroring

**Purpose**: Backup and organization

**Folder Structure**:
```
Brand Messages/
  └── {Company Name}/
      └── {YYYY-MM-DD}/
          └── {screenshotId}.png
```

**Process** (Non-blocking):
1. Fetch company name
2. Parse created_at date
3. Create folder hierarchy
4. Upload screenshot
5. Log success/failure (doesn't fail request)

---

## Image Editing Features

### Crop/Edit Modal

**Library**: CropperJS v1.5.13

**Features**:
- Free-form cropping
- Aspect ratio preservation (optional)
- Zoom in/out
- Rotate
- Move crop area
- Preview

**Save Modes**:
1. **Save as Copy**: Creates new screenshot record
2. **Replace Original**: Updates existing record

**Process**:
1. Open modal with original image
2. Initialize CropperJS
3. User adjusts crop area
4. Get cropped canvas
5. Convert to base64
6. Send to backend (PUT or POST)
7. Update UI with new image

---

## Export Functionality

### Export All Evidences

**Format**: ZIP file

**Contents**:
- All screenshot images
- Organized by date
- Filename: `{company-name}-evidences-{date}.zip`

**Process**:
1. Fetch all screenshots
2. Download each image
3. Create ZIP archive
4. Trigger browser download

---

## Performance Optimizations

### Browser Context Reuse
- Persistent context across captures
- Reduces initialization overhead
- Handles context crashes gracefully

### Concurrent Processing
- Batch processing with controlled concurrency
- Default: 2 concurrent screenshots
- Configurable delays between batches
- Prevents server overload

### Retry Logic
- Automatic retries on failure
- Exponential backoff
- Max retries: 2 (configurable)
- Retry delay: 1000ms initial

### Lazy Loading
- Images load on scroll
- Reduces initial page load
- Improves perceived performance

---

## Error Handling

### Frontend
- Failed captures show placeholder
- User can retry manually
- Delete failed attempts
- Clear error messages

### Backend
- Graceful fallback between methods
- Detailed error logging
- Failed records stored in database
- Non-blocking Google Drive mirror

### Browser Context
- Auto-recovery from crashes
- Cleanup on errors
- Unique user data directories
- Prevents singleton lock conflicts

---

## Security Considerations

### Input Validation
- URL format validation
- Base64 image validation
- Screenshot ID validation
- Company ID validation

### Storage Security
- Supabase RLS policies
- Public read access
- Service role for writes
- Secure file paths

### API Security
- CORS configuration
- Request validation
- Error message sanitization
- Rate limiting (recommended)

---

## Configuration

### Environment Variables

```bash
# Screenshot Service
SCREENSHOT_WIDTH=1440
SCREENSHOT_HEIGHT=900
PLAYWRIGHT_USER_DATA_DIR=/tmp/playwright-user-data

# CloudFlare Bypass
CLOUDFLARE_EXTENSION_ENABLED=true
CLOUDFLARE_BYPASS_TIMEOUT=180000

# Scrappey API
SCRAPPEY_API_KEY=your_api_key_here

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Google Drive (Optional)
GOOGLE_DRIVE_ENABLED=true
GOOGLE_DRIVE_FOLDER_ID=your_folder_id
```

---

## Monitoring & Logging

### Log Levels

**Info**:
- Screenshot capture start/success
- Method used (Playwright/Scrappey)
- Upload success
- Google Drive mirror success

**Warn**:
- Fallback to next method
- Storage upload failures
- Google Drive mirror failures
- Extension not loaded

**Error**:
- All methods failed
- Database errors
- Critical failures

### Metrics to Track

- Success rate per method
- Average capture time
- Failed capture reasons
- Storage usage
- API costs (Scrappey)

---

## Future Enhancements

### Planned Features
1. Video evidence capture
2. Interactive element highlighting
3. Multiple screenshots per message
4. Screenshot comparison (before/after)
5. OCR text extraction
6. Automated evidence reports
7. Webhook notifications
8. Scheduled re-captures

### Optimization Opportunities
1. CDN integration for faster delivery
2. Image compression/optimization
3. Thumbnail generation
4. Progressive image loading
5. Caching strategies
6. Parallel upload to multiple storage providers

---

## Troubleshooting

### Common Issues

**Issue**: Screenshots fail consistently
- Check browser dependencies
- Verify Playwright installation
- Check CloudFlare extension
- Try Scrappey API

**Issue**: Text not found on page
- Verify text exists on page
- Check for dynamic content
- Try partial text match
- Inspect page source

**Issue**: Storage upload fails
- Check Supabase credentials
- Verify storage bucket exists
- Check file size limits
- Review storage policies

**Issue**: Browser context crashes
- Check memory limits
- Verify user data directory permissions
- Review browser arguments
- Check for conflicting processes

---

## Dependencies

### Backend
- `playwright`: Browser automation
- `uuid`: Unique ID generation
- `axios`: HTTP requests (Scrappey)
- `@supabase/supabase-js`: Database & storage

### Frontend
- `cropperjs`: Image cropping
- Native Fetch API
- Native File API

### Chrome Extensions
- Screenshot Stabilizer (custom)
- CloudFlare Bypass (custom)

---

## Conclusion

The Evidence Capturing Module is a robust, production-ready system that handles the complex task of automatically capturing visual proof of brand messages. Its three-tier fallback approach ensures high success rates, while features like automatic retry, error handling, and failed attempt tracking provide a smooth user experience even when captures fail.

The module is designed to be maintainable, extensible, and scalable, with clear separation of concerns, comprehensive error handling, and detailed logging for monitoring and debugging.
