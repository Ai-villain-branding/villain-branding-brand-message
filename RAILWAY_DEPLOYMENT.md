# Railway Deployment Guide

This guide will help you deploy your Brand Messaging Analyzer application to Railway.

## Prerequisites

1. A Railway account (sign up at [railway.app](https://railway.app))
2. A GitHub account (for connecting your repository)
3. Your API keys:
   - OpenAI API Key
   - Supabase URL, Anon Key, and Service Role Key

## Step 1: Prepare Your Repository

1. **Remove hardcoded secrets** (already done in config.js)
2. **Commit all changes** to your repository:
   ```bash
   git add .
   git commit -m "Prepare for Railway deployment"
   git push
   ```

## Step 2: Create a Railway Project

1. Go to [railway.app](https://railway.app) and sign in
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose your repository
5. Railway will automatically detect it's a Node.js project

## Step 3: Configure Environment Variables

In your Railway project dashboard:

1. Go to your project → **Variables** tab
2. Add the following environment variables:

### Required Variables:

```
OPENAI_API_KEY=your_openai_api_key_here
SUPABASE_URL=your_supabase_url_here
SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
```

### Optional Variables (with defaults):

```
PORT=3000
MAX_CRAWL_PAGES=50
MAX_CRAWL_DEPTH=3
CRAWL_DELAY_MS=1000
REQUEST_TIMEOUT_MS=30000
SCREENSHOT_WIDTH=1440
SCREENSHOT_HEIGHT=900
```

**Note:** Railway automatically sets `PORT`, so you don't need to set it manually unless you want to override it.

## Step 4: Configure Build Settings

Railway will automatically:
- Detect Node.js from `package.json`
- Run `npm install`
- Install Playwright Chromium (via postinstall script)
- Start the app with `npm start`

If you need to customize, you can use the `railway.json` or `nixpacks.toml` files included in the project.

## Step 5: Deploy

1. Railway will automatically deploy when you push to your connected branch
2. Or click **"Deploy"** in the Railway dashboard
3. Wait for the build to complete (usually 2-5 minutes)

## Step 6: Get Your Public URL

1. Once deployed, Railway will provide a public URL
2. Go to **Settings** → **Networking** → **Generate Domain**
3. Or use the default Railway domain (e.g., `your-app.up.railway.app`)

## Step 7: Update Supabase CORS (if needed)

If you're using Supabase storage, you may need to add your Railway domain to Supabase CORS settings:

1. Go to your Supabase project → Settings → API
2. Add your Railway domain to allowed origins

## Troubleshooting

### Build Fails

- **Issue:** Playwright installation fails
- **Solution:** The postinstall script includes `|| true` to prevent failures. Check Railway logs for specific errors.

### App Crashes on Start

- **Issue:** Missing environment variables
- **Solution:** Check that all required environment variables are set in Railway dashboard

### Screenshots Not Working

- **Issue:** Playwright browser not found
- **Solution:** Ensure the postinstall script ran successfully. Check build logs.

### Port Issues

- **Issue:** App not accessible
- **Solution:** Railway sets PORT automatically. Make sure your server.js uses `process.env.PORT`

## Monitoring

- View logs in Railway dashboard → **Deployments** → Click on a deployment → **View Logs**
- Set up alerts in Railway dashboard → **Settings** → **Notifications**

## Updating Your App

Simply push to your connected GitHub branch, and Railway will automatically redeploy:

```bash
git add .
git commit -m "Your changes"
git push
```

## Cost Considerations

- Railway offers a free tier with $5 credit/month
- Playwright/Chromium installation uses build time
- Consider using Railway's usage dashboard to monitor costs
- For production, consider upgrading to a paid plan for better performance

## Security Notes

- ✅ Never commit `.env` files (already in `.gitignore`)
- ✅ Use Railway's environment variables for secrets
- ✅ Rotate API keys regularly
- ✅ Use Supabase RLS (Row Level Security) for database access

## Support

- Railway Docs: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
- Check Railway status: https://status.railway.app

