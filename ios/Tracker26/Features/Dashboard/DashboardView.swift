import Charts
import SwiftUI

/// Home tab: financial overview from `GET /dashboard` (mirrors `app/dashboard/DashboardClient.tsx`).
struct DashboardView: View {
    @Environment(AppModel.self) private var model
    @State private var data: Dashboard?
    @State private var loadError: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let loadError {
                    ErrorBanner(message: loadError) { Task { await load() } }
                }
                if let data {
                    DashboardContent(data: data, hasAccounts: !model.accounts.isEmpty)
                } else if loadError == nil {
                    LoadingView(message: "Loading your dashboard…")
                }
            }
            .padding(16)
        }
        .appScreen()
        .navigationTitle("Dashboard")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    SettingsView()
                } label: {
                    Image(systemName: "gearshape")
                        .foregroundStyle(Theme.inkSecondary)
                }
                .accessibilityLabel("Settings")
            }
        }
        .task(id: model.revision) { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            let result = try await model.api.dashboard()
            data = result
            loadError = nil
        } catch is CancellationError {
            // View went away or a newer load started — keep current state.
        } catch {
            loadError = error.localizedDescription
        }
    }
}

/// All dashboard sections for a loaded `Dashboard`.
private struct DashboardContent: View {
    let data: Dashboard
    let hasAccounts: Bool

    private var lastSeven: [Dashboard.MonthPoint] { Array(data.monthlyTrend.suffix(7)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            DashHeroCard(data: data)

            if !hasAccounts && data.recentTransactions.isEmpty {
                EmptyStateView(
                    symbol: "wallet.bifold",
                    title: "Welcome to Tracker26",
                    message: "Add an account from More → Accounts, then log expenses and income to fill your dashboard."
                )
            }

            HStack(alignment: .top, spacing: 12) {
                DashMetricCard(
                    title: "Monthly Income",
                    symbol: "arrow.up.right",
                    value: data.monthIncome,
                    lastMonth: data.lastMonthIncome,
                    tint: Theme.mint,
                    lowerIsBetter: false,
                    spark: lastSeven.map(\.income)
                )
                DashMetricCard(
                    title: "Monthly Expenses",
                    symbol: "arrow.down.right",
                    value: data.monthExpenses,
                    lastMonth: data.lastMonthExpenses,
                    tint: Theme.danger,
                    lowerIsBetter: true,
                    spark: lastSeven.map(\.expenses)
                )
            }

            DashCashRow(cash: data.cashBalance)

            if !data.creditCards.isEmpty {
                DashCreditCardsCard(cards: data.creditCards)
            }

            if !data.loans.isEmpty {
                DashLoansCard(loans: data.loans)
            }

            DashSpendingChart(points: data.dailySpending)

            DashCategoryDonut(slices: data.categoryData)

            DashRecentTransactions(transactions: data.recentTransactions)

            if !data.friends.isEmpty || data.friendsOwedToYou > 0.005 || data.friendsYouOwe > 0.005 {
                DashFriendsSummary(
                    friends: data.friends,
                    owedToYou: data.friendsOwedToYou,
                    youOwe: data.friendsYouOwe
                )
            }

            DashTrendChart(trend: data.monthlyTrend)
        }
    }
}

// MARK: - Shared dashboard helpers

enum DashFormat {
    /// `$1.2k`, `$35`, `$1.5M` for chart axes.
    static func compactMoney(_ value: Double) -> String {
        let v = abs(value)
        let sign = value < 0 ? "−" : ""
        if v >= 1_000_000 { return "\(sign)$\(trimmed(v / 1_000_000))M" }
        if v >= 1_000 { return "\(sign)$\(trimmed(v / 1_000))k" }
        return "\(sign)$\(Int(v.rounded()))"
    }

    private static func trimmed(_ v: Double) -> String {
        let s = String(format: "%.1f", v)
        return s.hasSuffix(".0") ? String(s.dropLast(2)) : s
    }

    /// Debt carried by a liability: cards/loans carry negative balances when owing; a positive balance is credit.
    static func debt(_ balance: Double) -> Double { abs(min(balance, 0)) }

    /// "Oct 1" for the first day of the current (local) month.
    static var monthStartLabel: String {
        Format.dayMonth(String(Format.todayString().prefix(7)) + "-01")
    }

    static func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2)
        let s = parts.compactMap { $0.first.map(String.init) }.joined()
        return s.isEmpty ? "?" : s.uppercased()
    }
}

/// Title + optional subtitle used at the top of each dashboard panel.
struct DashSectionHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.display(17)).foregroundStyle(Theme.ink)
                if let subtitle {
                    Text(subtitle).font(.system(size: 12)).foregroundStyle(Theme.inkMuted)
                }
            }
            Spacer(minLength: 8)
            trailing
        }
    }
}

extension DashSectionHeader where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil) {
        self.init(title: title, subtitle: subtitle) { EmptyView() }
    }
}

/// Thin divider in the app's subtle border colour.
struct DashDivider: View {
    var body: some View {
        Rectangle().fill(Theme.borderSubtle).frame(height: 1)
    }
}
