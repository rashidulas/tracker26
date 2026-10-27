import SwiftUI

/// AI daily debrief + stats from `GET /analytics/debrief` (mirrors `app/analytics/AnalyticsClient.tsx`).
/// The call is slow and costs an AI request, so it only runs on first appear and on explicit refresh —
/// not on every `model.revision` bump. The last result stays cached in @State.
struct AnalyticsView: View {
    @Environment(AppModel.self) private var model
    @State private var response: DebriefResponse?
    @State private var loadError: String?
    @State private var isLoading = false

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let loadError {
                    ErrorBanner(message: "Couldn’t generate debrief. \(loadError)") {
                        Task { await load() }
                    }
                }

                if isLoading && response == nil {
                    loadingPanel
                }

                if let response {
                    hero(response)
                    statsGrid(response.stats)
                    AnalyticsInsightList(
                        title: "Highlights",
                        items: response.debrief.highlights,
                        empty: "No highlights yet — log a few transactions.",
                        accent: Theme.mint
                    )
                    AnalyticsInsightList(
                        title: "Watch outs",
                        items: response.debrief.watchouts,
                        empty: "Nothing concerning right now.",
                        accent: Theme.warning
                    )
                    AnalyticsInsightList(
                        title: "Suggested actions",
                        items: response.debrief.actions,
                        empty: "Keep logging — suggestions will show up.",
                        accent: Theme.info
                    )
                    if !response.topExpenseCategories.isEmpty {
                        topSpending(response.topExpenseCategories)
                    }
                }
            }
            .padding(16)
        }
        .appScreen()
        .navigationTitle("Analytics")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if isLoading {
                    ProgressView().tint(Theme.mint)
                } else {
                    Button {
                        Task { await load() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                }
            }
        }
        .task {
            if response == nil && !isLoading { await load() }
        }
        .refreshable { await load() }
    }

    // MARK: - Data

    private func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let result = try await model.api.debrief()
            response = result
            loadError = nil
        } catch is CancellationError {
        } catch {
            loadError = error.localizedDescription
        }
    }

    // MARK: - Sections

    private var loadingPanel: some View {
        VStack(spacing: 14) {
            ProgressView().controlSize(.large).tint(Theme.mint)
            Text("Reading your accounts, friends, loans, and spending…")
                .font(.subheadline)
                .foregroundStyle(Theme.inkMuted)
                .multilineTextAlignment(.center)
        }
        .padding(.vertical, 40)
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity)
        .panel()
    }

    private func hero(_ r: DebriefResponse) -> some View {
        let d = r.debrief
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Text("✦ DAILY DEBRIEF")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.6)
                    .foregroundStyle(Theme.mint)
                AnalyticsMoodPill(mood: d.mood)
                Spacer(minLength: 4)
                if let generated = Self.generatedText(r.generatedAt) {
                    Text(generated)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.inkMuted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }

            Text(d.headline)
                .font(.display(24))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)

            Text(d.summary)
                .font(.system(size: 15))
                .foregroundStyle(Theme.inkSecondary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 10) {
                noteTile("Today", d.todayNote)
                noteTile("This month", d.monthNote)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            ZStack {
                Theme.surface
                LinearGradient(colors: [Theme.mint.opacity(0.10), .clear, Theme.info.opacity(0.08)], startPoint: .topLeading, endPoint: .bottomTrailing)
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusXl, style: .continuous))
        }
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusXl, style: .continuous).strokeBorder(Theme.borderSubtle, lineWidth: 1))
    }

    private func noteTile(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            SectionLabel(title)
            Text(text.nilIfBlank ?? "—")
                .font(.system(size: 14))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.bgElevated.opacity(0.6), in: RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous).strokeBorder(Theme.borderSubtle, lineWidth: 1))
    }

    private func statsGrid(_ s: DebriefResponse.Stats) -> some View {
        let money = { (v: Double) in Format.money(v, cents: false) }
        let loanSub = s.creditCardDebt > 0
            ? "Cards \(money(s.creditCardDebt)) · 7d \(money(s.weekExpenses))"
            : "Today \(Format.money(s.todayExpenses)) · 7d \(money(s.weekExpenses))"
        return LazyVGrid(columns: columns, spacing: 10) {
            AnalyticsStatTile(
                label: "Total balance",
                value: s.totalBalance,
                symbol: "wallet.bifold",
                tone: s.totalBalance >= 0 ? Theme.mint : Theme.danger,
                sub: "Cash \(money(s.cashBalance))"
            )
            AnalyticsStatTile(
                label: "Month net",
                value: s.monthNet,
                symbol: s.monthNet >= 0 ? "arrow.up.right" : "arrow.down.right",
                tone: s.monthNet >= 0 ? Theme.mint : Theme.danger,
                sub: "\(money(s.monthIncome)) in · \(money(s.monthExpenses)) out"
            )
            AnalyticsStatTile(
                label: "Friends net",
                value: s.friendsNet,
                symbol: "person.2",
                tone: s.friendsNet >= 0 ? Theme.mint : Theme.danger,
                sub: "\(money(s.friendsOwedToYou)) owed to you · \(money(s.friendsYouOwe)) you owe"
            )
            AnalyticsStatTile(
                label: "Loan debt",
                value: s.loanDebt,
                symbol: "hand.raised",
                tone: s.loanDebt > 0 ? Theme.danger : Theme.inkSecondary,
                sub: loanSub
            )
        }
    }

    private func topSpending(_ cats: [DebriefResponse.TopCategory]) -> some View {
        let maxAmount = max(cats.map(\.amount).max() ?? 1, 0.01)
        return VStack(alignment: .leading, spacing: 14) {
            Text("Top spending this month")
                .font(.display(17))
                .foregroundStyle(Theme.ink)
            ForEach(Array(cats.enumerated()), id: \.offset) { _, cat in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(cat.name)
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.inkSecondary)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        MoneyText(value: cat.amount, size: 14)
                    }
                    ProgressBar(value: cat.amount / maxAmount, tint: Theme.mint.opacity(0.8), height: 6)
                }
            }
        }
        .panel(padding: 18)
    }

    // MARK: - Helpers

    private static func generatedText(_ iso: String) -> String? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = withFraction.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return nil }
        if Calendar.current.isDateInToday(date) {
            return "Today, \(date.formatted(date: .omitted, time: .shortened))"
        }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

