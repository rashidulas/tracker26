import SwiftUI

/// Shared list row for any transaction (dashboard recents, expenses, income, transfers).
struct TransactionRow: View {
    let transaction: Transaction
    /// Show "Account" / "A → B" in the meta line.
    var showAccount: Bool = true

    private var tint: Color {
        if transaction.kind == .TRANSFER { return Theme.info }
        return transaction.category?.swiftColor ?? Theme.mint
    }

    private var emoji: String {
        if transaction.kind == .TRANSFER && transaction.category == nil { return "↔️" }
        return transaction.category?.emoji ?? (transaction.kind == .INCOME ? "💰" : "💸")
    }

    private var amountColor: Color {
        switch transaction.kind {
        case .INCOME: Theme.mint
        case .EXPENSE: Theme.danger
        case .TRANSFER: Theme.info
        }
    }

    private var amountText: String {
        switch transaction.kind {
        case .INCOME: "+" + Format.money(transaction.amount)
        case .EXPENSE: "−" + Format.money(transaction.amount)
        case .TRANSFER: Format.money(transaction.amount)
        }
    }

    private var meta: String {
        var parts = [Format.shortDate(transaction.date)]
        if transaction.merchantOrSource?.nilIfBlank != nil, let c = transaction.category?.name { parts.append(c) }
        if showAccount {
            if transaction.kind == .TRANSFER, let from = transaction.account?.name, let to = transaction.toAccount?.name {
                parts.append("\(from) → \(to)")
            } else if transaction.accountSplits.count > 1 {
                parts.append("\(transaction.accountSplits.count) accounts")
            } else if let a = transaction.account?.name {
                parts.append(a)
            }
        }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 12) {
            EmojiTile(emoji: emoji, color: tint, size: 40)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(transaction.title).font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                    if let sub = transaction.subcategory?.name { Pill(text: sub) }
                }
                Text(meta).font(.system(size: 12)).foregroundStyle(Theme.inkMuted).lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(amountText).font(.money(15)).foregroundStyle(amountColor).lineLimit(1)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}
