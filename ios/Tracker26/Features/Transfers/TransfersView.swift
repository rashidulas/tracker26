import SwiftUI

/// Transfers between accounts (mirrors `app/transfers/page.tsx`). Includes payment transfers.
struct TransfersView: View {
    @Environment(AppModel.self) private var model
    @State private var transfers: [Transaction]?
    @State private var loadError: String?
    @State private var editor: TransferEditorTarget?
    @State private var pendingDelete: Transaction?

    /// Transfers grouped by "YYYY-MM", newest month first (server returns date desc).
    private var groups: [(month: String, items: [Transaction])] {
        var order: [String] = []
        var byMonth: [String: [Transaction]] = [:]
        for t in transfers ?? [] {
            let key = String(t.date.prefix(7))
            if byMonth[key] == nil { order.append(key) }
            byMonth[key, default: []].append(t)
        }
        return order.map { ($0, byMonth[$0] ?? []) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let loadError {
                    ErrorBanner(message: loadError) { Task { await load() } }
                }
                if let transfers {
                    if transfers.isEmpty {
                        EmptyStateView(
                            symbol: "arrow.left.arrow.right",
                            title: "No transfers yet",
                            message: "Record money moving between your accounts, like paying a card from checking.",
                            tint: Theme.cyan
                        ) {
                            Button("Add transfer") { editor = TransferEditorTarget(transfer: nil) }
                                .buttonStyle(.primary)
                                .padding(.top, 4)
                                .disabled(model.accounts.count < 2)
                        }
                    } else {
                        summary(transfers)
                        ForEach(groups, id: \.month) { group in
                            monthSection(group.month, group.items)
                        }
                    }
                } else if loadError == nil {
                    LoadingView(message: "Loading transfers…")
                }
            }
            .padding(16)
        }
        .appScreen()
        .navigationTitle("Transfers")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    editor = TransferEditorTarget(transfer: nil)
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add transfer")
            }
        }
        .task(id: model.revision) { await load() }
        .refreshable { await load() }
        .sheet(item: $editor) { target in
            TransferFormSheet(transfer: target.transfer)
                .appSheet()
        }
        .confirmationDialog(
            "Delete transfer?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { transfer in
            Button("Delete transfer", role: .destructive) {
                Task { await delete(transfer) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { transfer in
            Text("\(Format.money(transfer.amount)) on \(Format.shortDate(transfer.date)). Both account balances will be updated.")
        }
    }

    // MARK: - Sections

    private func summary(_ transfers: [Transaction]) -> some View {
        let thisMonth = String(Format.todayString().prefix(7))
        let monthTotal = transfers.filter { $0.date.hasPrefix(thisMonth) }.reduce(0) { $0 + $1.amount }
        return HStack(spacing: 12) {
            IconTile(symbol: "arrow.left.arrow.right", tint: Theme.mint, size: 36)
            VStack(alignment: .leading, spacing: 3) {
                SectionLabel("Moved this month")
                MoneyText(value: monthTotal, size: 22, color: Theme.mint)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(transfers.count)")
                    .font(.money(18))
                    .foregroundStyle(Theme.ink)
                Text("transfer\(transfers.count == 1 ? "" : "s")")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.inkMuted)
            }
        }
        .tintedPanel(Theme.mint)
    }

    private func monthSection(_ month: String, _ items: [Transaction]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                SectionLabel(Format.monthTitle(month))
                Spacer()
                Text(Format.money(items.reduce(0) { $0 + $1.amount }))
                    .font(.money(12, weight: .medium))
                    .foregroundStyle(Theme.inkMuted)
            }
            .padding(.horizontal, 4)

            LazyVStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, transfer in
                    if index > 0 { DashDivider().padding(.vertical, 6) }
                    TransferRow(
                        transfer: transfer,
                        fromName: transfer.account?.name ?? model.account(transfer.accountId)?.name ?? "Unknown account",
                        toName: transfer.toAccount?.name ?? model.account(transfer.toAccountId)?.name ?? "Unknown account"
                    )
                    .contentShape(Rectangle())
                    .onTapGesture { editor = TransferEditorTarget(transfer: transfer) }
                    .contextMenu {
                        Button {
                            editor = TransferEditorTarget(transfer: transfer)
                        } label: {
                            Label("Edit", systemImage: "pencil")
                        }
                        Button(role: .destructive) {
                            pendingDelete = transfer
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
            .panel(padding: 14)
        }
    }

    // MARK: - Data

    private func load() async {
        do {
            let result = try await model.api.transfers()
            transfers = result
            loadError = nil
        } catch is CancellationError {
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func delete(_ transfer: Transaction) async {
        do {
            try await model.api.deleteTransaction(transfer.id)
            transfers?.removeAll { $0.id == transfer.id }
            model.didMutate()
            model.showToast("Transfer deleted")
        } catch {
            model.showError(error)
        }
    }
}

/// Identifies the transfer form sheet (nil transfer = create).
struct TransferEditorTarget: Identifiable {
    let id = UUID()
    let transfer: Transaction?
}

// MARK: - Row

private struct TransferRow: View {
    let transfer: Transaction
    let fromName: String
    let toName: String

    private var meta: String {
        var parts = [Format.shortDate(transfer.date)]
        if let notes = transfer.notes?.nilIfBlank { parts.append(notes) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 12) {
            if let category = transfer.category, transfer.isPayment || transfer.isDebtPayment {
                EmojiTile(emoji: category.emoji, color: category.swiftColor, size: 40)
            } else {
                IconTile(symbol: "arrow.left.arrow.right", tint: Theme.info, size: 40)
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 5) {
                    Text(fromName).lineLimit(1)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Theme.mint)
                    Text(toName).lineLimit(1)
                }
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.ink)

                HStack(spacing: 6) {
                    if transfer.isDebtPayment {
                        Pill(text: "Debt payment", color: Theme.purple)
                    } else if transfer.isPayment {
                        Pill(text: "Payment", color: Theme.info)
                    }
                    Text(meta)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.inkMuted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            MoneyText(value: transfer.amount, size: 15, color: Theme.mint)
        }
        .padding(.vertical, 2)
    }
}
