# Tracker26 - Production-Ready Personal Finance Manager

A comprehensive personal finance management application built 
## Recurring entries

Plan → Recurring holds templates (rent, subscriptions, pay day) with a schedule:
weekly, every two weeks, monthly or yearly, starting on a first due date that
sets the day. The Home page lists what is due in the next 14 days with
**Post now** and **Skip**.

- Auto-post entries are posted when due; the rest wait for you.
- The due check runs whenever the app is opened, and from
  `GET/POST /api/recurring/run` with `Authorization: Bearer $CRON_SECRET`
  (disabled until `CRON_SECRET` is set). Posting is idempotent: each
  occurrence is recorded in `RecurringPosting` under a unique index, so
  repeated or concurrent runs never post twice (`lib/recurring.ts`).
- Repeating charges in your history are suggested, never created silently
  (`lib/recurringDetection.ts`).
- Dashboard charts can show everyday and recurring spending separately.

## Merchant memory

Settings → Merchants. Income and expenses link to a `Merchant` (one per name,
ignoring case and extra spaces). A merchant can have a default category,
subcategory and account, used by the expense form, the chat assistant and the
receipt scanner; without one, the form uses what you picked last time. When you
change the category for a merchant, the app offers to make it the default and
to update past transactions.

After pulling these changes, sync the schema and link existing transactions:

```
npx prisma db push
npx tsx --env-file=.env.local prisma/migrate-merchants.ts          # dry run: prints the plan
npx tsx --env-file=.env.local prisma/migrate-merchants.ts --apply  # writes it
```

## Chat assistant

The Chat page streams answers from a tool-calling model (AI SDK 7,
`lib/assistant/`). It looks things up with read tools (transaction search,
summaries by category, merchant, account or period, period comparisons,
balances, budgets, goals, friends, upcoming recurring items) that compute every
figure on the server with the same modules as the app's pages. Expenses and
income it records are proposals: nothing is saved until you approve the card,
and each approval saves at most once (`IdempotencyKey`).

Configure it in `.env.local` (see `.env.example`): `ASSISTANT_PROVIDER`
(openai, anthropic or google), `ASSISTANT_MODEL` (optional), the provider's API
key, and `ASSISTANT_APPROVAL_SECRET` (any long random string; it signs approval
requests). Node 22 or later is required. After pulling, run
`npx prisma db push` to create the `IdempotencyKey` unique index.
