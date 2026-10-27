import SwiftUI

/// Accounts grouped by type with CRUD (mirrors `app/accounts/AccountsClient.tsx`).
struct AccountsView: View {
    @Environment(AppModel.self) private var model
    @State private var accounts: [Account]?
    @State private var loadError: String?
    @State private var editor: AccountEditorTarget?
    @State private var pendingDelete: Account?

    private static let sections: [(type: AccountType, title: String)] = [
        (.CREDIT_CARD, "Credit Cards"),
        (.CHECKING, "Checking"),
        (.CASH, "Cash"),
        (.SAVINGS, "Savings"),
        (.LOAN, "Loans"),
        (.INVESTMENT, "Investments"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if let loadError {
                    ErrorBanner(message: loadError) { Task { await load() } }
                }
                if let accounts {
                    if accounts.isEmpty {
                        EmptyStateView(
                            symbol: "wallet.bifold",
                            title: "No accounts yet",
                            message: "Add your first account to start tracking balances."
                        ) {
                            Button("Add account") { editor = AccountEditorTarget(account: nil) }
                                .buttonStyle(.primary)
                                .padding(.top, 4)
                        }
                    } else {
                        totalCard(accounts)
                        ForEach(Self.sections, id: \.type) { section in
                            let items = accounts
                                .filter { $0.type == section.type }
                                .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
                            if !items.isEmpty {
                                sectionView(title: section.title, items: items)
                            }
                        }
                    }
                } else if loadError == nil {
                    LoadingView(message: "Loading accounts…")
                }
            }
            .padding(16)
        }
        .appScreen()
        .navigationTitle("Accounts")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    editor = AccountEditorTarget(account: nil)
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add account")
            }
        }
        .task(id: model.revision) { await load() }
        .refreshable { await load() }
        .sheet(item: $editor) { target in
            AccountFormSheet(account: target.account)
                .appSheet()
        }
        .confirmationDialog(
            "Delete account?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { account in
            Button("Delete \(account.name)", role: .destructive) {
                Task { await delete(account) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { account in
            if account.transactionCount > 0 {
                Text("\(account.name) still has \(account.transactionCount) transaction\(account.transactionCount == 1 ? "" : "s"). Accounts with transactions can't be deleted.")
            } else {
                Text("This can't be undone.")
            }
        }
    }

    // MARK: - Sections

    private func totalCard(_ accounts: [Account]) -> some View {
        let total = accounts.reduce(0) { $0 + $1.currentBalance }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                IconTile(symbol: "wallet.bifold", tint: Theme.mint, size: 32)
                Text("Total Balance")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.inkSecondary)
            }
            MoneyText(value: total, size: 34, color: total >= 0 ? Theme.ink : Theme.danger)
            Text("Across \(accounts.count) account\(accounts.count == 1 ? "" : "s")")
                .font(.system(size: 13))
                .foregroundStyle(Theme.inkMuted)
        }
        .tintedPanel(Theme.mint, padding: 20, radius: Theme.radiusXl)
    }

    private func sectionView(title: String, items: [Account]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(title.uppercased())
                    .font(.system(size: 13, weight: .medium))
                    .tracking(0.8)
                    .foregroundStyle(Theme.inkSecondary)
                Spacer()
                Text("\(items.count) account\(items.count == 1 ? "" : "s")")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.inkMuted)
            }
            .padding(.horizontal, 4)

            LazyVStack(spacing: 10) {
                ForEach(items) { account in
                    AccountCard(
                        account: account,
                        onEdit: { editor = AccountEditorTarget(account: account) },
                        onDelete: { pendingDelete = account }
                    )
                }
            }
        }
    }

    // MARK: - Data

    private func load() async {
        do {
            let result = try await model.api.accounts()
            accounts = result
            loadError = nil
        } catch is CancellationError {
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func delete(_ account: Account) async {
        do {
            try await model.api.deleteAccount(account.id)
            accounts?.removeAll { $0.id == account.id }
            model.didMutate()
            model.showToast("Account deleted")
        } catch {
            // 409 → server explains the account still has transactions.
            model.showError(error)
        }
    }
}

/// Identifies the account form sheet (nil account = create).
struct AccountEditorTarget: Identifiable {
    let id = UUID()
    let account: Account?
}

// MARK: - Card

private struct AccountCard: View {
    let account: Account
    let onEdit: () -> Void
    let onDelete: () -> Void

    private var tint: Color {
        switch account.type {
        case .CREDIT_CARD: Theme.danger
        case .LOAN: Theme.warning
        case .INVESTMENT: Theme.info
        default: Theme.mint
        }
    }

    private var subtitle: String {
        [account.type.label, account.institution?.nilIfBlank].compactMap { $0 }.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                IconTile(symbol: account.type.symbol, tint: tint, size: 42)
                VStack(alignment: .leading, spacing: 2) {
                    Text(account.name)
                        .font(.display(16))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.inkMuted)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Menu {
                    menuItems
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.inkMuted)
                        .frame(width: 34, height: 34)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Actions for \(account.name)")
            }

            DashDivider()

            VStack(spacing: 7) {
                HStack {
                    Text("Current balance").font(.system(size: 13)).foregroundStyle(Theme.inkSecondary)
                    Spacer()
                    MoneyText(value: account.currentBalance, size: 18, color: account.currentBalance < 0 ? Theme.danger : Theme.ink)
                }
                if account.type == .CREDIT_CARD {
                    detail("Limit") {
                        if let limit = account.creditLimit, limit > 0 {
                            MoneyText(value: limit, size: 13, weight: .medium, color: Theme.mint)
                        } else {
                            Text("—").foregroundStyle(Theme.inkMuted)
                        }
                    }
                }
                detail("Starting") {
                    MoneyText(value: account.startingBalance, size: 13, weight: .regular, color: Theme.inkSecondary)
                }
                detail("Transactions") {
                    Text("\(account.transactionCount)")
                        .font(.money(13, weight: .regular))
                        .foregroundStyle(Theme.inkSecondary)
                }
            }
        }
        .panel()
        .contentShape(RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous))
        .onTapGesture(perform: onEdit)
        .contextMenu { menuItems }
    }

    @ViewBuilder
    private var menuItems: some View {
        Button(action: onEdit) { Label("Edit", systemImage: "pencil") }
        Button(role: .destructive, action: onDelete) { Label("Delete", systemImage: "trash") }
    }

    private func detail<V: View>(_ label: String, @ViewBuilder value: () -> V) -> some View {
        HStack {
            Text(label).font(.system(size: 13)).foregroundStyle(Theme.inkSecondary)
            Spacer()
            value()
        }
    }
}

