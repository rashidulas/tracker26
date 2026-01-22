# Tracker26 - Personal Finance Manager

A comprehensive personal finance and budgeting web application built with Next.js 15, TypeScript, MongoDB, and Prisma.

## 🚀 Features

### Core Functionality

- **Categories Management** - Create custom income/expense categories with colors and icons
- **Accounts Management** - Track checking, savings, cash, credit cards, and investment accounts
- **Expense Tracking** - Add, filter, and manage expenses with merchant info and tags
- **Income Tracking** - Record and categorize income from various sources
- **Debt Tracking** - Monitor credit cards, loans, and other debts with payment history
- **Goals & Savings** - Set savings goals and track contributions with progress bars
- **Investment Tracking** - Placeholder for manual investment portfolio tracking
- **Budget Management** - Placeholder for monthly budget planning
- **Dashboard** - Visual overview with charts and recent transactions

### Technical Features

- **Server Actions** - CRUD operations using Next.js Server Actions
- **Zod Validation** - Client and server-side form validation
- **React Hook Form** - Optimized form handling
- **Recharts** - Beautiful, responsive charts
- **MongoDB** - NoSQL database with Prisma ORM
- **Responsive Design** - Mobile-friendly UI with Tailwind CSS

## 🛠️ Tech Stack

- **Framework**: Next.js 15+ (App Router)
- **Language**: TypeScript
- **Database**: MongoDB with Prisma ORM
- **Styling**: Tailwind CSS
- **Forms**: React Hook Form + Zod
- **Charts**: Recharts
- **Icons**: Lucide React
- **Date Handling**: date-fns

## 📋 Prerequisites

- Node.js 18+ 
- MongoDB Atlas account (or local MongoDB installation)
- npm or yarn package manager

## 🏁 Getting Started

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd tracker26
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up MongoDB

#### Option A: MongoDB Atlas (Cloud)

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free account and cluster
3. Click "Connect" on your cluster
4. Choose "Connect your application"
5. Copy the connection string

#### Option B: Local MongoDB

```bash
# Install MongoDB locally
brew install mongodb-community@7.0  # macOS
# or follow instructions for your OS

# Start MongoDB
brew services start mongodb-community@7.0
```

### 4. Configure Environment Variables

Create a `.env.local` file in the root directory:

```env
# For MongoDB Atlas
DATABASE_URL="mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<database>?retryWrites=true&w=majority"

# For Local MongoDB
# DATABASE_URL="mongodb://localhost:27017/tracker26"
```

Replace `<username>`, `<password>`, `<cluster>`, and `<database>` with your actual MongoDB credentials.

### 5. Initialize Prisma

Generate the Prisma Client:

```bash
npx prisma generate
```

Push the schema to your database:

```bash
npx prisma db push
```

### 6. Seed the Database (Optional)

Populate your database with starter categories and accounts:

```bash
npx tsx prisma/seed.ts
```

This will create:
- 16 default categories (income and expense)
- 5 sample accounts
- 1 sample debt
- 1 sample savings goal

### 7. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

The app will redirect you to `/dashboard`.

## 📁 Project Structure

```
tracker26/
├── app/                      # Next.js App Router
│   ├── accounts/            # Accounts management
│   ├── budgets/             # Budget planning
│   ├── categories/          # Category management
│   ├── dashboard/           # Main dashboard with charts
│   ├── debts/               # Debt tracking
│   ├── expenses/            # Expense tracking
│   ├── goals/               # Savings goals
│   ├── income/              # Income tracking
│   ├── investments/         # Investment tracking
│   ├── layout.tsx           # Root layout
│   └── page.tsx             # Home page (redirects to dashboard)
├── components/              # Reusable UI components
│   ├── Button.tsx
│   ├── ChartCard.tsx
│   ├── Input.tsx
│   ├── Modal.tsx
│   ├── Navigation.tsx
│   ├── Select.tsx
│   └── SummaryCard.tsx
├── lib/
│   └── prisma.ts           # Prisma client singleton
├── prisma/
│   ├── schema.prisma       # Database schema
│   └── seed.ts             # Database seeding script
└── package.json
```

## 🗄️ Database Schema

### Models

- **Category** - Income/expense categories
- **Account** - Financial accounts
- **Transaction** - Unified income/expense/transfer transactions
- **Debt** - Debt tracking
- **DebtPayment** - Payment history for debts
- **Goal** - Savings goals
- **GoalContribution** - Contributions to goals
- **Budget** - Monthly budgets per category
- **InvestmentHolding** - Manual investment holdings
- **InvestmentTransaction** - Investment transactions

## 🎨 Key Pages

### Dashboard (`/dashboard`)
- Monthly income/expense summary
- Total debt and savings
- Expenses by category (pie chart)
- 12-month income vs expenses trend (bar chart)
- Recent transactions table

### Categories (`/categories`)
- List all categories
- Add/edit/delete categories
- Prevents deletion if transactions exist

### Accounts (`/accounts`)
- View all accounts with current balances
- Add/edit/delete accounts
- Total balance card

### Expenses (`/expenses`)
- Add expense transactions
- Filter by date range, category, search
- Edit/delete transactions

### Income (`/income`)
- Add income transactions
- Filter and search functionality
- Transaction management

### Debts (`/debts`)
- Track multiple debts
- Record payments (updates balance)
- View payment history

### Goals (`/goals`)
- Create savings goals
- Track progress with visual bars
- Add contributions

## 🔧 Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm start            # Start production server
npm run lint         # Run ESLint

npx prisma generate  # Generate Prisma Client
npx prisma db push   # Push schema to database
npx prisma studio    # Open Prisma Studio (database GUI)
npx tsx prisma/seed.ts  # Seed database
```

## 🚀 Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Go to [Vercel](https://vercel.com)
3. Import your repository
4. Add your `DATABASE_URL` environment variable
5. Deploy!

### Other Platforms

The app can be deployed to any platform that supports Next.js:
- Netlify
- Railway
- AWS Amplify
- Digital Ocean App Platform

Make sure to:
1. Set the `DATABASE_URL` environment variable
2. Run `npm run build` to build the app
3. Use `npm start` to run the production server

## 📝 Usage Tips

1. **Start with Categories** - Create your custom income and expense categories
2. **Set Up Accounts** - Add all your financial accounts with starting balances
3. **Record Transactions** - Add income and expenses regularly
4. **Track Debts** - Add any debts and record payments to track payoff progress
5. **Set Goals** - Create savings goals and track contributions
6. **Review Dashboard** - Check your financial overview regularly

## 🔐 Security Notes

- Never commit `.env.local` to version control
- Use strong MongoDB credentials
- Enable MongoDB network access restrictions
- Consider implementing authentication for production use

## 🤝 Contributing

This is a personal finance app. Feel free to fork and customize for your needs!

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

## 🐛 Troubleshooting

### Prisma Connection Issues

If you get connection errors:
```bash
npx prisma generate
npx prisma db push --force-reset
```

### Module Not Found Errors

```bash
rm -rf node_modules package-lock.json
npm install
```

### MongoDB Connection Issues

1. Check your `DATABASE_URL` in `.env.local`
2. Verify MongoDB Atlas whitelist includes your IP
3. Ensure your MongoDB user has proper permissions

## 📧 Support

For issues or questions, please open an issue in the repository.

---

Built with ❤️ using Next.js 15, TypeScript, and MongoDB

**Year 2026 Edition** 🚀
