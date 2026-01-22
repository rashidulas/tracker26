# Quick Start Guide - Tracker26

Get up and running with Tracker26 in 5 minutes!

## Step 1: Install Dependencies (2 min)

```bash
npm install
```

## Step 2: Set Up MongoDB (1 min)

### MongoDB Atlas (Recommended for beginners)

1. Go to [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
2. Sign up for free
3. Create a cluster (choose free tier)
4. Click "Connect" → "Connect your application"
5. Copy the connection string

### Create .env.local

Create a file named `.env.local` in your project root:

```env
DATABASE_URL="mongodb+srv://username:password@cluster.mongodb.net/tracker26?retryWrites=true&w=majority"
```

Replace with your actual MongoDB connection string!

## Step 3: Initialize Database (1 min)

```bash
# Generate Prisma Client
npx prisma generate

# Create database tables
npx prisma db push

# (Optional) Add starter data
npm run seed
```

## Step 4: Start the App (30 seconds)

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Step 5: Start Using! (30 seconds)

The app redirects to the Dashboard. Start by:

1. **Add Categories** - Go to `/categories` and create your first category
2. **Add Account** - Go to `/accounts` and add a checking account
3. **Add Transaction** - Go to `/expenses` or `/income` and record your first transaction
4. **View Dashboard** - Check your financial overview!

## Common Issues

### "Cannot connect to database"
- Check your `DATABASE_URL` in `.env.local`
- Make sure MongoDB Atlas whitelist includes your IP (0.0.0.0/0 for testing)

### "Module not found"
```bash
npm install
npx prisma generate
```

### "Cannot find .env.local"
Make sure you created `.env.local` (not `.env`) in the root folder!

## Next Steps

- Customize categories for your lifestyle
- Add all your accounts
- Set up debts you're tracking
- Create savings goals
- Start recording transactions daily

## Need Help?

Check the full [README.md](README.md) for detailed documentation!

---

Happy budgeting! 💰
