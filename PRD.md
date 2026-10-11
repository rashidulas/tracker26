# Tracker26 — Product Requirements Document

**Product:** Tracker26 — Personal Finance Manager  
**Document type:** Product Requirements Document (as-built + remaining work)  
**Version:** 1.0  
**Date:** 2026-08-24  
**Status:** Living spec based on the current codebase  
**Owner:** Rashidul (personal product)

---

## 1. Overview

Tracker26 is a single-user personal finance web app for tracking money across accounts, spending, income, transfers, debts, investments, and savings goals.

It is a self-hosted / locally run Next.js application backed by MongoDB. There is no multi-user auth, no bank aggregation, and no public signup. The user is the product owner and the only intended operator.

**One-line vision:** Give one person a complete, private picture of their money — balances, cash flow, debt, investments, and goals — without connecting a bank.

---

## 2. Problem statement

People already have checking accounts, credit cards, cash, investments, and debts, but those live in different apps. Spreadsheets can track this, but they are slow to update, easy to break, and weak at visualization.

Tracker26 exists so the user can:

- Log income and expenses quickly (including from a receipt photo)
- See account balances that stay consistent after expenses, income, and transfers
- Separate credit-card debt from cash so net worth is not misleading
- Track loans and savings goals next to day-to-day spending
- Review spending and income with filters and charts

---

## 3. Goals and non-goals

### 3.1 Product goals

| Priority | Goal |
| --- | --- |
| P0 | Accurate account balances from starting balance + income − expenses + transfers |
| P0 | Fast manual entry of expenses and income with categories |
| P0 | A dashboard that answers “how am I doing this month?” in one screen |
| P1 | Credit-card / debt payments that move money between accounts without double-counting as lifestyle spend |
| P1 | Filtered expense and income analytics |
| P1 | Receipt scanning that drafts an expense the user can review |
| P2 | Investment holdings with gain/loss |
| P2 | Savings goals with contribution progress |
| P2 | Monthly category budgets |

### 3.2 Non-goals (out of scope for this product)

- Multi-user accounts, login, roles, or sharing
- Bank / Plaid / open-banking sync
- Automatic investment price feeds
- Tax filing, invoicing, or payroll
- Multi-currency
- Mobile native apps
- Collaborative household budgets with permissions

---

## 4. Users and context

| Persona | Description | Needs |
| --- | --- | --- |
| Primary user (owner) | One person managing their own finances | Speed of entry, trust in balances, monthly overview |
| Future (not supported) | Partner / household | Shared view — explicitly out of scope |

**Usage context**

- Desktop for review and charts
- Phone for adding an expense or scanning a receipt
- Dark UI, USD only, English

**Assumptions**

- The operator has a MongoDB Atlas (or local) database
- They will seed or create their own categories and accounts
- Receipt scanning is optional and requires a Gemini API key

---

## 5. Product principles

1. **Balances must be derived, not guessed.** Current balance = starting balance + income − expenses + inbound transfers.
2. **Review before commit.** AI receipt scans never auto-save; the user confirms.
3. **Payments are not lifestyle expenses.** Paying a card or moving money between accounts is a transfer, not “Dining Out.”
4. **Fail visibly.** If the database is down, the dashboard shows a connection warning instead of fake zeros with no explanation.
5. **One currency, one timezone convention.** Display money in USD. Dates are stored as UTC and shown in UTC to avoid day-shift bugs.

---

## 6. Information architecture

```
/                    → redirect to /dashboard
/dashboard           Main overview
/categories          Income / expense taxonomy
/accounts            Banks, cash, cards, investment accounts
/expenses            Expense list + add / scan / payment modes
/income              Income list + add / edit
/expenses-dashboard  Filtered expense analytics
/income-dashboard    Filtered income analytics
/transfers           Account-to-account transfers
/debts               Loans and debt payments
/investments         Holdings and portfolio stats
/goals               Savings goals and contributions
/budgets             Placeholder (not built)
/reports             Linked in nav; page does not exist
```

