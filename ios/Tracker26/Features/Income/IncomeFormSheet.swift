import SwiftUI

/// Add / edit income. One account, or split across several (amounts must sum to the total to the cent).
struct IncomeFormSheet: View {
    struct SplitRow: Identifiable, Equatable {
        let id = UUID()
        var accountId: String?
        var amountText: String
    }

    let editing: Transaction?

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var amountText: String
    @State private var date: String
    @State private var categoryId: String?
    @State private var subcategoryId: String?
    @State private var accountId: String?
    @State private var isSplit: Bool
    @State private var splits: [SplitRow]
    @State private var source: String
    @State private var notes: String
    @State private var tagsText: String
    @State private var isSaving = false

    init(editing: Transaction? = nil) {
        self.editing = editing
        _amountText = State(initialValue: editing.map { LedgerAmount.text($0.amount) } ?? "")
        _date = State(initialValue: editing?.date ?? Format.todayString())
        _categoryId = State(initialValue: editing?.categoryId)
        _subcategoryId = State(initialValue: editing?.subcategoryId)
        let multi = (editing?.accountSplits.count ?? 0) > 1
        _isSplit = State(initialValue: multi)
        _splits = State(initialValue: multi
            ? (editing?.accountSplits ?? []).map { SplitRow(accountId: $0.accountId, amountText: LedgerAmount.text($0.amount)) }
            : [])
        _accountId = State(initialValue: editing?.accountId ?? editing?.accountSplits.first?.accountId)
        _source = State(initialValue: editing?.merchantOrSource ?? "")
        _notes = State(initialValue: editing?.notes ?? "")
        _tagsText = State(initialValue: LedgerTags.join(editing?.tags ?? []))
    }

    private var isEditing: Bool { editing != nil }
    private var amount: Double? { LedgerAmount.parse(amountText) }
    private var selectedCategory: Category? { model.category(categoryId) }
    private var subcategories: [Subcategory] { selectedCategory?.subcategories ?? [] }

    private var categoryOptions: [Category] {
        var list = model.incomeCategories
        if let current = selectedCategory, !list.contains(where: { $0.id == current.id }) { list.insert(current, at: 0) }
        return list
    }

    // MARK: Split math

    private var splitSumCents: Int { splits.reduce(0) { $0 + LedgerAmount.cents(LedgerAmount.parse($1.amountText) ?? 0) } }
    private var totalCents: Int { LedgerAmount.cents(amount ?? 0) }
    private var splitAccountsDistinct: Bool {
        let ids = splits.compactMap(\.accountId)
        return Set(ids).count == ids.count
    }

    private var splitsValid: Bool {
        splits.count >= 2
            && splits.allSatisfy { $0.accountId != nil && (LedgerAmount.parse($0.amountText) ?? 0) > 0 }
            && splitAccountsDistinct
            && splitSumCents == totalCents
    }

