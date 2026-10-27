# Tracker26 iOS — Plan

## What Tracker26 is
A single-user personal finance manager (Next.js 15 + Prisma + MongoDB). It tracks accounts with derived balances (checking, savings, cash, credit cards with limits, loans, investments), expenses (including Payment / Debt Payment transfer modes and AI receipt scanning), income (with multi-account splits), transfers, categories with subcategories, friend IOUs, an AI daily debrief (Analytics), and an AI chat that can draft expenses/income from text, voice or photos for the user to confirm.

The web app has no REST API (it uses server actions) and no auth, so the iOS app needs a small, token-protected JSON API added to the same Next.js deployment.

## Architecture

```
iPhone (SwiftUI) ──HTTPS + Bearer token──▶ Next.js /api/v1/* ──Prisma──▶ MongoDB
                                                      └─▶ OpenAI / Gemini (chat, debrief, voice, receipts)
```

- **Server:** `app/api/v1/**` route handlers + `lib/api/*` helpers (auth, DTO mappers, services). Reuses `lib/accountBalance`, `lib/friends`, `lib/financeContext`, `lib/assistant`. Gated by `MOBILE_API_TOKEN`. Contract: [`API.md`](API.md).
- **iOS:** SwiftUI, iOS 17+, Swift Charts, `@Observable`, async/await `URLSession`. No third-party dependencies. Token stored in Keychain; server URL in UserDefaults.

## iOS app structure (`ios/Tracker26`)

| Folder | Contents |
| --- | --- |
| `App/` | App entry, root tab shell, `AppModel` (session, shared lookups, change revision) |
| `Core/` | `APIClient`, `Keychain`, Codable models, formatting (USD, UTC dates) |
| `DesignSystem/` | Colors matching web tokens (graphite / mint), reusable components (panels, money text, chips, amount hero, empty states) |
| `Features/<Screen>/` | One folder per screen |

## Screens (mirrors the web's mobile nav)

Tabs: **Home · Expenses · Chat · More**

1. **Onboarding / Settings** — server URL + API token, test connection, sign out.
2. **Home (Dashboard)** — total balance, monthly income/expenses with vs-last-month change, cash & accounts, credit cards (usage bar vs real credit limit, month-start marker), loans, spending-over-time chart, recent transactions, friends summary, 12-month income vs expenses chart.
3. **Expenses** — month picker, search/filter, list with totals, add/edit/delete; Payment & Debt Payment modes; receipt scan via camera/photos with review-before-save.
4. **Chat** — conversation with the finance assistant, photo attachment, hold-to-talk voice (recorded m4a → transcribe), draft cards with Confirm / Discard.
5. **More** → Friends (balances, entries, add friend/entry), Analytics (AI debrief + stats), Accounts (grouped by type, CRUD, credit limit), Income (list, add/edit with account splits), Categories (filter, CRUD with emoji/color/subcategories), Transfers (list, CRUD), Settings.

Goals and Budgets are not in the web nav (Budgets is a placeholder), so they're out of scope for v1.

## Work split
1. Foundation (project, theme, models, networking, shell, onboarding) — lead.
2. In parallel:
   - **Agent A — server API**: everything in `API.md`.
   - **Agent B — iOS screens**: Dashboard, Accounts, Categories, Transfers, Analytics.
   - **Agent C — iOS screens**: Expenses (+ payments, receipt scan), Income, Friends, Chat.
3. Integration: build, run in the simulator against the local server (read-only checks against real data), polish, docs.

## Shipping to the App Store / TestFlight
See [`README.md`](README.md).