**Sidebar modules (current nav)**

Dashboard · Categories · Accounts · Expenses · Income · Expense Dashboard · Income Dashboard · Transfers · Debts · Investments · Goals · Budgets · Reports

---

## 7. Feature requirements

Status key: **Shipped** · **Partial** · **Placeholder** · **Missing**

---

### 7.1 Dashboard — `/dashboard` — **Shipped**

**Purpose:** Monthly financial overview.

**Must show**

- Total balance across all accounts (starting balance ± transactions ± transfers in)
- Cash & accounts total (everything except `CREDIT_CARD`)
- Monthly income and monthly expenses, with % change vs last month
- Credit card debt cards: current balance, month-start marker, usage bar, month delta
- Daily spending area chart for the current month
- Last 10 transactions
- Current-month budget progress (if any budgets exist)
- 12-month income vs expenses trend
- Total debt (from Debt records) and total savings (sum of goal contributions)

**Behavior**

- Home `/` redirects to `/dashboard`
- Page is always dynamic (`force-dynamic`, `revalidate = 0`)
- On DB failure: yellow warning + empty dashboard, not a crash

**Known limitation**

- Credit-card usage bars assume a **$10,000 limit**. Limits are not stored per account.

**Acceptance criteria**

- Given accounts and transactions exist, Total Balance equals the sum of computed account balances
- Credit card section is hidden when there are no credit-card accounts
- Budget panel shows “No budgets set” when none exist for the current month

---

### 7.2 Categories — `/categories` — **Shipped**

**Purpose:** Taxonomy for income and expenses.

**Fields**

| Field | Rules |
| --- | --- |
| Name | Required, max 50 (validation lib) / required (server) |
| Type | `INCOME` or `EXPENSE` |
| Color | Hex, default `#6B7280` |
| Icon | Optional emoji / short string |

**CRUD**

- Create, edit, delete
- List shows transaction count
- Delete is blocked if the category still has transactions

**Seed defaults (via `npm run seed`)**

Income: Salary, Freelance, Investments, Other Income  
Expense: Groceries, Dining Out, Transportation, Utilities, Rent/Mortgage, Healthcare, Entertainment, Shopping, Travel, Education, Insurance, Other Expenses

The app also auto-creates **Payment** and **Debt Payment** categories when those flows run.

**Acceptance criteria**

- Expense forms only list `EXPENSE` categories
- Income forms only list `INCOME` categories
- Deleting a used category shows a clear error with the transaction count

---

### 7.3 Accounts — `/accounts` — **Shipped**

**Purpose:** Places money lives.

**Types:** `CHECKING` · `SAVINGS` · `CASH` · `CREDIT_CARD` · `INVESTMENT`

**Fields:** name, type, institution (optional), starting balance

**Computed**

- `currentBalance` = startingBalance + income − expenses + transfers in
- Transaction count (from + to)

**Rules**

- Delete blocked if the account has outgoing transactions (`accountId` matches)
- Investment holdings can only be attached to accounts of type `INVESTMENT`

**Acceptance criteria**

- Paying a credit card from checking decreases checking and increases the card account
- Changing starting balance immediately changes the displayed current balance

---

### 7.4 Expenses — `/expenses` — **Shipped**

**Purpose:** Record spending and special payment flows.

**List**

- Month selector (current month default, plus months that have data, plus “All Months”)
- Filters: start/end date, category, search (merchant or notes)
- Columns: date, merchant, category, account, amount, tags, actions
- Edit / delete
- Empty and error states

**Add expense (regular)**

Required: date, amount (> 0), category  
Optional: account, merchant/source, notes, tags (comma-separated)

**Add payment (from the expense form)**

Two special category sentinels:

| Mode | What it does |
| --- | --- |
| Payment | Transfer from account A → account B, tagged `payment`, category “Payment” |
| Debt Payment | Transfer from cash account → card/debt account, tagged `debt-payment`, category “Debt Payment” |