    private var canSave: Bool {
        guard !isSaving, let amount, amount > 0, categoryId != nil, Format.day(date) != nil else { return false }
        return isSplit ? splitsValid : accountId != nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    AmountHeroField(text: $amountText, tint: Theme.mint)

                    LedgerDayPicker(day: $date)

                    categorySection

                    if !subcategories.isEmpty { subcategorySection }

                    accountSection

                    LabeledField(label: "Source (optional)") {
                        LedgerTextField(placeholder: "e.g. Employer name", text: $source, capitalization: .words)
                    }
                    LabeledField(label: "Notes (optional)") {
                        LedgerTextArea(placeholder: "Add notes…", text: $notes)
                    }
                    LabeledField(label: "Tags (optional)") {
                        LedgerTextField(placeholder: "salary, bonus", text: $tagsText, capitalization: .never)
                    }

                    Button(action: save) {
                        HStack(spacing: 8) {
                            if isSaving { ProgressView().tint(Theme.bg) }
                            Text(isEditing ? "Save Changes" : "Add Income")
                        }
                    }
                    .buttonStyle(.primary)
                    .disabled(!canSave)
                    .padding(.top, 4)
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.surface)
            .navigationTitle(isEditing ? "Edit Income" : "Add Income")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundStyle(Theme.inkSecondary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save).disabled(!canSave).foregroundStyle(canSave ? Theme.mint : Theme.inkMuted)
                }
            }
            .interactiveDismissDisabled(isSaving)
            .onChange(of: amountText) { _, _ in syncSingleSplit() }
        }
        .appSheet()
    }

    // MARK: Sections

    private var categorySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Category")
            FlowLayout(spacing: 8) {
                ForEach(categoryOptions) { category in
                    Chip(label: category.name, emoji: category.emoji, color: category.swiftColor, isSelected: categoryId == category.id) {
                        withAnimation(.snappy) {
                            if categoryId != category.id {
                                categoryId = category.id
                                subcategoryId = nil
                            }
                        }
                    }
                }
            }
            if model.incomeCategories.isEmpty {
                Text("No income categories yet — add one in More → Categories.")
                    .font(.footnote)
                    .foregroundStyle(Theme.inkMuted)
            }
        }
    }

    private var subcategorySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Subcategory (optional)")
            FlowLayout(spacing: 8) {
                Chip(label: "None", color: selectedCategory?.swiftColor ?? Theme.mint, isSelected: subcategoryId == nil) { subcategoryId = nil }
                ForEach(subcategories) { sub in
                    Chip(label: sub.name, color: selectedCategory?.swiftColor ?? Theme.mint, isSelected: subcategoryId == sub.id) {
                        subcategoryId = sub.id
                    }
                }
            }
        }
    }

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(isSplit ? "Accounts" : "Account").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.inkSecondary)
                Spacer()
                Toggle(isOn: Binding(get: { isSplit }, set: setSplit)) {
                    Text("Split across accounts").font(.system(size: 13)).foregroundStyle(Theme.inkSecondary)
                }
                .fixedSize()
                .tint(Theme.mint)
                .disabled(model.accounts.count < 2 && !isSplit)
            }

            if isSplit {
                ForEach($splits) { $row in
                    HStack(spacing: 8) {
                        LedgerAccountMenu(
                            selection: $row.accountId,
                            accounts: model.accounts,
                            excluded: Set(splits.filter { $0.id != row.id }.compactMap(\.accountId))
                        )
                        HStack(spacing: 2) {
                            Text("$").foregroundStyle(Theme.inkMuted)
                            TextField("0.00", text: $row.amountText)
                                .keyboardType(.decimalPad)
                                .font(.money(15, weight: .medium))
                        }
                        .fieldStyle()
                        .frame(width: 118)
                        Button {
                            removeSplit(row.id)
                        } label: {
                            Image(systemName: "minus.circle.fill").font(.system(size: 20)).foregroundStyle(Theme.danger.opacity(0.85))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove split")
                    }
                }

                HStack {
                    Button {
                        withAnimation(.snappy) { addSplit() }
                    } label: {
                        Label("Add account", systemImage: "plus.circle")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Theme.mint)
                    }
                    .buttonStyle(.plain)
                    .disabled(splits.count >= model.accounts.count)
                    Spacer()
                    splitStatus
                }
            } else {
                LedgerAccountMenu(selection: $accountId, accounts: model.accounts)
            }
        }
    }

    @ViewBuilder
    private var splitStatus: some View {
        let diff = totalCents - splitSumCents
        Group {
            if !splitAccountsDistinct {
                Text("Pick different accounts").foregroundStyle(Theme.warning)
            } else if diff == 0 && totalCents > 0 {
                Label("Split totals \(Format.money(Double(splitSumCents) / 100))", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(Theme.mint)
            } else if diff > 0 {
                Text("\(Format.money(Double(diff) / 100)) left to assign").foregroundStyle(Theme.warning)
            } else {
                Text("\(Format.money(Double(-diff) / 100)) over total").foregroundStyle(Theme.warning)
            }
        }
        .font(.system(size: 13, weight: .medium))
        .monospacedDigit()
    }

    // MARK: Split actions

    private func setSplit(_ on: Bool) {
        withAnimation(.snappy) {
            if on {
                let first = SplitRow(accountId: accountId, amountText: amountText)
                let otherId = model.accounts.first { $0.id != accountId }?.id
                splits = [first, SplitRow(accountId: otherId, amountText: "")]
                isSplit = true
            } else {
                accountId = splits.first?.accountId ?? accountId
                splits = []
                isSplit = false
            }
        }
    }

    private func addSplit() {
        let used = Set(splits.compactMap(\.accountId))
        let next = model.accounts.first { !used.contains($0.id) }?.id
        let remaining = max(0, totalCents - splitSumCents)
        splits.append(SplitRow(accountId: next, amountText: remaining > 0 ? LedgerAmount.text(Double(remaining) / 100) : ""))
    }

    private func removeSplit(_ id: UUID) {
        withAnimation(.snappy) {
            splits.removeAll { $0.id == id }
            if splits.count <= 1 {
                accountId = splits.first?.accountId ?? accountId
                splits = []
                isSplit = false
            }
        }
    }

    /// While the second row is still empty, keep the first row tracking the total (like the web).
    private func syncSingleSplit() {
        guard isSplit, splits.count == 2, splits[1].amountText.nilIfBlank == nil else { return }
        splits[0].amountText = amountText
    }

    // MARK: Save

    private func save() {
        guard canSave, let amount, let categoryId else { return }
        let accountSplits: [AccountSplit]
        if isSplit {
            accountSplits = splits.compactMap { row in
                guard let id = row.accountId, let value = LedgerAmount.parse(row.amountText) else { return nil }
                return AccountSplit(accountId: id, amount: value)
            }
        } else {
            guard let accountId else { return }
            accountSplits = [AccountSplit(accountId: accountId, amount: amount)]
        }
        let validSub = subcategories.contains { $0.id == subcategoryId } ? subcategoryId : nil
        let input = IncomeInput(
            date: date,
            amount: amount,
            categoryId: categoryId,
            subcategoryId: validSub,
            accountSplits: accountSplits,
            merchantOrSource: source.nilIfBlank,
            notes: notes.nilIfBlank,
            tags: LedgerTags.parse(tagsText)
        )
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                if let editing {
                    _ = try await model.api.updateIncome(editing.id, input)
                    model.showToast("Income updated")
                } else {
                    _ = try await model.api.createIncome(input)
                    model.showToast("Income added")
                }
                model.didMutate()
                dismiss()
            } catch {
                model.showError(error)
            }
        }
    }
}
