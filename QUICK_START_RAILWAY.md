# Quick Start: Deploy to Railway

## 🚀 Fast Deployment Steps

### 1. Push to GitHub
```bash
git add .
git commit -m "Ready for Railway deployment"
git push origin main
```

### 2. Create Railway Project
1. Go to [railway.app](https://railway.app)
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your repository
4. Railway will auto-detect Node.js

### 3. Add Environment Variables
In Railway dashboard → **Variables** tab, add:

```
OPENAI_API_KEY=sk-proj-...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
```

### 4. Deploy
Railway will automatically:
- ✅ Install dependencies
- ✅ Install Playwright Chromium
- ✅ Start your app

### 5. Get Your URL
- Railway provides a URL automatically
- Or generate a custom domain in **Settings** → **Networking**

## ⚠️ Important Notes

1. **Never commit `.env` files** - Use Railway's environment variables
2. **Port is auto-set** - Railway sets `PORT` automatically
3. **First deploy takes 3-5 minutes** - Installing Playwright takes time
4. **Check logs** if something fails - Railway dashboard → Deployments → Logs

## 📝 Full Guide
See `RAILWAY_DEPLOYMENT.md` for detailed instructions.

