import SwiftUI

/// Categories with type filter and CRUD (mirrors `app/categories/CategoriesClient.tsx`).
struct CategoriesView: View {
    @Environment(AppModel.self) private var model
    @State private var categories: [Category]?
    @State private var loadError: String?
    @State private var filter: CategoryFilter = .all
    @State private var editor: CategoryEditorTarget?
    @State private var pendingDelete: Category?

    enum CategoryFilter: Hashable {
        case all, expense, income

        func matches(_ c: Category) -> Bool {
            switch self {
            case .all: true
            case .expense: c.type == .EXPENSE
            case .income: c.type == .INCOME
            }
        }
    }

    private var filtered: [Category] {
        (categories ?? [])
            .filter { filter.matches($0) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func count(_ f: CategoryFilter) -> Int { (categories ?? []).filter { f.matches($0) }.count }

    private var defaultNewType: CategoryType { filter == .income ? .INCOME : .EXPENSE }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Picker("Filter", selection: $filter) {
                    Text("All (\(count(.all)))").tag(CategoryFilter.all)
                    Text("Expense (\(count(.expense)))").tag(CategoryFilter.expense)
                    Text("Income (\(count(.income)))").tag(CategoryFilter.income)
                }
                .pickerStyle(.segmented)

                if let loadError {
                    ErrorBanner(message: loadError) { Task { await load() } }
                }

                if categories != nil {
                    if filtered.isEmpty {
                        EmptyStateView(
                            symbol: "folder",
                            title: filter == .all ? "No categories yet" : "No \(filter == .income ? "income" : "expense") categories",
                            message: "Create a category to organize spending and income.",
                            tint: Theme.orange
                        ) {
                            Button("Add category") { editor = CategoryEditorTarget(category: nil, defaultType: defaultNewType) }
                                .buttonStyle(.primary)
                                .padding(.top, 4)
                        }
                    } else {
                        LazyVStack(spacing: 12) {
                            ForEach(filtered) { category in
                                CategoryCard(
                                    category: category,
                                    onEdit: { editor = CategoryEditorTarget(category: category, defaultType: category.type) },
                                    onDelete: { pendingDelete = category }
                                )
                            }
                        }
                    }
                } else if loadError == nil {
                    LoadingView(message: "Loading categories…")
                }
            }
            .padding(16)
        }
        .appScreen()
        .navigationTitle("Categories")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    editor = CategoryEditorTarget(category: nil, defaultType: defaultNewType)
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add category")
            }
        }
        .task(id: model.revision) { await load() }
        .refreshable { await load() }
        .sheet(item: $editor) { target in
            CategoryFormSheet(category: target.category, defaultType: target.defaultType)
                .appSheet()
        }
        .confirmationDialog(
            "Delete category?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { category in
            Button("Delete \(category.name)", role: .destructive) {
                Task { await delete(category) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { category in
            if category.transactionCount > 0 {
                Text("\(category.name) is used by \(category.transactionCount) transaction\(category.transactionCount == 1 ? "" : "s"). Categories in use can't be deleted.")
            } else {
                Text("Its subcategories will be deleted too. This can't be undone.")
            }
        }
    }

    private func load() async {
        do {
            let result = try await model.api.categories()
            categories = result
            loadError = nil
        } catch is CancellationError {
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func delete(_ category: Category) async {
        do {
            try await model.api.deleteCategory(category.id)
            categories?.removeAll { $0.id == category.id }
            model.didMutate()
            model.showToast("Category deleted")
        } catch {
            // 409 → server says the category is still in use.
            model.showError(error)
        }
    }
}

/// Identifies the category form sheet (nil category = create).
struct CategoryEditorTarget: Identifiable {
    let id = UUID()
    let category: Category?
    let defaultType: CategoryType
}

// MARK: - Card

private struct CategoryCard: View {
    let category: Category
    let onEdit: () -> Void
    let onDelete: () -> Void

    private var color: Color { category.swiftColor }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                EmojiTile(emoji: category.emoji, color: color, size: 48)
                VStack(alignment: .leading, spacing: 5) {
                    Text(category.name)
                        .font(.display(16))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    HStack(spacing: 8) {
                        CategoryTypeBadge(type: category.type)
                        Text("\(category.transactionCount) txn\(category.transactionCount == 1 ? "" : "s")")
                            .font(.system(size: 12))
                            .monospacedDigit()
                            .foregroundStyle(Theme.inkMuted)
                    }
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
                .accessibilityLabel("Actions for \(category.name)")
            }

            if !category.subcategories.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(category.subcategories) { sub in
                        Pill(text: sub.name)
                    }
                }
            }
        }
        .padding(16)
        .padding(.top, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            ZStack(alignment: .topTrailing) {
                Theme.surface
                Circle()
                    .fill(color)
                    .frame(width: 140, height: 140)
                    .blur(radius: 50)
                    .opacity(0.18)
                    .offset(x: 50, y: -60)
            }
        }
        .overlay(alignment: .top) {
            Rectangle().fill(color).frame(height: 4)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous).strokeBorder(Theme.borderSubtle, lineWidth: 1))
        .contentShape(RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous))
        .onTapGesture(perform: onEdit)
        .contextMenu { menuItems }
    }

    @ViewBuilder
    private var menuItems: some View {
        Button(action: onEdit) { Label("Edit", systemImage: "pencil") }
        Button(role: .destructive, action: onDelete) { Label("Delete", systemImage: "trash") }
    }
}

/// Income (mint, ↗) / Expense (danger, ↙) capsule.
struct CategoryTypeBadge: View {
    let type: CategoryType

    var body: some View {
        let isIncome = type == .INCOME
        let tint = isIncome ? Theme.mint : Theme.danger
        HStack(spacing: 3) {
            Image(systemName: isIncome ? "arrow.up.right" : "arrow.down.left")
                .font(.system(size: 9, weight: .bold))
            Text(type.label)
                .font(.system(size: 11, weight: .medium))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .foregroundStyle(tint)
        .background(tint.opacity(0.12), in: Capsule())
    }
}
