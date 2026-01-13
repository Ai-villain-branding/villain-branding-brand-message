/**
 * Standalone Screenshot Capture Script
 * 
 * Ready-to-use script for capturing screenshots of web pages.
 * 
 * Setup:
 * 1. npm install playwright
 * 2. npx playwright install chromium
 * 3. node standalone-screenshot.js "https://example.com"
 * 
 * Or use as a module:
 * import { captureScreenshot } from './standalone-screenshot.js';
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };
const WAIT_TIME_AFTER_LOAD = 8000; // milliseconds
const PAGE_LOAD_TIMEOUT = 90000; // milliseconds

// Create screenshots directory if it doesn't exist
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

/**
 * Captures a screenshot of a given URL
 * @param {string} url - The URL to capture
 * @param {Object} options - Optional configuration
 * @param {string} options.outputDir - Custom output directory (default: 'screenshots')
 * @param {Object} options.viewport - Viewport size (default: { width: 1920, height: 1080 })
 * @param {number} options.waitTime - Additional wait time in ms (default: 8000)
 * @param {boolean} options.fullPage - Capture full page (default: true)
 * @param {string} options.userAgent - Custom user agent string
 * @returns {Promise<Object>} Object with success, filename, and filepath
 */
export async function captureScreenshot(url, options = {}) {
  const {
    outputDir = SCREENSHOTS_DIR,
    viewport = DEFAULT_VIEWPORT,
    waitTime = WAIT_TIME_AFTER_LOAD,
    fullPage = true,
    userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  } = options;

  console.log(`Starting screenshot capture for: ${url}`);
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Launch browser
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  try {
    // Create a new browser context with custom settings
    const context = await browser.newContext({
      viewport: viewport,
      userAgent: userAgent
    });
    
    const page = await context.newPage();

    console.log('Navigating to page...');
    
    // Navigate to the URL
    await page.goto(url, {
      waitUntil: 'load',
      timeout: PAGE_LOAD_TIMEOUT
    });

    console.log('Page loaded, waiting for content to load...');
    
    // Wait for page to be fully interactive
    await page.waitForLoadState('domcontentloaded');
    
    // Wait additional time for CloudFlare checks and dynamic content
    await page.waitForTimeout(waitTime);
    
    // Try to wait for body element
    try {
      await page.waitForSelector('body', { timeout: 10000 });
    } catch (e) {
      console.log('Body selector not found, continuing anyway...');
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const urlSlug = url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    const filename = `screenshot_${urlSlug}_${timestamp}.png`;
    const filepath = path.join(outputDir, filename);

    console.log('Capturing screenshot...');
    
    // Take screenshot
    await page.screenshot({
      path: filepath,
      fullPage: fullPage,
      type: 'png'
    });

    console.log(`✓ Screenshot saved successfully!`);
    console.log(`  File: ${filepath}`);
    console.log(`  URL: ${url}`);

    await browser.close();
    
    return { 
      success: true, 
      filename, 
      filepath,
      url 
    };
  } catch (error) {
    console.error('Error capturing screenshot:', error);
    await browser.close();
    throw error;
  }
}

// If run directly from command line
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2];
  
  if (!url) {
    console.error('Usage: node standalone-screenshot.js <URL>');
    console.error('Example: node standalone-screenshot.js "https://example.com"');
    process.exit(1);
  }
  
  captureScreenshot(url)
    .then((result) => {
      console.log('\nScreenshot capture completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\nScreenshot capture failed:', error.message);
      process.exit(1);
    });
}

