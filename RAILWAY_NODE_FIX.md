# Railway Node.js Installation Fix

## Issue
Railway is not detecting/installing Node.js automatically, causing "npm: command not found" error.

## Solution

### Option 1: Set NODE_VERSION Environment Variable (Recommended)

1. Go to Railway Dashboard → Your Project → Variables
2. Add environment variable:
   - **Key**: `NODE_VERSION`
   - **Value**: `20`

This will force Railway to install Node.js 20.

### Option 2: Use Railway's Service Settings

1. Go to Railway Dashboard → Your Project → Service
2. Click on **Settings**
3. Under **Build & Deploy**, look for Node.js version setting
4. Set it to **20** or **20.x**

### Option 3: Railway should auto-detect from package.json

The `package.json` has:
```json
"engines": {
  "node": ">=20.0.0",
  "npm": ">=9.0.0"
}
```

Railway should detect this automatically. If it doesn't, use Option 1 or 2 above.

## After Setting NODE_VERSION

Railway will automatically:
1. Install Node.js 20
2. Run `npm install`
3. Install Playwright Chromium (via postinstall script)
4. Start your app with `npm start`

