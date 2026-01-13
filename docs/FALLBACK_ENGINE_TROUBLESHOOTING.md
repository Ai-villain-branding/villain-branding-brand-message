# Fallback Engine Troubleshooting Guide

## Issues and Solutions

### Issue 1: ChromeDriver Version Mismatch

**Error**:
```
This version of ChromeDriver only supports Chrome version 119
Current browser version is 143.0.7499.170
```

**Root Cause**: The installed ChromeDriver version doesn't match your Chrome browser version.

**Solution**:
1. Updated `package.json` to use `chromedriver@^131.0.0` (matches Chrome 143)
2. Run: `npm install chromedriver@latest`

---

### Issue 2: Puppeteer Browser Launch Failure

**Error**:
```
Failed to launch the browser process!
WARNING:mach_o_image_annotations_reader.cc(92)] unexpected crash info version 7
```

**Root Cause**: Puppeteer's bundled Chromium has compatibility issues with macOS (especially on Apple Silicon/Rosetta).

**Solutions**:

**Option A: Use System Chrome** (Recommended)
```javascript
// In puppeteerFallback.js
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    // ... other args
  ]
});
```

**Option B: Disable Puppeteer Fallback**
```bash
# In .env
ENABLE_PUPPETEER_FALLBACK=false
```

---

### Issue 3: Page Detected as "Blocked or Inaccessible"

**Error**:
```
Page is blocked or inaccessible. Error: ClickUp™ | Privacy Policy
```

**Root Cause**: The error detection logic is too aggressive and flags legitimate pages.

**Solution**: The page title contains "Privacy Policy" which triggers the error detector. This is actually a false positive - the page loaded successfully but was flagged as an error.

**Fix**: Refine error detection to be less aggressive with privacy/policy pages.

---

## Recommended Configuration

For most use cases, **Playwright alone is sufficient**. The fallback engines add complexity and potential compatibility issues.

### Recommended .env Settings:

```bash
# Cookie Consent Handling (Layers 1-4 with Playwright)
CONSENT_NETWORK_BLOCKING_ENABLED=true
CONSENT_CSS_INJECTION_ENABLED=true
CONSENT_LOGGING_LEVEL=info

# Disable fallback engines (Playwright is working fine)
ENABLE_PUPPETEER_FALLBACK=false
ENABLE_SELENIUM_FALLBACK=false
```

### When to Enable Fallback Engines:

Only enable if:
1. You're experiencing frequent Playwright failures
2. You need maximum resilience for critical production use
3. You've properly configured them for your environment

### Setup Fallback Engines (Optional):

```bash
# Install latest versions
npm install puppeteer@latest selenium-webdriver@latest chromedriver@latest

# Configure to use system Chrome
# Edit puppeteerFallback.js to add executablePath
```

---

## Current Status

✅ **Playwright (Primary)**: Working correctly  
✅ **Layers 1-3**: All activating successfully  
✅ **Cookie Consent Blocking**: Blocking OneTrust and other providers  
❌ **Puppeteer Fallback**: Browser launch issues (can be fixed or disabled)  
❌ **Selenium Fallback**: ChromeDriver version mismatch (can be fixed or disabled)  

**Recommendation**: Disable fallback engines and rely on Playwright + Scrappey API fallback (which is already working).
