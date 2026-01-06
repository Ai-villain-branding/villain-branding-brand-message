 const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const ANALYSES_DIR = path.join(DATA_DIR, 'analyses');
const SCREENSHOTS_DIR = path.join(DATA_DIR, 'screenshots');

// Ensure directories exist
async function initStorage() {
  await fs.mkdir(ANALYSES_DIR, { recursive: true });
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
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

module.exports = {
  initStorage,
  saveAnalysis,
  getAnalysis,
  updateAnalysis,
  saveScreenshot,
  getScreenshot,
  getScreenshotMetadata
};