These create a `TRANSFER` row, not an `EXPENSE` row. They still appear in the expenses list because the list includes transfers tagged `payment`.

**Receipt scan — Partial (depends on `GEMINI_API_KEY`)**

1. User uploads a photo or camera capture
2. Gemini 2.0 Flash extracts merchant, date, total, category, line items, notes, tags, confidence
3. User reviews and can edit every field
4. Only then is an expense saved

Scan never auto-commits. If the image is not a receipt, the API returns 422.

**Backend support not exposed in this UI**

- Split expenses (multiple categories that must sum to the total) exist in `transactions/actions` and the schema (`splitItems`) but there is no split UI on the expense form.

**Acceptance criteria**

- Regular expense reduces the selected account’s current balance
- Payment / Debt Payment does not create a second “expense” that also reduces the destination card as spend
- Receipt scan with no API key fails with a clear configuration error
- Delete asks for confirmation

---

### 7.5 Income — `/income` — **Shipped**

**Purpose:** Record money in.

**Fields:** date, amount (> 0), income category (required), account (required), source/merchant, notes, tags

**List:** filters for date range, category, search; edit / delete

**Acceptance criteria**

- Income increases the selected account’s current balance
- Only `INCOME` categories appear in the picker

---

### 7.6 Transfers — `/transfers` — **Shipped**

**Purpose:** Move money between two accounts without calling it income or expense.

**Fields:** date, amount, from account, to account, notes

**Rules**

- From and to cannot be the same account
- Kind is `TRANSFER`
- Affects both accounts’ computed balances

**Acceptance criteria**

- Transfer $100 from Checking → Savings: Checking −100, Savings +100, monthly income/expense unchanged

---

### 7.7 Expense Dashboard — `/expenses-dashboard` — **Shipped**

**Purpose:** Analyze spending.

**Filters:** date range, amount range, multi-category, multi-account, text search  
**Summary:** total, average per day, count, top 5 categories  
**Charts:** category pie, daily trend line  
**Table:** sortable by date / amount / category; inline edit / delete

---

### 7.8 Income Dashboard — `/income-dashboard` — **Shipped**

**Purpose:** Analyze income.

**Filters:** date range, amount range, source (income categories), account, search  
**Summary:** total, avg/day, avg/month, count, source breakdown  
**Charts:** source bar chart, daily trend  
**Table:** sortable; delete (edit modal exists but is a thinner flow than Expenses)

---

### 7.9 Debts — `/debts` — **Shipped**

**Purpose:** Track loans and cards as standalone liabilities (separate from credit-card *accounts*).

**Debt fields:** name, type (`CREDIT_CARD`, `PERSONAL_LOAN`, `STUDENT_LOAN`, `MORTGAGE`, `AUTO_LOAN`, `OTHER`), current balance, APR, min payment, due day (1–31)

**Payment flow**

1. User records a payment from an account
2. App creates a `DebtPayment`
3. App creates an `EXPENSE` transaction in category “Debt Payment” tagged `debt-payment`
4. Debt `currentBalance` decreases, never below 0

**Important product tension**

There are **two debt models**:

| Model | Where | How balance changes |
| --- | --- | --- |
| Credit-card **account** | Accounts + Dashboard | Derived from transactions/transfers |
| **Debt** record | Debts page + dashboard “Total Debt” | Manually stored; reduced by Debts-page payments |

Paying a card via Expenses → Debt Payment updates the *account* balance. Paying via Debts → Payment updates the *Debt* record and also posts an expense. These are not automatically linked.

**Acceptance criteria**

- Creating a debt shows it on the Debts page and in dashboard Total Debt
- A Debts-page payment reduces the debt balance and appears under Expenses as Debt Payment

---

### 7.10 Investments — `/investments` — **Partial**

**Purpose:** Manual portfolio tracker.

**Shipped UI**

