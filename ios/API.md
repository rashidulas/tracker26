# Tracker26 Mobile API — v1 contract

The iOS app talks to the Next.js app through JSON route handlers under `/api/v1`.
This document is the contract between `app/api/v1/**` (server) and `ios/Tracker26` (client).

## Conventions

| Topic | Rule |
| --- | --- |
| Base URL | `https://<your-host>/api/v1` |
| Auth | Every request sends `Authorization: Bearer <MOBILE_API_TOKEN>`. Missing/wrong token → `401 {"error":"Unauthorized"}`. If the server has no `MOBILE_API_TOKEN` env var set → `503 {"error":"Mobile API is disabled. Set MOBILE_API_TOKEN on the server."}` |
| Success | `2xx` with body `{ "data": <payload> }` |
| Error | `4xx/5xx` with body `{ "error": "Human readable message" }` |
| Content type | `application/json` (except `assistant/transcribe`, which is `multipart/form-data`) |
| Transaction dates | `"YYYY-MM-DD"` strings. Stored as UTC midnight (`new Date("YYYY-MM-DD")`), returned via `toISOString().slice(0,10)` |
| Timestamps | ISO 8601 strings (`createdAt`, `generatedAt`) |
| Money | JSON numbers in USD dollars (floats). Amounts are always positive; direction comes from `kind` / `type` |
| Optional strings | Send `null` or omit. Empty strings are treated as `null` by the server |
| Partial update | `PATCH` bodies use the same shape as `POST`; the server treats them as full replacement of the editable fields |

## Shared shapes

```ts
type AccountType = 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD' | 'CASH' | 'INVESTMENT' | 'LOAN'
type CategoryType = 'INCOME' | 'EXPENSE'
type TransactionKind = 'INCOME' | 'EXPENSE' | 'TRANSFER'
type FriendEntryType = 'THEY_OWE_ME' | 'I_OWE_THEM' | 'THEY_PAID_ME' | 'I_PAID_THEM'

type AccountDTO = {
  id: string; name: string; type: AccountType; institution: string | null
  startingBalance: number; creditLimit: number | null
  currentBalance: number          // computed with lib/accountBalance (same as web)
  transactionCount: number        // from + to
}

type SubcategoryDTO = { id: string; name: string }

type CategoryDTO = {
  id: string; name: string; type: CategoryType; color: string; icon: string | null
  subcategories: SubcategoryDTO[]   // sorted by name
  transactionCount: number
}

type CategoryRef = { id: string; name: string; type: CategoryType; color: string; icon: string | null }
type AccountRef  = { id: string; name: string; type: AccountType }

type TransactionDTO = {
  id: string
  date: string                      // YYYY-MM-DD
  amount: number
  kind: TransactionKind
  categoryId: string | null
  subcategoryId: string | null
  accountId: string | null
  toAccountId: string | null
  merchantOrSource: string | null
  notes: string | null
  tags: string[]
  accountSplits: { accountId: string; amount: number }[]   // income split across accounts ([] when single account)
  category: CategoryRef | null
  subcategory: SubcategoryDTO | null
  account: AccountRef | null
  toAccount: AccountRef | null
}

type FriendEntryDTO = {
  id: string; friendId: string; date: string /*YYYY-MM-DD*/; amount: number
  type: FriendEntryType; description: string | null; notes: string | null
}

type FriendDTO = {
  id: string; name: string; notes: string | null; color: string
  balance: number                 // + they owe you, − you owe them (lib/friends signedFriendAmount)
  entries: FriendEntryDTO[]       // date desc
}
```

## Endpoints

### Health
- `GET /health` → `{ status: "ok", categories: number, accounts: number, serverTime: ISO }`

### Dashboard
- `GET /dashboard` →
```ts
{
  totalBalance: number; cashBalance: number
  monthIncome: number; monthExpenses: number
  lastMonthIncome: number; lastMonthExpenses: number
  creditCards: { id; name; institution: string|null; currentBalance: number; balanceAtMonthStart: number; creditLimit: number|null }[]
  loans:       { id; name; institution: string|null; currentBalance: number; balanceAtMonthStart: number }[]
  friends: { id; name; color; balance: number; entryCount: number }[]   // sorted by |balance| desc
  friendsOwedToYou: number; friendsYouOwe: number
  categoryData: { categoryId: string; name: string; value: number; color: string; icon: string|null }[]  // this month's EXPENSE by category, value desc
  monthlyTrend: { month: "YYYY-MM"; label: "Oct"; income: number; expenses: number }[]  // 12 entries, oldest first
  dailySpending: { date: "YYYY-MM-DD"; amount: number }[]   // each day from month start to today
  recentTransactions: TransactionDTO[]                        // 10 latest, date desc
}
```

### Accounts
- `GET /accounts` → `AccountDTO[]` (sorted by name)
- `POST /accounts` body `{ name, type, institution?, startingBalance, creditLimit? }` → `201 AccountDTO` (`creditLimit` only kept for `CREDIT_CARD`)
- `PATCH /accounts/:id` same body → `AccountDTO`
- `DELETE /accounts/:id` → `{ id }`; `409` if the account still has transactions (same rule as web)

