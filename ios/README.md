# Tracker26 for iOS

Native SwiftUI client for Tracker26. iOS 17+, iPhone, no third-party dependencies.
It talks to the Tracker26 Next.js app through the token-protected JSON API in `app/api/v1` ([API.md](API.md)). See [PLAN.md](PLAN.md) for the architecture.

## Features
- **Home**: total balance, monthly income/expenses vs last month, cash, credit cards (usage against the real credit limit, with a month-start marker), loans, spending chart, category donut, recent transactions, friends summary, 12-month trend.
- **Expenses**: month picker, search, category filter, add/edit/delete, Payment and Debt Payment modes, AI receipt scan (camera or photos, review before saving).
- **Chat**: finance assistant with photo attachments, hold-to-talk voice, and draft cards (Confirm / Discard).
- **More**: Friends (IOUs and entries), Analytics (AI daily debrief), Accounts, Income (with account splits), Categories (emoji, colour, subcategories), Transfers, Settings.

## 1. Server setup (once)
1. Generate a token: `openssl rand -hex 32`
2. Add it to the web app's environment as `MOBILE_API_TOKEN`. Locally that's `.env`; on Vercel it's Project → Settings → Environment Variables. Redeploy.
3. Check it works:
   `curl -H "Authorization: Bearer <token>" https://<your-host>/api/v1/health`

If `MOBILE_API_TOKEN` is unset, the mobile API returns 503. That is the off switch.

> ⚠️ The existing **web** pages and the old `/api/assistant/*` and `/api/scan-receipt` routes still have no auth, as before. If the web app is on a public URL, anyone who finds it can see your data. Put the deployment behind Vercel Password Protection or similar. The iOS app only uses `/api/v1`, which is token-protected.

## 2. Run in the simulator
```bash
open ios/Tracker26.xcodeproj    # pick an iPhone simulator, ⌘R
```
On first launch, enter the server URL and token. For a local server, use `http://localhost:3000`; plain http is allowed for local networking only.

Debug-only launch arguments (Scheme → Run → Arguments) skip onboarding:
`-debugServerURL http://localhost:3000 -debugApiToken <token>`. Optional: `-debugTab expenses|chat|more` and `-debugMore friends|analytics|accounts|income|categories|transfers|settings`.

## 3. Run on your iPhone / ship with your Apple Developer account
1. In Xcode, select the **Tracker26** target → **Signing & Capabilities**:
   - Team: your Apple Developer team.
   - Bundle Identifier: change `com.tracker26.app` to one you own, e.g. `com.<yourname>.tracker26`.
2. Plug in your iPhone, select it as the run destination, and press ⌘R.
3. **TestFlight / App Store**:
   1. Create the app record in [App Store Connect](https://appstoreconnect.apple.com) with the same bundle ID.
   2. In Xcode choose **Any iOS Device**, then **Product → Archive** → **Distribute App → App Store Connect → Upload**.
   3. In App Store Connect → TestFlight, add yourself as an internal tester and install with the TestFlight app. Internal testing needs no App Review.
   4. Bump **Version** / **Build** (`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`) for each upload.

**App Review note:** this is a single-user app that needs your own server. For a public App Store release, App Review needs a working demo server URL and token in the review notes, plus a privacy policy URL. For personal use, TestFlight (or ad-hoc distribution) is the simplest path.

Already configured: app icon, dark appearance, portrait iPhone, camera / microphone / photo-library usage strings, `ITSAppUsesNonExemptEncryption = NO` (standard HTTPS only).

## Project layout
```
ios/
  Tracker26.xcodeproj      # synchronized folders: new .swift files under Tracker26/ are picked up automatically
  Config/Info.plist        # ATS local-networking exception (everything else is generated from build settings)
  Tracker26/
    App/                   # entry point, tab shell, AppModel (session, lookups, toasts, change revision)
    Core/                  # APIClient + typed endpoints, Keychain, Codable models, formatting (USD, UTC days)
    DesignSystem/          # Theme tokens (graphite / mint), shared components, TransactionRow
    Features/              # Dashboard, Expenses, Chat, Friends, Analytics, Accounts, Income, Categories, Transfers, More, Settings
    Resources/             # Assets (AppIcon, AccentColor)
```