- Add / edit / delete holding: symbol, name, quantity, avg cost, last price, investment account
- Manual last-price update
- Stats: market value, total cost, total gain, return %
- Contribution history bar chart (last 12 months of BUY + CONTRIBUTION amounts)

**Computed per holding**

- Market value = quantity × last price
- Gain = market value − (quantity × avg cost)
- Gain % = (last price − avg cost) / avg cost

**Backend exists, UI missing**

Buy, sell, contribution, withdrawal, and dividend *transactions* can update holdings (including weighted-average cost on buys and deleting a holding at qty 0). There is no investments transaction UI.

Prices are **manual only**. No ticker API.

**Acceptance criteria**

- Holdings require an account of type `INVESTMENT`
- Updating last price recalculates gain/loss without changing quantity or cost basis

---

### 7.11 Goals — `/goals` — **Shipped (with a gap)**

**Purpose:** Savings targets.

**Fields:** name, target amount (> 0), optional due date

**Progress:** sum of contributions / target, capped at 100% on the bar

**Contribution:** date, amount, from account, notes

**Gap:** a contribution does **not** create a transfer or expense. Account balances do not change when money is “contributed” to a goal. Progress is bookkeeping only.

**Acceptance criteria**

- Progress bar and remaining amount update after a contribution
- Deleting a goal removes it and its contributions (cascade)

---

### 7.12 Budgets — `/budgets` — **Placeholder**

**Intended (from schema, validations, dashboard)**

- One budget per category per month (`@@unique([month, categoryId])`)
- Amount to spend that month
- Dashboard already reads current-month budgets and compares them to actual expenses
- Validation lib also describes `rolloverEnabled` — **not in the Prisma schema**

**Current UI:** “coming soon” empty state.

**Required to ship**

- Create / edit / delete monthly category budgets
- Month picker
- Spent vs budgeted vs remaining
- Over-budget highlighting (dashboard already does this if rows exist)

---

### 7.13 Reports — `/reports` — **Missing**

Nav item exists. No route, no page.

**Recommended v1**

- Date-range net cash flow
- Category breakdown
- Account activity
- CSV export of transactions (`exportTransactionsToCSV` already exists in `transactions/actions` and is unused by any page)

---

### 7.14 Health check — `/api/health` — **Shipped**

Returns `{ status, database, categories, timestamp }` after a Prisma connect + category count. Used for ops, not shown in the UI.

---

## 8. User stories

### Foundation

- As a user, I can open the app and land on the dashboard without logging in.
- As a user, I can create income and expense categories with a name, color, and icon.
- As a user, I can create accounts with a type and starting balance and see a live current balance.

### Cash flow

- As a user, I can add an expense to a category and optional account.
- As a user, I can add income to a category and account.
- As a user, I can transfer money between two different accounts.
- As a user, I can pay a credit card from checking as a transfer, not as a restaurant expense.
- As a user, I can filter expenses by month, date, category, and text.
- As a user, I can scan a receipt, review the extracted fields, and save an expense.

### Insight

- As a user, I can see this month’s income, expenses, cash, and card debt on one page.
- As a user, I can see a 12-month income vs expense trend.
- As a user, I can filter the expense dashboard and see totals, a pie chart, and a daily trend.
- As a user, I can filter the income dashboard by source and account.

### Liabilities and assets

- As a user, I can track a student loan / mortgage with APR, min payment, and due day.
- As a user, I can record a debt payment that lowers the remaining balance.
- As a user, I can add stock/ETF holdings and update last price to see gain/loss.
- As a user, I can set a savings goal and log contributions toward it.

### Planned

- As a user, I can set a monthly budget per category and see progress on the dashboard. *(data model ready, UI not)*
- As a user, I can open Reports and export transactions to CSV. *(export helper ready, page not)*

---

## 9. Data model

MongoDB via Prisma. IDs are ObjectIds.