// MARK: - Components

private struct AnalyticsMoodPill: View {
    let mood: String

    private var tint: Color {
        switch mood.lowercased() {
        case "positive": Theme.mint
        case "caution": Theme.warning
        default: Theme.info
        }
    }

    var body: some View {
        Text(mood.capitalized)
            .font(.system(size: 11, weight: .medium))
            .padding(.horizontal, 9)
            .padding(.vertical, 3)
            .foregroundStyle(tint)
            .background(tint.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.3), lineWidth: 1))
    }
}

private struct AnalyticsStatTile: View {
    let label: String
    let value: Double
    let symbol: String
    let tone: Color
    let sub: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                IconTile(symbol: symbol, tint: tone, size: 28)
                Text(label.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(1)
                    .foregroundStyle(Theme.inkMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            MoneyText(value: value, size: 19, cents: false)
            Text(sub)
                .font(.system(size: 11))
                .foregroundStyle(Theme.inkMuted)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .panel(padding: 14)
    }
}

private struct AnalyticsInsightList: View {
    let title: String
    let items: [String]
    let empty: String
    let accent: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.display(16))
                .foregroundStyle(Theme.ink)
            if items.isEmpty {
                Text(empty)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.inkMuted)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Circle()
                                .fill(accent)
                                .frame(width: 6, height: 6)
                                .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
                            Text(item)
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.inkSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
        .panel(padding: 18)
    }
}
