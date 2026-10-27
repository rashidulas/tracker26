import SwiftUI

/// Expenses tab: month / category / search filters, total strip, day-grouped list, add / edit / scan.
struct ExpensesView: View {
    @Environment(AppModel.self) private var model

    @State private var month: String? = LedgerMonths.current
    @State private var months: [String] = []
    @State private var categoryId: String?
    @State private var search = ""
    @AppStorage("expenses.groupByDay") private var groupByDay = true

    @State private var expenses: [Transaction] = []
    @State private var hasLoaded = false
    @State private var isLoading = false
    @State private var loadError: String?

    @State private var showAdd = false
    @State private var showScanner = false
    @State private var editing: Transaction?
    @State private var viewingTransfer: Transaction?
    @State private var pendingDelete: Transaction?

    private struct LoadKey: Equatable {
        var month: String?
        var categoryId: String?
        var search: String
        var revision: Int
    }

    private var loadKey: LoadKey { LoadKey(month: month, categoryId: categoryId, search: search, revision: model.revision) }

    private var monthOptions: [String] {
        var set = Set(months)
        set.insert(LedgerMonths.current)
        if let month { set.insert(month) }
        return set.sorted(by: >)
    }

    private var total: Double { expenses.reduce(0) { $0 + $1.amount } }

    var body: some View {
        content
            .appScreen()
            .navigationTitle("Expenses")
            .searchable(text: $search, prompt: "Search merchant, notes, tags")
            .toolbar { toolbar }
            .task(id: loadKey) {
                // Debounce typing in the search field.
                if hasLoaded && !search.isEmpty {
                    try? await Task.sleep(for: .milliseconds(300))
                    if Task.isCancelled { return }
                }
                await load()
            }
            .task(id: model.revision) { await loadMonths() }
            .refreshable {
                await load()
                await loadMonths()
            }
            .sheet(isPresented: $showAdd) { ExpenseFormSheet() }
            .sheet(isPresented: $showScanner) { ReceiptScannerSheet() }
            .sheet(item: $editing) { ExpenseFormSheet(editing: $0) }
            .sheet(item: $viewingTransfer) { transaction in
                ExpenseTransferDetailSheet(transaction: transaction) { delete(transaction) }
            }
            .confirmationDialog(
                "Delete this transaction?",
                isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                titleVisibility: .visible,
                presenting: pendingDelete
            ) { transaction in
                Button("Delete \(Format.money(transaction.amount))", role: .destructive) { delete(transaction) }
                Button("Cancel", role: .cancel) {}
            } message: { transaction in
                Text("\(transaction.title) · \(Format.shortDate(transaction.date)). This can't be undone.")
            }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if !hasLoaded && isLoading {
            ScrollView { LoadingView(message: "Loading expenses…").padding(.top, 60) }
        } else {
            List {
                Section {
                    if let loadError {
                        ErrorBanner(message: loadError) { Task { await load() } }
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                    }
                    summary
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                        .listRowSeparator(.hidden)
                }

                if expenses.isEmpty {
                    if hasLoaded && loadError == nil {
                        Section {
                            emptyState
                                .listRowBackground(Color.clear)
                                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                        }
                    }
                } else if groupByDay {
                    ForEach(LedgerDayGroup.make(expenses)) { group in
                        Section {
                            ForEach(group.items) { row($0) }
                        } header: {
                            HStack {
                                Text(group.title)
                                Spacer()
                                Text(Format.money(group.total)).font(.money(12, weight: .medium))
                            }
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.inkMuted)
                            .textCase(nil)
                        }
                    }
                } else {
                    Section {
                        ForEach(expenses) { row($0) }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(12)
        }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                SectionLabel("Total this view")
                Spacer()
                if isLoading && hasLoaded { ProgressView().controlSize(.small).tint(Theme.danger) }
            }
            MoneyText(value: total, size: 30, weight: .semibold, color: Theme.danger)
            HStack(spacing: 6) {
                Text("\(expenses.count) transaction\(expenses.count == 1 ? "" : "s")")
                Text("·")
                Text(month.map(Format.monthTitle) ?? "All months")
                if let name = model.category(categoryId)?.name {
                    Text("·")
                    Text(name)
                }
            }
            .font(.system(size: 13))
            .foregroundStyle(Theme.inkMuted)
            .lineLimit(1)
        }
        .tintedPanel(Theme.danger)
    }

    private var emptyState: some View {
        EmptyStateView(
            symbol: "chart.line.downtrend.xyaxis",
            title: "No expenses found",
            message: search.isEmpty && categoryId == nil
                ? "Nothing logged for \(month.map(Format.monthTitle) ?? "any month") yet."
                : "Try a different search or filter.",
            tint: Theme.danger
        ) {
            VStack(spacing: 10) {
                Button { showAdd = true } label: { Label("Add Expense", systemImage: "plus") }
                    .buttonStyle(.primary)
                Button { showScanner = true } label: { Label("Scan Receipt", systemImage: "doc.text.viewfinder") }
                    .buttonStyle(.secondary)
            }
            .padding(.top, 6)
        }
    }

