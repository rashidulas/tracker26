import SwiftUI

/// Create / edit an account (mirrors `app/accounts/AccountForm.tsx`).
struct AccountFormSheet: View {
    let account: Account?

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var type: AccountType
    @State private var institution: String
    @State private var startingText: String
    @State private var limitText: String
    @State private var isSaving = false
    @State private var errorText: String?

    init(account: Account?) {
        self.account = account
        _name = State(initialValue: account?.name ?? "")
        _type = State(initialValue: account?.type ?? .CHECKING)
        _institution = State(initialValue: account?.institution ?? "")
        _startingText = State(initialValue: account.map { AccountFormSheet.plain($0.startingBalance) } ?? "0")
        _limitText = State(initialValue: account?.creditLimit.flatMap { $0 > 0 ? AccountFormSheet.plain($0) : nil } ?? "")
    }

    // MARK: Validation

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Empty counts as 0; otherwise must parse (negative allowed).
    private var startingBalance: Double? {
        let t = startingText.trimmingCharacters(in: .whitespaces)
        if t.isEmpty || t == "-" { return t.isEmpty ? 0 : nil }
        return Double(amountString: t.replacingOccurrences(of: "−", with: "-"))
    }

    /// `.some(nil)` = no limit, `.some(v)` = valid limit, `nil` = invalid input.
    private var creditLimit: Double?? {
        guard type == .CREDIT_CARD else { return .some(nil) }
        let t = limitText.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { return .some(nil) }
        guard let v = Double(amountString: t), v > 0 else { return nil }
        return .some(v)
    }

    private var isValid: Bool { !trimmedName.isEmpty && startingBalance != nil && creditLimit != nil }

    // MARK: Body

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name (e.g. Main Checking)", text: $name)
                        .textInputAutocapitalization(.words)
                        .appRow()
                    Picker("Type", selection: $type) {
                        ForEach(AccountType.allCases) { t in
                            Label(t.label, systemImage: t.symbol).tag(t)
                        }
                    }
                    .appRow()
                    TextField("Institution (optional, e.g. Chase)", text: $institution)
                        .textInputAutocapitalization(.words)
                        .appRow()
                }

                Section {
                    HStack(spacing: 10) {
                        Text("Starting balance").foregroundStyle(Theme.ink)
                        Spacer(minLength: 8)
                        Button {
                            toggleSign()
                        } label: {
                            Text("±")
                                .font(.system(size: 15, weight: .semibold))
                                .frame(width: 30, height: 28)
                                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Toggle negative")
                        TextField("0.00", text: $startingText)
                            .keyboardType(.numbersAndPunctuation)
                            .multilineTextAlignment(.trailing)
                            .font(.money(16, weight: .medium))
                            .frame(maxWidth: 140)
                    }
                    .appRow()
                } footer: {
                    if startingBalance == nil {
                        Text("Enter a valid number, e.g. 1250 or -450.").foregroundStyle(Theme.danger)
                    } else if type.isLiability {
                        Text("Use a negative number if you owed money when you started tracking (e.g. -450).")
                    } else {
                        Text("The balance before any tracked transactions.")
                    }
                }

                if type == .CREDIT_CARD {
                    Section {
                        HStack {
                            Text("Credit limit").foregroundStyle(Theme.ink)
                            Spacer(minLength: 8)
                            TextField("e.g. 5000", text: $limitText)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .font(.money(16, weight: .medium))
                                .frame(maxWidth: 160)
                        }
                        .appRow()
                    } footer: {
                        if creditLimit == nil {
                            Text("Credit limit must be a positive number, or leave it empty.").foregroundStyle(Theme.danger)
                        } else {
                            Text("Optional. Used for the usage bar on the dashboard.")
                        }
                    }
                }

                if let errorText {
                    Section {
                        Label(errorText, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(Theme.danger)
                            .appRow()
                    }
                }
            }
            .appFormStyle()
            .navigationTitle(account == nil ? "Add Account" : "Edit Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView().tint(Theme.mint)
                    } else {
                        Button("Save") { Task { await save() } }
                            .fontWeight(.semibold)
                            .disabled(!isValid)
                    }
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
    }

    // MARK: Actions

    private func toggleSign() {
        var t = startingText.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("-") || t.hasPrefix("−") {
            t.removeFirst()
        } else {
            t = "-" + (t.isEmpty ? "" : t)
        }
        startingText = t
    }

    private func save() async {
        guard isValid, let starting = startingBalance, let limit = creditLimit else { return }
        let input = AccountInput(
            name: trimmedName,
            type: type,
            institution: institution.nilIfBlank,
            startingBalance: (starting * 100).rounded() / 100,
            creditLimit: type == .CREDIT_CARD ? limit : nil
        )
        isSaving = true
        errorText = nil
        defer { isSaving = false }
        do {
            if let account {
                _ = try await model.api.updateAccount(account.id, input)
            } else {
                _ = try await model.api.createAccount(input)
            }
            model.didMutate()
            model.showToast(account == nil ? "Account added" : "Account updated")
            dismiss()
        } catch is CancellationError {
        } catch {
            errorText = error.localizedDescription
        }
    }

    /// `1250` / `1250.5` / `-450.25` for editing (no grouping, no currency).
    fileprivate static func plain(_ value: Double) -> String {
        if value == value.rounded() { return String(Int(value)) }
        return String(format: "%.2f", value)
    }
}
