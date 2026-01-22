# Deployment Guide - Tracker26

Deploy your Tracker26 app to production in minutes!

## 🚀 Deployment Options

### Option 1: Vercel (Recommended - Easiest)

Vercel is built by the creators of Next.js and offers the best integration.

#### Steps:

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```

2. **Deploy to Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Click "Import Project"
   - Select your GitHub repository
   - Vercel will auto-detect Next.js

3. **Add Environment Variables**
   - In Vercel dashboard, go to Settings → Environment Variables
   - Add: `DATABASE_URL` with your MongoDB connection string
   - Save and redeploy

4. **Done!** 🎉
   - Your app is live at `https://your-app.vercel.app`
   - Auto-deploys on every push to main

### Option 2: Railway

Great for full-stack apps with database hosting.

#### Steps:

1. **Create Railway Account**
   - Go to [railway.app](https://railway.app)
   - Sign up with GitHub

2. **New Project from GitHub**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your tracker26 repository

3. **Add Environment Variables**
   - In project settings, add `DATABASE_URL`
   - Railway will auto-detect Next.js

4. **Generate Domain**
   - Go to Settings → Generate Domain
   - Your app is live!

### Option 3: Netlify

Another excellent serverless option.

#### Steps:

1. **Connect Repository**
   - Go to [netlify.com](https://netlify.com)
   - Click "Add new site" → "Import from Git"
   - Connect to GitHub and select repo

2. **Build Settings**
   - Build command: `npm run build`
   - Publish directory: `.next`

3. **Environment Variables**
   - Site settings → Environment variables
   - Add `DATABASE_URL`

4. **Deploy**
   - Click "Deploy site"

### Option 4: DigitalOcean App Platform

For more control and traditional hosting.

#### Steps:

1. **Create App**
   - Go to [digitalocean.com](https://digitalocean.com)
   - Create → Apps → GitHub

2. **Configure**
   - Build command: `npm run build`
   - Run command: `npm start`

3. **Environment Variables**
   - Add `DATABASE_URL` in app settings

4. **Deploy**

## 🗄️ MongoDB Setup for Production

### MongoDB Atlas (Recommended)

1. **Create Production Cluster**
   - Upgrade from free tier if needed
   - Choose region closest to your deployment

2. **Security Settings**
   - Database Access: Create a new user for production
   - Network Access: Add deployment platform IPs
     - Vercel: Allow all (0.0.0.0/0) or specific IPs
     - Railway: Check their IP list
     - Or whitelist all: 0.0.0.0/0

3. **Get Connection String**
   ```
   mongodb+srv://username:password@cluster.mongodb.net/tracker26?retryWrites=true&w=majority
   ```

4. **Update Environment Variable**
   - Use production connection string
   - Never expose in code!

## ⚙️ Build Configuration

### Verify Your Settings

**package.json** should have:
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "postinstall": "prisma generate"
  }
}
```

**next.config.ts** is minimal:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
```

## 🔐 Security Checklist

Before deploying:

- [ ] `.env.local` is in `.gitignore`
- [ ] Never commit sensitive keys
- [ ] Use strong MongoDB passwords
- [ ] Enable MongoDB network access restrictions
- [ ] Use HTTPS (automatic on Vercel/Netlify/Railway)
- [ ] Consider adding authentication (NextAuth.js)

## 🧪 Pre-Deployment Testing

Test locally in production mode:

```bash
# Build the app
npm run build

# Start production server
npm start
```

Visit [http://localhost:3000](http://localhost:3000) and test all features.

## 📊 Post-Deployment Steps

1. **Seed Production Database** (if needed)
   ```bash
   # Set DATABASE_URL to production
   npm run seed
   ```

2. **Test All Pages**
   - Dashboard
   - Categories
   - Accounts
   - Expenses
   - Income
   - Debts
   - Goals

3. **Monitor Performance**
   - Check loading times
   - Verify charts render
   - Test on mobile devices

4. **Set Up Custom Domain** (Optional)
   - Most platforms support custom domains
   - Add your domain in platform settings
   - Update DNS records

## 🐛 Troubleshooting

### Build Fails

**Error**: "Cannot find module '@prisma/client'"
```bash
# Ensure postinstall script runs
npm install
npx prisma generate
```

**Error**: "DATABASE_URL is not defined"
- Add environment variable in deployment platform
- Restart deployment

### Runtime Errors

**Error**: "PrismaClientInitializationError"
- Check MongoDB connection string
- Verify network access in MongoDB Atlas
- Ensure database exists

**Error**: "Cannot connect to database"
- Check if MongoDB cluster is active
- Verify IP whitelist includes deployment IPs
- Test connection string locally

### Performance Issues

**Slow loading**:
- Enable caching in deployment settings
- Optimize images (use next/image)
- Check MongoDB query performance

## 💡 Pro Tips

1. **Use Preview Deployments**
   - Test changes before merging to main
   - Vercel/Netlify create previews automatically

2. **Monitor Costs**
   - MongoDB Atlas free tier: 512MB
   - Vercel free tier: Good for personal use
   - Upgrade as needed

3. **Set Up Analytics**
   - Add Vercel Analytics
   - Monitor user behavior
   - Track performance

4. **Regular Backups**
   - Use MongoDB Atlas automatic backups
   - Export data regularly
   - Keep local development copy

## 📈 Scaling Considerations

When your app grows:

1. **Database**
   - Upgrade MongoDB tier
   - Add indexes for performance
   - Consider read replicas

2. **Hosting**
   - Upgrade to paid tier
   - Enable edge functions
   - Add CDN for static assets

3. **Monitoring**
   - Set up error tracking (Sentry)
   - Add performance monitoring
   - Configure uptime monitoring

## 🎯 Quick Deploy Commands

```bash
# Build and test locally
npm run build
npm start

# Deploy via Git (Vercel/Netlify/Railway)
git add .
git commit -m "Deploy to production"
git push origin main
# Automatic deployment triggers!

# Manual deploy (if using Vercel CLI)
npm i -g vercel
vercel --prod
```

## ✅ Deployment Checklist

Pre-deployment:
- [ ] All features tested locally
- [ ] Environment variables set
- [ ] MongoDB cluster configured
- [ ] Build succeeds locally
- [ ] Git repository is clean

Post-deployment:
- [ ] App loads successfully
- [ ] Database connection works
- [ ] All pages accessible
- [ ] Charts render correctly
- [ ] Forms submit successfully
- [ ] Custom domain configured (if applicable)

## 🎉 You're Live!

Congratulations! Your Tracker26 app is now deployed and ready to use.

**Next Steps:**
- Share with friends and family
- Add your financial data
- Monitor and maintain regularly
- Consider adding authentication
- Gather user feedback

---

Need help? Check the [README.md](README.md) or [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) for more information.

Happy deploying! 🚀
