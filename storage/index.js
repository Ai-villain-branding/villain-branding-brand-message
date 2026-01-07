 const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../data');
const ANALYSES_DIR = path.join(DATA_DIR, 'analyses');
const SCREENSHOTS_DIR = path.join(DATA_DIR, 'screenshots');
const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.join(__dirname, '..', 'evidence');

// Ensure directories exist
async function initStorage() {
  await fs.mkdir(ANALYSES_DIR, { recursive: true });
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
}

// Analysis storage
async function saveAnalysis(analysisId, data) {
  const filePath = path.join(ANALYSES_DIR, `${analysisId}.json`);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function getAnalysis(analysisId) {
  const filePath = path.join(ANALYSES_DIR, `${analysisId}.json`);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function updateAnalysis(analysisId, updates) {
  const existing = await getAnalysis(analysisId);
  if (!existing) {
    throw new Error(`Analysis ${analysisId} not found`);
  }
  const updated = { ...existing, ...updates };
  await saveAnalysis(analysisId, updated);
  return updated;
}

// Screenshot storage
async function saveScreenshot(screenshotId, imageBuffer, metadata) {
  const imagePath = path.join(SCREENSHOTS_DIR, `${screenshotId}.png`);
  const metadataPath = path.join(SCREENSHOTS_DIR, `${screenshotId}.json`);
  
  await fs.writeFile(imagePath, imageBuffer);
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
}

async function getScreenshot(screenshotId) {
  const imagePath = path.join(SCREENSHOTS_DIR, `${screenshotId}.png`);
  const metadataPath = path.join(SCREENSHOTS_DIR, `${screenshotId}.json`);
  
  try {
    const [imageBuffer, metadataStr] = await Promise.all([
      fs.readFile(imagePath),
      fs.readFile(metadataPath, 'utf-8')
    ]);
    
    return {
      image: imageBuffer,
      metadata: JSON.parse(metadataStr)
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function getScreenshotMetadata(screenshotId) {
  const metadataPath = path.join(SCREENSHOTS_DIR, `${screenshotId}.json`);
  
  try {
    const data = await fs.readFile(metadataPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

// HTML Evidence storage
async function saveHtmlEvidence(htmlContent, url, metadata = {}) {
  try {
    // Ensure evidence directory exists
    await fs.mkdir(EVIDENCE_DIR, { recursive: true });
    
    // Extract domain from URL
    let domain = 'unknown';
    try {
      const urlObj = new URL(url);
      domain = urlObj.hostname.replace(/^www\./, '');
    } catch (e) {
      // Invalid URL, use 'unknown'
    }
    
    // Generate filename: {domain}_{timestamp}_{uuid}.html
    const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '-'); // YYYY-MM-DD
    const uuid = uuidv4().substring(0, 8);
    const filename = `${domain}_${timestamp}_${uuid}.html`;
    const filePath = path.join(EVIDENCE_DIR, filename);
    
    // Save HTML file
    await fs.writeFile(filePath, htmlContent, 'utf-8');
    
    // Create metadata object
    const evidenceMetadata = {
      filePath: filePath,
      relativePath: `evidence/${filename}`,
      url: url,
      domain: domain,
      timestamp: metadata.timestamp || new Date().toISOString(),
      ...metadata
    };
    
    // Save metadata JSON file
    const metadataPath = filePath.replace('.html', '.json');
    await fs.writeFile(metadataPath, JSON.stringify(evidenceMetadata, null, 2), 'utf-8');
    
    return {
      filePath: filePath,
      relativePath: evidenceMetadata.relativePath,
      filename: filename,
      metadata: evidenceMetadata
    };
  } catch (error) {
    console.error('Error saving HTML evidence:', error);
    throw error;
  }
}

async function getHtmlEvidence(filePath) {
  try {
    // If relative path, resolve to full path
    const fullPath = filePath.startsWith('/') || filePath.startsWith('\\') 
      ? filePath 
      : path.join(EVIDENCE_DIR, filePath);
    
    const htmlContent = await fs.readFile(fullPath, 'utf-8');
    
    // Try to load metadata
    const metadataPath = fullPath.replace('.html', '.json');
    let metadata = null;
    try {
      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      metadata = JSON.parse(metadataContent);
    } catch (e) {
      // Metadata file doesn't exist, that's okay
    }
    
    return {
      html: htmlContent,
      filePath: fullPath,
      metadata: metadata
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

module.exports = {
  initStorage,
  saveAnalysis,
  getAnalysis,
  updateAnalysis,
  saveScreenshot,
  getScreenshot,
  getScreenshotMetadata,
  saveHtmlEvidence,
  getHtmlEvidence,
  EVIDENCE_DIR
};
