# Changelog

All notable changes to the Brand Messaging Analyzer project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Universal Website Bypass System**: Aggressive consent/modal neutralization that works across all websites
  - Enhanced CMP neutralization script to override consent APIs (OneTrust, Cookiebot, IAB TCF, Quantcast)
  - Aggressive modal/dialog hiding targeting ALL dialogs, modals, popups, chat widgets, newsletter popups, location selectors
  - MutationObserver + timed intervals to detect and remove overlays dynamically
  - DOM cleanup method that physically removes elements from DOM (not just CSS hiding)
  - Enhanced CSS overlay removal to hide all modals, dialogs, chat widgets, and high z-index elements
  - Successfully tested on Samsung, ClickUp, Stripe, and Notion websites with 100% success rate

- **Search Functionality**: Real-time search bars added to all listing pages
  - Messages page (`company.html`): Search by message content, reasoning, or message type
  - Individual proofs page (`proofs.html`): Search by message text or URL
  - Companies list page (`companies.html`): Search by company name or URL
  - Company evidences page (`companies-proofs.html`): Search by company name or URL
  - Shows "No results found" message when search returns empty
  - CSS styling with focus states for better UX

- **Loading State Persistence**: Analysis progress persists across page navigations
  - Uses localStorage to save analysis state (URL, mode, pages, progress, logs)
  - Automatically restores analysis UI when returning to dashboard during ongoing analysis
  - Shows reconnection message and fetches fresh progress from server
  - Clears state on completion or error

- **Cleanup Utility**: Periodic cleanup of temporary browser directories
  - Automatically removes temporary Playwright/Puppeteer directories
  - Improved error handling for cleanup operations
  - Prevents disk space issues from accumulated temp files

### Fixed
- **Consent Neutralizer**: Expanded overlay hiding strategy to cover all modals and dialogs
- **Screenshot Quality**: Improved by avoiding hover menus and closing more popups
- **Polling Issues**: 
  - Fixed cache-busting to prevent 304 responses
  - Corrected malformed template literals in frontend polling
  - Fixed polling to get pending IDs from DOM when sessionStorage is empty
  - Added auto-reload on polling completion
- **Supabase Updates**: Added error checking to prevent silent failures
- **Screenshot Service**: 
  - Corrected extension paths and batch property names
  - Removed `captured_at` from screenshot update to prevent conflicts
- **Parallel Execution**: Resolved unknown errors and parallel execution issues
- **Content Fetching**: Fixed Zendesk and Asana content fetching
- **HTML Templates**: Fixed formatting in proofs.html
- **Column Names**: Used correct column names (`original_url`) for screenshots table

### Changed
- **Popup Closing Strategy**: More aggressive approach to closing popups and overlays
- **Bot Detection Avoidance**: Enhanced stealth measures and added CAPTCHA page detection
- **Content Extraction**: 
  - Improved Playwright content extraction with scrolling and simpler text capture
  - Implemented robust pipeline with Shadow DOM and iframe support
- **Screenshot Capture**: Implemented robust pipeline with stealth, fuzzy matching, and aggressive consent neutralization
- **Message Page Layout**: Standardized layout across all message-related pages
- **Evidence Layout**: Standardized evidence display and cleaned up project structure

### Removed
- Unused Zendesk and OneTrust debug scripts
- Redundant files from project structure
- Duplicate code in delete screenshot functionality

## [1.0.0] - 2024

### Added
- **Core Features**:
  - Smart web crawling with domain-scoped BFS traversal
  - AI-powered message extraction using GPT-4
  - Automated screenshot capture with context-aware bounding boxes
  - Modern responsive UI with real-time progress tracking
  - Message analytics with frequency tracking and deduplication

- **Analysis Modes**:
  - Full website scraping mode
  - Specific pages mode for targeted analysis
  - Streaming analysis with real-time progress updates (SSE)

- **Message Categorization**:
  - Theme-based categories (1-3 words)
  - Message grouping by themes
  - Category-based message organization

- **Screenshot Management**:
  - Parallel screenshot generation with live status updates
  - Failed screenshot tracking with re-generate option
  - Screenshot cropping and editing
  - Copy screenshot functionality
  - Delete screenshot with proper state management

- **Google Drive Integration**:
  - Screenshot mirroring to Google Drive
  - OAuth2 authentication support
  - Automatic backup of generated screenshots

- **Database**:
  - Supabase integration for data persistence
  - Migration system for schema updates
  - Support for analysis modes, categorization, and screenshot status tracking

- **UI Components**:
  - Custom centered alert and confirm dialogs
  - Delete buttons for companies and messages
  - Batch evidence capturing interface
  - Real-time progress indicators
  - Responsive grid layouts

- **API Endpoints**:
  - `/api/analyze` - Start website analysis
  - `/api/analyze-stream` - Streaming analysis with SSE
  - `/api/companies` - Get all companies
  - `/api/companies-with-proofs` - Get companies with evidence counts
  - `/api/company/:id/messages` - Get company messages
  - `/api/company/:id/categories` - Get message categories
  - `/api/company/:id/screenshots` - Get company screenshots
  - `/api/screenshot` - Generate screenshot
  - `/api/screenshot/:id` - Update/delete screenshot
  - `/api/screenshot/:id/copy` - Copy screenshot
  - `/api/company/:id` - Delete company
  - `/api/message/:id` - Delete message
  - `/api/health` - Health check

### Technical Stack
- **Backend**: Node.js, Express
- **Database**: Supabase (PostgreSQL)
- **AI**: OpenAI GPT-4
- **Web Scraping**: Axios, Cheerio
- **Browser Automation**: Playwright (primary), Puppeteer (fallback), Selenium (fallback)
- **Frontend**: Vanilla HTML, CSS, JavaScript
- **Storage**: Supabase Storage for screenshots

### Documentation
- Comprehensive README with installation and usage instructions
- Migration guide for database schema updates
- Cookie consent implementation documentation
- Evidence capturing module documentation
- Fallback engine troubleshooting guide
- Message deletion implementation guide
- Final status report

---

## Legend

- **Added**: New features
- **Changed**: Changes in existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Security improvements
