import SwiftUI

/// Add / edit expense. Mirrors the web ExpenseForm: amount first, then category — details stay optional.
/// In add mode the special "Payment" and "Debt Payment" chips switch the form to a transfer (`POST /payments`).
struct ExpenseFormSheet: View {
    enum Mode: Equatable { case regular, payment, debtPayment }

    let editing: Transaction?

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var mode: Mode = .regular
    @State private var amountText: String
    @State private var date: String
    @State private var categoryId: String?
    @State private var subcategoryId: String?
    @State private var accountId: String?
    @State private var merchant: String
    @State private var notes: String
    @State private var tagsText: String
    @State private var fromAccountId: String?
    @State private var toAccountId: String?
    @State private var showDetails: Bool
    @State private var isSaving = false

    init(editing: Transaction? = nil) {
        self.editing = editing
        _amountText = State(initialValue: editing.map { LedgerAmount.text($0.amount) } ?? "")
        _date = State(initialValue: editing?.date ?? Format.todayString())
        _categoryId = State(initialValue: editing?.categoryId)
        _subcategoryId = State(initialValue: editing?.subcategoryId)
        _accountId = State(initialValue: editing?.accountId)
        _merchant = State(initialValue: editing?.merchantOrSource ?? "")
        _notes = State(initialValue: editing?.notes ?? "")
        _tagsText = State(initialValue: LedgerTags.join(editing?.tags ?? []))
        let hasDetails = editing.map { $0.merchantOrSource?.nilIfBlank != nil || $0.notes?.nilIfBlank != nil || !$0.tags.isEmpty } ?? false
        _showDetails = State(initialValue: hasDetails)
    }

    private var isEditing: Bool { editing != nil }
    private var amount: Double? { LedgerAmount.parse(amountText) }

    private var selectedCategory: Category? { model.category(categoryId) }
    private var subcategories: [Subcategory] { mode == .regular ? (selectedCategory?.subcategories ?? []) : [] }

    private var fromAccount: Account? { model.account(fromAccountId) }
    private var toAccount: Account? { model.account(toAccountId) }

    private var canSave: Bool {
        guard !isSaving, let amount, amount > 0, Format.day(date) != nil else { return false }
        switch mode {
        case .regular:
            return categoryId != nil
        case .payment, .debtPayment:
            guard let from = fromAccountId, let to = toAccountId else { return false }
            return from != to
        }
    }

    private var saveTitle: String {
        switch mode {
        case .regular: isEditing ? "Save Changes" : "Add Expense"
        case .payment: "Record Payment"
        case .debtPayment: "Record Debt Payment"
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if !isEditing {
                        Text("Amount first, then category — details stay optional.")
                            .font(.subheadline)
                            .foregroundStyle(Theme.inkSecondary)
                    }

                    AmountHeroField(text: $amountText, tint: Theme.danger, label: mode == .regular ? "Amount" : "Payment amount")

                    LedgerDayPicker(day: $date)

                    categorySection

                    if !subcategories.isEmpty { subcategorySection }

                    switch mode {
                    case .regular: regularSection
                    case .payment: paymentSection
                    case .debtPayment: debtPaymentSection
                    }

                    Button(action: save) {
                        HStack(spacing: 8) {
                            if isSaving { ProgressView().tint(Theme.bg) }
                            Text(saveTitle)
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
            .navigationTitle(isEditing ? "Edit Expense" : "Add Expense")
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
        }
        .appSheet()
    }

    // MARK: Sections

    private var categorySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Category")
            FlowLayout(spacing: 8) {
                if !isEditing {
                    Chip(label: "Payment", symbol: "banknote", color: Theme.info, isSelected: mode == .payment) {
                        withAnimation(.snappy) { mode = .payment }
                    }
                    Chip(label: "Debt Payment", symbol: "creditcard", color: Theme.mint, isSelected: mode == .debtPayment) {
                        withAnimation(.snappy) { mode = .debtPayment }
                    }
                }
                ForEach(categoryOptions) { category in
                    Chip(
                        label: category.name,
                        emoji: category.emoji,
                        color: category.swiftColor,
                        isSelected: mode == .regular && categoryId == category.id
                    ) {
                        withAnimation(.snappy) {
                            mode = .regular
                            if categoryId != category.id {
                                categoryId = category.id
                                subcategoryId = nil
                            }
                        }
                    }
                }
            }
            if model.regularExpenseCategories.isEmpty {
                Text("No expense categories yet — add one in More → Categories.")
                    .font(.footnote)
                    .foregroundStyle(Theme.inkMuted)
            }
        }
    }

    /// Regular categories, plus the edited transaction's own category if it's not among them.
    private var categoryOptions: [Category] {
        var list = model.regularExpenseCategories
        if let current = selectedCategory, !list.contains(where: { $0.id == current.id }) { list.insert(current, at: 0) }
        return list
    }

