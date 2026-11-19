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

## Insights and recaps

The Home page shows up to three insights, and Home → Insights keeps a weekly
and a monthly recap.

- Detection is plain code (`lib/insights/detect.ts`): budgets on track to go
  over, a category ahead of its usual pace, an unusually large purchase, a
  recurring charge that changed or did not arrive, a bill the balance may not
  cover, card utilisation, old balances with friends, a good week or streak.
  Comparisons need history and stay silent without it.
- The model only words what was detected (`lib/insights/wording.ts`). Every
  number it writes must be one the code computed, or the code's own sentence
  is used instead; with no API key the code's sentences are always used.
- The check runs on the first open of each day and from
  `GET/POST /api/insights/run` with `Authorization: Bearer $CRON_SECRET`.
  It is idempotent per day (`InsightRun` has a unique day), makes at most one
  model call, and stores everything; pages only read. A recap is rewritten
  only with **Regenerate**.
- Dismissing an insight hides it for good and mutes its kind for 7 days.
  Settings → Insights turns kinds off.

After pulling this change run `npx prisma db push` (four new collections with
unique indexes: `Insight`, `InsightPreference`, `InsightRun`, `Recap`).

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

It can also change things, always as a proposal you approve
(`lib/assistant/actions.ts`): add several transactions at once or split one
across categories, accounts or friends (`logTransactions`); edit, delete,
duplicate or re-categorise existing ones (`changeTransactions`); transfers,
card and loan payments (`moveMoney`); friends (`updateFriends`), goals
(`updateGoals`), budgets (`updateBudgets`), recurring entries
(`updateRecurring`), categories and merchant defaults (`updateCategories`).
The card for each is built by running the change in a database transaction
that is rolled back, so it lists exactly which records change, with old and new
values and a count; approving runs it again in one transaction together with
the idempotency record, so a card with several writes is all or nothing.
`linkToPage` gives the assistant links to the app's pages with the filters each
page supports (`lib/assistant/links.ts`).

Configure it in `.env.local` (see `.env.example`): `ASSISTANT_PROVIDER`
(openai, anthropic or google), `ASSISTANT_MODEL` (optional), the provider's API
key, and `ASSISTANT_APPROVAL_SECRET` (any long random string; it signs approval
requests). Node 22 or later is required. After pulling, run
`npx prisma db push` to create the `IdempotencyKey` unique index.

Conversations are stored (`Conversation` and `Message`; run
`npx prisma db push` once after pulling to create their indexes). `/chat` is a
new chat and `/chat/<id>` a stored one. The server keeps the history: the
browser sends only its newest message, and a reply is finished and saved even
if the tab is closed mid-answer (`lib/assistant/chat.ts`). On a proposal card
you can change the amount, date, category, account or merchant before saving;
the changes are checked on the server like the original proposal, and the
approval still saves at most once.

The interface is in `components/assistant/`. `ChatPanel` is the conversation
itself (messages and composer) and can be mounted outside the Chat page;
`FinanceAssistant` is the page around it, with the list of past chats.
