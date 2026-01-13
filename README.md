# Brand Messaging Analyzer

AI-powered brand messaging analysis and visual validation system that crawls websites, extracts brand messages using GPT-4, and captures pixel-perfect screenshots showing where each message appears.

## Features

- 🕷️ **Smart Web Crawling**: Domain-scoped crawler with intelligent page prioritization
- 🤖 **AI Message Extraction**: GPT-4 powered analysis to identify and categorize brand messages
- 📸 **Visual Validation**: Automated screenshot capture with context-aware bounding boxes
- 🎨 **Modern UI**: Beautiful, responsive interface with real-time progress tracking
- 📊 **Message Analytics**: Frequency tracking, deduplication, and categorization

## Installation

1. **Clone or navigate to the project directory**

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Install Playwright browsers**
   ```bash
   npx playwright install chromium
   ```

4. **Set up Supabase database**
   
   Run the database schema and migrations in order:
   ```bash
   # 1. Base schema
   node run_schema.js "your_supabase_connection_string"
   
   # 2. Run migrations (in order)
   # Via Supabase Dashboard SQL Editor, or using psql:
   psql "your_connection_string" -f migration_add_analysis_mode.sql
   psql "your_connection_string" -f migration_add_categorization.sql
   psql "your_connection_string" -f migration_add_screenshot_status.sql
   ```
   
   See `MIGRATION_GUIDE.md` for detailed migration instructions.

5. **Configure environment variables**
   
   Create a `.env` file with required variables:
   ```bash
   # Required
   OPENAI_API_KEY=your_openai_api_key
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   
   # Optional
   PORT=3000
   SCRAPPEY_API_KEY=your_scrappey_key  # For screenshot fallback
   GOOGLE_DRIVE_CLIENT_ID=your_client_id  # For Google Drive mirroring
   GOOGLE_DRIVE_CLIENT_SECRET=your_client_secret
   GOOGLE_DRIVE_REFRESH_TOKEN=your_refresh_token
   ```

## Usage

1. **Start the server**
   ```bash
   npm start
   ```
   
   For development with auto-reload:
   ```bash
   npm run dev
   ```

2. **Open your browser**
   
   Navigate to `http://localhost:3000`

3. **Analyze a website**
   
   - Enter a website URL (e.g., `https://stripe.com`)
   - Wait for crawling and AI analysis to complete
   - Review extracted messages and select ones to validate
   - Generate screenshots to see visual proof

## How It Works

### 1. Web Crawling
The crawler starts from your input URL and discovers internal pages using BFS traversal. It prioritizes important pages like homepage, about, products, features, and pricing while respecting:
- Domain boundaries (same-domain only)
- Crawl limits (max 50 pages, depth 3)
- Rate limiting (1 second between requests)
- Canonical URLs and duplicate prevention

### 2. Content Extraction
Each page is parsed to extract clean, human-visible content by:
- Removing scripts, styles, navigation, and clutter
- Preserving semantic structure (headings, paragraphs)
- Extracting metadata (title, description, H1 tags)
- Weighting content by importance (hero sections, CTAs, features)

### 3. AI Analysis
GPT-4 analyzes the extracted content to identify exact brand messages in these categories:
- **Positioning Statements** (10-25 words)
- **Value Propositions** (8-20 words)
- **Taglines** (3-10 words)
- **Differentiators** (5-15 words)
- **Trust Signals** (3-12 words)
- **Feature Descriptions** (5-20 words)
- **Benefit Statements** (5-18 words)
- **Capability Claims** (4-15 words)

Messages are deduplicated and tracked across all pages where they appear.

### 4. Screenshot Capture
For selected messages, the system:
- Launches a headless browser (Playwright)
- Navigates to each URL containing the message
- Locates the exact DOM element with the text
- Calculates a context-aware bounding box (includes surrounding design)
- Captures high-resolution screenshots
- Stores images with metadata

## API Endpoints

### POST /api/analyze
Start website analysis
```json
{
  "url": "https://example.com",
  "mode": "full_website",  // or "specific"
  "pages": ["https://example.com/page1"]  // required if mode is "specific"
}
```

### GET /api/companies
Get all companies with analysis results

### GET /api/company/:id/messages
Get brand messages for a company
- Query param: `?include_categories=true` to include category info

### GET /api/company/:id/categories
Get message categories with grouped messages

### GET /api/company/:id/screenshots
Get all screenshots (proofs) for a company

### POST /api/screenshot
Generate screenshot for a message
```json
{
  "companyId": "uuid",
  "messageId": "uuid",
  "url": "https://example.com/page",
  "text": "Message text to capture"
}
```

### PUT /api/screenshot/:id
Update screenshot with cropped image (base64)

### POST /api/screenshot/:id/copy
Create a copy of screenshot with cropped image

### DELETE /api/screenshot/:id
Delete a screenshot

### DELETE /api/company/:id
Delete a company and all associated data

### POST /api/company/:id/cleanup-duplicates
Merge duplicate messages for a company

### GET /api/health
Health check endpoint - verifies database and service connectivity

## Configuration

### Environment Variables

**Required:**
- `OPENAI_API_KEY` - Your OpenAI API key
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key

**Optional:**
- `PORT` - Server port (default: 3000)
- `SCRAPPEY_API_KEY` - For screenshot fallback service
- `GOOGLE_DRIVE_CLIENT_ID` - For Google Drive mirroring
- `GOOGLE_DRIVE_CLIENT_SECRET` - For Google Drive mirroring
- `GOOGLE_DRIVE_REFRESH_TOKEN` - For Google Drive mirroring
- `SCREENSHOT_WIDTH` - Screenshot viewport width (default: 1920)
- `SCREENSHOT_HEIGHT` - Screenshot viewport height (default: 1080)
- `CLOUDFLARE_EXTENSION_ENABLED` - Enable CloudFlare bypass (default: true)
- `CLOUDFLARE_BYPASS_TIMEOUT` - Bypass timeout in ms (default: 180000)

## Project Structure

```
.
├── server.js                 # Express API server
├── services/
│   ├── crawler.js           # Web crawler
│   ├── contentExtractor.js  # Content extraction
│   ├── aiExtractor.js       # AI message analysis
│   └── screenshotService.js # Screenshot capture
├── storage/
│   └── index.js             # File storage layer
├── public/
│   ├── index.html           # Landing page
│   ├── review.html          # Message review interface
│   ├── gallery.html         # Screenshot gallery
│   ├── css/
│   │   └── styles.css       # Design system
│   └── js/
│       └── app.js           # API client
└── data/                    # Storage (created automatically)
    ├── analyses/            # Analysis metadata
    └── screenshots/         # Screenshot images
```

## Technologies

- **Backend**: Node.js, Express
- **Web Crawling**: Axios, Cheerio
- **AI**: OpenAI GPT-4
- **Screenshots**: Playwright (Chromium)
- **Frontend**: Vanilla HTML, CSS, JavaScript

## License

MIT