    private var subcategorySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Subcategory")
            FlowLayout(spacing: 8) {
                Chip(label: "None", color: selectedCategory?.swiftColor ?? Theme.mint, isSelected: subcategoryId == nil) {
                    subcategoryId = nil
                }
                ForEach(subcategories) { sub in
                    Chip(label: sub.name, color: selectedCategory?.swiftColor ?? Theme.mint, isSelected: subcategoryId == sub.id) {
                        subcategoryId = sub.id
                    }
                }
            }
        }
    }

    private var regularSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            LabeledField(label: "Account") {
                LedgerAccountMenu(selection: $accountId, accounts: model.accounts, noneLabel: "No account")
            }

            VStack(alignment: .leading, spacing: 14) {
                Button {
                    withAnimation(.snappy) { showDetails.toggle() }
                } label: {
                    HStack {
                        Text("Merchant, notes & tags").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.inkSecondary)
                        Spacer()
                        Image(systemName: "chevron.down")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.inkMuted)
                            .rotationEffect(.degrees(showDetails ? 180 : 0))
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if showDetails {
                    LabeledField(label: "Merchant") {
                        LedgerTextField(placeholder: "e.g. Walmart", text: $merchant, capitalization: .words)
                    }
                    LabeledField(label: "Notes") {
                        LedgerTextArea(placeholder: "Add notes…", text: $notes)
                    }
                    LabeledField(label: "Tags") {
                        LedgerTextField(placeholder: "business, deductible", text: $tagsText, capitalization: .never)
                    }
                }
            }
            .padding(14)
            .background(Theme.surface2.opacity(0.5), in: RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous).strokeBorder(Theme.borderSubtle, lineWidth: 1))
        }
    }

    private var paymentSection: some View {
        transferBox(
            tint: Theme.info,
            symbol: "banknote",
            message: "Moves money from Pay From to Pay To without counting as spending."
        ) {
            LabeledField(label: "Pay From") {
                LedgerAccountMenu(selection: $fromAccountId, accounts: model.accounts, excluded: Set([toAccountId].compactMap { $0 }))
            }
            LabeledField(label: "Pay To") {
                LedgerAccountMenu(selection: $toAccountId, accounts: model.accounts, excluded: Set([fromAccountId].compactMap { $0 }))
            }
            previewAndNotes(placeholder: "e.g. Monthly transfer to savings")
        }
    }

    private var debtPaymentSection: some View {
        transferBox(
            tint: Theme.mint,
            symbol: "creditcard",
            message: "Pays down a card or debt from another account."
        ) {
            LabeledField(label: "Debt / Card to Pay") {
                LedgerAccountMenu(
                    selection: $toAccountId,
                    accounts: model.accounts,
                    liabilitiesFirst: true,
                    excluded: Set([fromAccountId].compactMap { $0 })
                )
            }
            LabeledField(label: "Pay From Account") {
                LedgerAccountMenu(selection: $fromAccountId, accounts: model.accounts, excluded: Set([toAccountId].compactMap { $0 }))
            }
            previewAndNotes(placeholder: "e.g. Monthly minimum payment")
        }
    }

    @ViewBuilder
    private func previewAndNotes(placeholder: String) -> some View {
        if let fromAccountId, fromAccountId == toAccountId {
            Text("Pay From and Pay To must be different accounts.")
                .font(.footnote)
                .foregroundStyle(Theme.warning)
        } else if let fromAccount, let toAccount, let amount, amount > 0 {
            LedgerMovePreview(fromName: fromAccount.name, toName: toAccount.name, amount: amount)
        }
        LabeledField(label: "Notes (optional)") {
            LedgerTextArea(placeholder: placeholder, text: $notes)
        }
    }

    private func transferBox<Content: View>(tint: Color, symbol: String, message: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: symbol).foregroundStyle(tint)
                Text(message).font(.subheadline).foregroundStyle(tint)
            }
            content()
        }
        .padding(16)
        .background(tint.opacity(0.06), in: RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous).strokeBorder(tint.opacity(0.2), lineWidth: 1))
    }

    // MARK: Save

    private func save() {
        guard canSave, let amount else { return }
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                switch mode {
                case .regular:
                    guard let categoryId else { return }
                    let validSub = subcategories.contains { $0.id == subcategoryId } ? subcategoryId : nil
                    let input = ExpenseInput(
                        date: date,
                        amount: amount,
                        categoryId: categoryId,
                        subcategoryId: validSub,
                        accountId: accountId,
                        merchantOrSource: merchant.nilIfBlank,
                        notes: notes.nilIfBlank,
                        tags: LedgerTags.parse(tagsText)
                    )
                    if let editing {
                        _ = try await model.api.updateExpense(editing.id, input)
                        model.showToast("Expense updated")
                    } else {
                        _ = try await model.api.createExpense(input)
                        model.showToast("Expense added")
                    }
                case .payment, .debtPayment:
                    guard let fromAccountId, let toAccountId else { return }
                    let input = PaymentInput(
                        mode: mode == .payment ? .PAYMENT : .DEBT_PAYMENT,
                        amount: amount,
                        date: date,
                        fromAccountId: fromAccountId,
                        toAccountId: toAccountId,
                        notes: notes.nilIfBlank
                    )
                    _ = try await model.api.createPayment(input)
                    model.showToast(mode == .payment ? "Payment recorded" : "Debt payment recorded")
                }
                model.didMutate()
                dismiss()
            } catch {
                model.showError(error)
            }
        }
    }
}
