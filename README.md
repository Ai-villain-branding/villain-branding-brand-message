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

4. **Configure environment variables**
   
   Copy `.env.example` to `.env` and add your OpenAI API key:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and set:
   ```
   OPENAI_API_KEY=your_actual_api_key_here
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
  "url": "https://example.com"
}
```

### GET /api/analysis/:id
Get analysis status and progress

### GET /api/messages/:analysisId
Get extracted messages with categories and frequencies

### POST /api/screenshots
Generate screenshots for selected messages
```json
{
  "analysisId": "uuid",
  "selectedMessages": ["msg-1", "msg-2"]
}
```

### GET /api/screenshots/:jobId
Get screenshot job status

### GET /api/screenshots/:id/image
Retrieve screenshot image (PNG)

## Configuration

Environment variables in `.env`:

- `OPENAI_API_KEY` - Your OpenAI API key (required)
- `PORT` - Server port (default: 3000)
- `MAX_CRAWL_PAGES` - Maximum pages to crawl (default: 50)
- `MAX_CRAWL_DEPTH` - Maximum crawl depth (default: 3)
- `CRAWL_DELAY_MS` - Delay between requests (default: 1000)
- `REQUEST_TIMEOUT_MS` - Request timeout (default: 30000)
- `SCREENSHOT_WIDTH` - Screenshot viewport width (default: 1200)
- `SCREENSHOT_HEIGHT` - Screenshot viewport height (default: 800)

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
