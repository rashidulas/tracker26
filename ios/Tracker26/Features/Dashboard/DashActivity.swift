import SwiftUI

// MARK: - Recent transactions

struct DashRecentTransactions: View {
    let transactions: [Transaction]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            DashSectionHeader(title: "Recent transactions", subtitle: "Latest activity across accounts")

            if transactions.isEmpty {
                Text("No transactions yet")
                    .font(.footnote)
                    .foregroundStyle(Theme.inkMuted)
                    .frame(maxWidth: .infinity, minHeight: 80)
            } else {
                VStack(spacing: 8) {
                    ForEach(Array(transactions.enumerated()), id: \.element.id) { index, tx in
                        if index > 0 { DashDivider() }
                        TransactionRow(transaction: tx)
                    }
                }
            }
        }
        .panel(padding: 18)
    }
}

// MARK: - Friends summary

struct DashFriendsSummary: View {
    let friends: [Dashboard.FriendSummary]
    let owedToYou: Double
    let youOwe: Double

    private let limit = 5

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            DashSectionHeader(title: "Friends", subtitle: "Shared money & IOUs")

            HStack(spacing: 10) {
                tile(title: "Owed to you", value: owedToYou, tint: Theme.mint, symbol: "arrow.down.left")
                tile(title: "You owe", value: youOwe, tint: Theme.danger, symbol: "arrow.up.right")
            }

            if !friends.isEmpty {
                VStack(spacing: 10) {
                    ForEach(friends.prefix(limit)) { friend in
                        row(friend)
                    }
                }
                if friends.count > limit {
                    Text("+ \(friends.count - limit) more in More → Friends")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.inkMuted)
                }
            }
        }
        .panel(padding: 18)
    }

    private func tile(title: String, value: Double, tint: Color, symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Image(systemName: symbol).font(.system(size: 10, weight: .bold)).foregroundStyle(tint)
                SectionLabel(title)
            }
            MoneyText(value: value, size: 18, color: tint)
        }
        .tintedPanel(tint, padding: 12, radius: Theme.radiusMd)
    }

    private func row(_ friend: Dashboard.FriendSummary) -> some View {
        let settled = abs(friend.balance) < 0.005
        let theyOwe = friend.balance > 0
        let status = settled ? "Settled up" : (theyOwe ? "They owe you" : "You owe them")
        let color: Color = settled ? Theme.inkMuted : (theyOwe ? Theme.mint : Theme.danger)
        return HStack(spacing: 12) {
            InitialsAvatar(initials: DashFormat.initials(friend.name), color: Color(hex: friend.color), size: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text(friend.name)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text(status)
                    .font(.system(size: 11))
                    .foregroundStyle(settled ? Theme.inkMuted : color)
            }
            Spacer(minLength: 8)
            MoneyText(value: abs(friend.balance), size: 14, color: settled ? Theme.inkSecondary : color)
        }
    }
}