    private func row(_ transaction: Transaction) -> some View {
        Button {
            if transaction.kind == .TRANSFER { viewingTransfer = transaction } else { editing = transaction }
        } label: {
            TransactionRow(transaction: transaction)
        }
        .buttonStyle(.plain)
        .appRow()
        .listRowSeparatorTint(Theme.borderSubtle)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) { pendingDelete = transaction } label: { Label("Delete", systemImage: "trash") }
                .tint(Theme.danger)
            if transaction.kind != .TRANSFER {
                Button { editing = transaction } label: { Label("Edit", systemImage: "pencil") }
                    .tint(Theme.info)
            }
        }
        .contextMenu {
            if transaction.kind != .TRANSFER {
                Button { editing = transaction } label: { Label("Edit", systemImage: "pencil") }
            }
            Button(role: .destructive) { pendingDelete = transaction } label: { Label("Delete", systemImage: "trash") }
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            LedgerMonthMenu(selection: $month, months: monthOptions)
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            Menu {
                Picker("Category", selection: $categoryId) {
                    Text("All categories").tag(String?.none)
                    ForEach(model.expenseCategories) { c in
                        Text("\(c.emoji) \(c.name)").tag(Optional(c.id))
                    }
                }
                Divider()
                Toggle(isOn: $groupByDay) { Label("Group by day", systemImage: "calendar.day.timeline.left") }
            } label: {
                Image(systemName: categoryId == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
            }
            Button { showScanner = true } label: { Image(systemName: "doc.text.viewfinder") }
                .accessibilityLabel("Scan receipt")
            Button { showAdd = true } label: { Image(systemName: "plus") }
                .accessibilityLabel("Add expense")
        }
    }

    // MARK: Data

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let filter = APIClient.TransactionFilter(month: month, categoryId: categoryId, search: search)
            let result = try await model.api.expenses(filter)
            expenses = result
            loadError = nil
            hasLoaded = true
        } catch is CancellationError {
        } catch {
            loadError = error.localizedDescription
            hasLoaded = true
        }
    }

    private func loadMonths() async {
        if let result = try? await model.api.expenseMonths() { months = result }
    }

    private func delete(_ transaction: Transaction) {
        Task {
            do {
                try await model.api.deleteTransaction(transaction.id)
                expenses.removeAll { $0.id == transaction.id }
                viewingTransfer = nil
                model.didMutate()
                model.showToast(transaction.kind == .TRANSFER ? "Payment deleted" : "Expense deleted")
            } catch {
                model.showError(error)
            }
        }
    }
}

/// Read-only detail for payment transfers shown in the expenses list (the expense form can't edit them).
private struct ExpenseTransferDetailSheet: View {
    let transaction: Transaction
    var onDelete: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionLabel(transaction.isDebtPayment ? "Debt payment" : "Payment", color: Theme.info)
                        MoneyText(value: transaction.amount, size: 32, color: Theme.info)
                        Text(Format.shortDate(transaction.date)).font(.subheadline).foregroundStyle(Theme.inkSecondary)
                    }
                    .tintedPanel(Theme.info)

                    if let from = transaction.account?.name, let to = transaction.toAccount?.name {
                        LedgerMovePreview(fromName: from, toName: to, amount: transaction.amount)
                    }

                    if let notes = transaction.notes?.nilIfBlank {
                        VStack(alignment: .leading, spacing: 6) {
                            SectionLabel("Notes")
                            Text(notes).font(.body).foregroundStyle(Theme.ink)
                        }
                        .panel()
                    }

                    Text("Payments move money between accounts without counting as spending. Edit them from More → Transfers.")
                        .font(.footnote)
                        .foregroundStyle(Theme.inkMuted)

                    Button(role: .destructive) { confirmDelete = true } label: {
                        Label("Delete Payment", systemImage: "trash")
                    }
                    .buttonStyle(.destructive)
                    .confirmationDialog("Delete this payment?", isPresented: $confirmDelete, titleVisibility: .visible) {
                        Button("Delete \(Format.money(transaction.amount))", role: .destructive) {
                            onDelete()
                            dismiss()
                        }
                        Button("Cancel", role: .cancel) {}
                    } message: {
                        Text("This can't be undone.")
                    }
                }
                .padding(20)
            }
            .background(Theme.surface)
            .navigationTitle("Payment")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.foregroundStyle(Theme.mint)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .appSheet()
    }
}
