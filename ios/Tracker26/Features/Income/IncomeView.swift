import SwiftUI

/// Income list: month filter, search, total box, add / edit (with account splits) / delete.
struct IncomeView: View {
    @Environment(AppModel.self) private var model

    @State private var month: String? = LedgerMonths.current
    @State private var search = ""

    @State private var items: [Transaction] = []
    @State private var hasLoaded = false
    @State private var isLoading = false
    @State private var loadError: String?

    @State private var showAdd = false
    @State private var editing: Transaction?
    @State private var pendingDelete: Transaction?

    private struct LoadKey: Equatable {
        var month: String?
        var search: String
        var revision: Int
    }

    private var monthOptions: [String] {
        var list = LedgerMonths.recent(12)
        if let month, !list.contains(month) { list.append(month) }
        return list.sorted(by: >)
    }

    private var total: Double { items.reduce(0) { $0 + $1.amount } }

    var body: some View {
        content
            .appScreen()
            .navigationTitle("Income")
            .searchable(text: $search, prompt: "Search source, notes, tags")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    LedgerMonthMenu(selection: $month, months: monthOptions)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showAdd = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Add income")
                }
            }
            .task(id: LoadKey(month: month, search: search, revision: model.revision)) {
                if hasLoaded && !search.isEmpty {
                    try? await Task.sleep(for: .milliseconds(300))
                    if Task.isCancelled { return }
                }
                await load()
            }
            .refreshable { await load() }
            .sheet(isPresented: $showAdd) { IncomeFormSheet() }
            .sheet(item: $editing) { IncomeFormSheet(editing: $0) }
            .confirmationDialog(
                "Delete this income?",
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

    @ViewBuilder
    private var content: some View {
        if !hasLoaded && isLoading {
            ScrollView { LoadingView(message: "Loading income…").padding(.top, 60) }
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
                }

                if items.isEmpty {
                    if hasLoaded && loadError == nil {
                        Section {
                            EmptyStateView(
                                symbol: "chart.line.uptrend.xyaxis",
                                title: "No income found",
                                message: search.isEmpty ? "Nothing logged for \(month.map(Format.monthTitle) ?? "any month") yet." : "Try a different search.",
                                tint: Theme.mint
                            ) {
                                Button { showAdd = true } label: { Label("Add Income", systemImage: "plus") }
                                    .buttonStyle(.primary)
                                    .padding(.top, 6)
                            }
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                        }
                    }
                } else {
                    Section {
                        ForEach(items) { transaction in
                            Button { editing = transaction } label: { TransactionRow(transaction: transaction) }
                                .buttonStyle(.plain)
                                .appRow()
                                .listRowSeparatorTint(Theme.borderSubtle)
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    Button(role: .destructive) { pendingDelete = transaction } label: { Label("Delete", systemImage: "trash") }
                                        .tint(Theme.danger)
                                    Button { editing = transaction } label: { Label("Edit", systemImage: "pencil") }
                                        .tint(Theme.info)
                                }
                                .contextMenu {
                                    Button { editing = transaction } label: { Label("Edit", systemImage: "pencil") }
                                    Button(role: .destructive) { pendingDelete = transaction } label: { Label("Delete", systemImage: "trash") }
                                }
                        }
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
                SectionLabel("Total income")
                Spacer()
                if isLoading && hasLoaded { ProgressView().controlSize(.small).tint(Theme.mint) }
            }
            MoneyText(value: total, size: 30, color: Theme.mint)
            Text("\(items.count) transaction\(items.count == 1 ? "" : "s") · \(month.map(Format.monthTitle) ?? "All months")")
                .font(.system(size: 13))
                .foregroundStyle(Theme.inkMuted)
        }
        .tintedPanel(Theme.mint)
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            items = try await model.api.income(.init(month: month, search: search))
            loadError = nil
            hasLoaded = true
        } catch is CancellationError {
        } catch {
            loadError = error.localizedDescription
            hasLoaded = true
        }
    }

    private func delete(_ transaction: Transaction) {
        Task {
            do {
                try await model.api.deleteTransaction(transaction.id)
                items.removeAll { $0.id == transaction.id }
                model.didMutate()
                model.showToast("Income deleted")
            } catch {
                model.showError(error)
            }
        }
    }
}