```
Category 1──* Transaction
Category 1──* Budget
Account  1──* Transaction (from)
Account  1──* Transaction (to)
Account  1──* DebtPayment
Account  1──* InvestmentHolding
Account  1──* InvestmentTransaction
Account  1──* GoalContribution
Debt     1──* DebtPayment
Goal     1──* GoalContribution
InvestmentHolding 1──* InvestmentTransaction
```

### 9.1 Enums

| Enum | Values |
| --- | --- |
| CategoryType | INCOME, EXPENSE |
| AccountType | CHECKING, SAVINGS, CREDIT_CARD, CASH, INVESTMENT |
| TransactionKind | INCOME, EXPENSE, TRANSFER |
| DebtType | CREDIT_CARD, STUDENT_LOAN, MORTGAGE, PERSONAL_LOAN, AUTO_LOAN, OTHER |
| InvestmentTransactionType | BUY, SELL, DIVIDEND, CONTRIBUTION, WITHDRAWAL |

### 9.2 Core records

**Transaction**

- date, amount, kind
- optional category, from account, to account
- merchantOrSource, notes, tags[]
- splitItems[] `{ categoryId, amount, notes }`

**Account balance (application rule, not a stored field)**

```
current = startingBalance
         + SUM(INCOME on this account)
         − SUM(EXPENSE on this account)
         + SUM(TRANSFER into this account)
```

Outbound transfers are stored as `kind: TRANSFER` on the from-account and are **not** subtracted in the income/expense branch (they are skipped). Inbound transfers are added via `transactionsTo`. This means a transfer only changes the destination unless outbound TRANSFER amounts are also subtracted — **verify when implementing new money-movement features.** Current account code only subtracts EXPENSE and adds INCOME on `transactionsFrom`, plus all `transactionsTo`. Outbound transfers therefore do not reduce the from-account in `getAccounts` unless they are also modeled another way.

> Implementation note for future work: `getAccounts` and dashboard balance math skip `TRANSFER` on `transactionsFrom`. The from-account is only reduced if a separate EXPENSE is posted, or if transfer-out is added to the formula. Payment/debt-payment transfers rely on this. Any change to balance math must be regression-tested on Checking → Card payments.

**Budget:** month (first of month), categoryId, amount. Unique per month + category.

**InvestmentHolding:** symbol, name, quantity, avgCostBasis, lastPrice, accountId.

---

## 10. Technical requirements

| Layer | Choice |
| --- | --- |
| App | Next.js 15 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS, dark zinc + emerald, Framer Motion |
| Charts | Recharts |
| Forms | react-hook-form + Zod |
| Data | Prisma 5 + MongoDB |
| AI | Google Gemini 2.0 Flash (`@google/generative-ai`) |
| Server mutations | Next.js server actions |
| Toasts | In-app `ToastProvider` |

**Environment**

| Variable | Required | Use |
| --- | --- | --- |
| `DATABASE_URL` | Yes | MongoDB connection |
| `GEMINI_API_KEY` | No | Receipt scanning |

**Scripts**