### Categories
- `GET /categories?type=EXPENSE|INCOME` (type optional) → `CategoryDTO[]` (sorted by name)
- `POST /categories` body `{ name, type, color, icon?, subcategories: string[] }` → `201 CategoryDTO`
- `PATCH /categories/:id` same body → `CategoryDTO` (subcategory diff like web: removed ones are deleted and their transactions get `subcategoryId = null`)
- `DELETE /categories/:id` → `{ id }`; `409` if transactions still reference it

### Expenses
- `GET /expenses?month=YYYY-MM&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&categoryId=&search=` → `TransactionDTO[]` (date desc).
  Same rule as web: `kind = EXPENSE` OR (`kind = TRANSFER` AND tags has `"payment"`). `month` is a UTC calendar month; `startDate/endDate` are inclusive. All filters optional.
- `GET /expenses/months` → `string[]` of `"YYYY-MM"` that contain expenses (desc)
- `POST /expenses` body `{ date, amount, categoryId, subcategoryId?, accountId?, merchantOrSource?, notes?, tags: string[] }` → `201 TransactionDTO`
- `PATCH /expenses/:id` same body → `TransactionDTO`
- `DELETE /transactions/:id` (generic delete, see below)

### Payments (special expense-form modes; create a TRANSFER)
- `POST /payments` body `{ mode: "PAYMENT" | "DEBT_PAYMENT", amount, date, fromAccountId, toAccountId, notes? }` → `201 TransactionDTO`
  - `PAYMENT` → category "Payment" (find-or-create, EXPENSE, `#3b82f6`, 💸), tags `["payment"]`, merchant "Payment"
  - `DEBT_PAYMENT` → category "Debt Payment" (find-or-create, EXPENSE, `#8b5cf6`, 💳), tags `["debt-payment"]`, merchant "Debt Payment"
  - `fromAccountId !== toAccountId` (400 otherwise)

### Income
- `GET /income?month=&startDate=&endDate=&categoryId=&search=` → `TransactionDTO[]` (kind INCOME, date desc)
- `POST /income` body `{ date, amount, categoryId, subcategoryId?, accountSplits: {accountId, amount}[], merchantOrSource?, notes?, tags: string[] }` → `201 TransactionDTO`
  - `accountSplits` must have ≥ 1 entry, distinct accounts, positive amounts, summing to `amount` to the cent. With one split the server stores `accountId = split.accountId` and `accountSplits = []` (same as web).
- `PATCH /income/:id` same body → `TransactionDTO`
- `DELETE /transactions/:id`

### Transfers
- `GET /transfers` → `TransactionDTO[]` (kind TRANSFER, date desc — includes payment transfers)
- `POST /transfers` body `{ date, amount, fromAccountId, toAccountId, notes? }` → `201 TransactionDTO`
- `PATCH /transfers/:id` same body → `TransactionDTO` (preserves existing `categoryId` and `tags`)

### Generic transaction delete
- `DELETE /transactions/:id` → `{ id }`

### Friends
- `GET /friends` → `FriendDTO[]` (sorted by |balance| desc, then name)
- `POST /friends` body `{ name, notes?, color?, openingAmount?, openingType?: "THEY_OWE_ME" | "I_OWE_THEM" }` → `201 FriendDTO`
- `PATCH /friends/:id` body `{ name, notes?, color? }` → `FriendDTO`
- `DELETE /friends/:id` → `{ id }` (entries cascade)
- `POST /friends/:id/entries` body `{ date, amount, type, description?, notes? }` → `201 FriendDTO` (the updated friend)
- `DELETE /friend-entries/:id` → `{ id }`

### Analytics (AI debrief, OpenAI)
- `GET /analytics/debrief` →
```ts
{
  debrief: { headline: string; summary: string; mood: "positive"|"neutral"|"caution"; todayNote: string; monthNote: string;
             highlights: string[]; watchouts: string[]; actions: string[] }
  stats: { totalBalance; cashBalance; creditCardDebt; loanDebt; friendsOwedToYou; friendsYouOwe; friendsNet;
           todayIncome; todayExpenses; weekExpenses; last30DaysIncome; last30DaysExpenses; monthIncome; monthExpenses; monthNet }
  generatedAt: string
  topExpenseCategories: { name: string; amount: number }[]
}
```

### Assistant chat (OpenAI)
- `POST /assistant/chat` body
```ts
{ messages: { role: "user"|"assistant"; content: string; image?: { dataUrl: string /* data:image/jpeg;base64,... */; mimeType: string } }[] }
```
→
```ts
{ message: string
  draft: null | { kind: "EXPENSE"|"INCOME"; amount: number; date: "YYYY-MM-DD"; categoryId: string; accountId: string|null;
                  merchantOrSource: string|null; notes: string|null; tags: string[]; confidence: "high"|"medium"|"low";
                  categoryName?: string; accountName?: string|null } }
```
- `POST /assistant/confirm` body `{ draft: <draft without categoryName/accountName> }` → `201 TransactionDTO`
- `POST /assistant/transcribe` multipart field `audio` (m4a/mp4/webm, < 25MB) → `{ text: string }`

### Receipt scan (Gemini)
- `POST /scan-receipt` body `{ image: "<base64 or dataUrl>", mimeType: "image/jpeg" }` →
```ts
{ merchant: string|null; date: "YYYY-MM-DD"|null; totalAmount: number|null; category: string|null /* category NAME */;
  items: { name: string; amount: number; suggestedCategory?: string }[]; notes: string|null; tags: string[];
  confidence: "high"|"medium"|"low" }
```
`422 {error}` when the image isn't a receipt.