- `npm run dev` — local server (default http://localhost:3000)
- `npm run build` / `start` — production
- `npm run seed` — default categories, sample accounts, one debt, one goal
- `postinstall` — `prisma generate`

**Responsive**

- Collapsible mobile nav, fixed desktop sidebar (256px)
- Viewport locked (`userScalable: false`) for a more app-like feel
- Tables scroll horizontally on small screens

---

## 11. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Performance | Dashboard should load without client-side waterfalls for the first paint (server-fetched). Analytics pages may refetch on filter change. |
| Reliability | Server actions return `{ success, error }` for user-facing CRUD. Dashboard degrades with a visible DB error. |
| Security | Single-operator app. No auth. `.env` is gitignored. Anyone who can reach the server can read/write all data. |
| Privacy | Financial data stays in the user’s MongoDB. Receipt images are sent to Google Gemini when scanning. |
| Accessibility | Semantic buttons/labels exist; no full a11y audit. Confirm dialogs for deletes. |
| Localization | en-US, USD only. |
| Observability | `/api/health` for DB connectivity. |

**Security implication (must stay in the PRD):** this is not safe on a public URL without adding authentication.

---

## 12. UX requirements

- Dark theme (`zinc-950` background, emerald accents)
- Modals for create/edit
- Toast feedback on transfers, investments, dashboards
- Confirm before delete
- Empty states with a short explanation and a primary action
- Currency formatted with `Intl.NumberFormat` (en-US, USD)
- Touch targets ~44px on mobile

---

## 13. Gaps, inconsistencies, and follow-up work

Ranked for a personal-finance product.

### P0 — correctness / trust

1. **Unify balance math for outbound transfers.** Document and test whether `TRANSFER` from an account reduces that account. If it does not, payment UX and account totals can disagree.
2. **Unify debt.** Credit-card accounts and Debt records can represent the same card twice (dashboard card section vs Total Debt). Decide: cards are accounts only, or debts only, or they must be linked.
3. **Goal contributions should move money** (transfer to a “goals” bucket or reduce the source account) *or* the UI should state that contributions are tracking-only.

### P1 — advertised but incomplete

4. **Build Budgets CRUD** so the dashboard Budget Progress panel is usable.
5. **Build Reports** or remove it from the nav.
6. **Credit limits** per card instead of hardcoded $10,000.
7. **Wire CSV export** to a button (expenses, income, or reports).

### P2 — latent backend

8. Split-expense UI (schema + server already support it).
9. Investment buy/sell/dividend UI (server already supports it).
10. Live prices (optional; currently manual).
11. Auth if the app is ever deployed beyond localhost.

### P3 — polish

12. Budget rollover (in Zod, not in schema).
13. `originalAmount` on Debt exists in Prisma and is unused.
14. Dual validation (page-level Zod vs `lib/validations.ts`) should be consolidated.
15. Goal contributions do not appear as transactions in Recent Transactions.

---

## 14. Success metrics (personal product)

There is no analytics pipeline. Treat these as operator checks:

| Metric | Target |
| --- | --- |
| Time to log a known expense | < 30 seconds |
| Receipt scan → saved expense | < 2 minutes including review |
| Dashboard usable without a manual refresh after add | After navigation / revalidate |
| Account balance matches “what I think I have” after a week of use | No unexplained drift |
| Monthly review (expense + income dashboards) | Possible in one sitting without exporting to a spreadsheet |

---

## 15. Launch / readiness

| Item | Status |
| --- | --- |
| Local run with `.env` + MongoDB | Ready |
| Seed data | Ready (`npm run seed`) |
| Core money movement (income, expense, transfer) | Ready |
| Dashboard | Ready |
| Receipt scan | Ready if Gemini key is set |
| Budgets | Not ready |
| Reports | Not ready |
| Auth / multi-user / public deploy | Not ready |
| Automated test suite | Not present |

**Minimum viable “daily driver”**

Categories + Accounts + Expenses + Income + Transfers + Dashboard.

Everything else is additive.

---

## 16. Appendix — route and action map

| Surface | Server entry |
| --- | --- |
| Dashboard | `app/dashboard/actions.ts` → `getDashboardData` |
| Categories | `app/categories/actions.ts` |
| Accounts | `app/accounts/actions.ts` |
| Expenses | `app/expenses/actions.ts` + `ReceiptScanner` → `POST /api/scan-receipt` |
| Income | `app/income/actions.ts` |
| Transfers | `app/transactions/actions.ts` |
| Expense / Income dashboards | `app/dashboards/actions.ts` |
| Debts | `app/debts/actions.ts` |
| Investments | `app/investments/actions.ts` |
| Goals | `app/goals/actions.ts` |
| Health | `app/api/health/route.ts` |

---

*This PRD describes the product as implemented on 2026-08-24, plus the unfinished modules already promised in navigation and schema. Update this file when Budgets, Reports, auth, or balance-math rules change.*
