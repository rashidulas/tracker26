import SwiftUI

/// Create / edit a transfer between two accounts.
struct TransferFormSheet: View {
    let transfer: Transaction?

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var date: Date
    @State private var fromId: String
    @State private var toId: String
    @State private var amountText: String
    @State private var notes: String
    @State private var isSaving = false
    @State private var errorText: String?

    init(transfer: Transaction?) {
        self.transfer = transfer
        _date = State(initialValue: transfer.flatMap { Format.day($0.date) } ?? Format.todayUTC())
        _fromId = State(initialValue: transfer?.accountId ?? "")
        _toId = State(initialValue: transfer?.toAccountId ?? "")
        _amountText = State(initialValue: transfer.map { TransferFormSheet.plainAmount($0.amount) } ?? "")
        _notes = State(initialValue: transfer?.notes ?? "")
    }

    private var amount: Double? {
        guard let v = Double(amountString: amountText), v > 0 else { return nil }
        return (v * 100).rounded() / 100
    }

    private var sameAccount: Bool { !fromId.isEmpty && fromId == toId }
    private var isValid: Bool { amount != nil && !fromId.isEmpty && !toId.isEmpty && !sameAccount }

    /// Accounts for pickers; keeps the transfer's own accounts selectable even if lookups haven't loaded.
    private var accountOptions: [(id: String, name: String, symbol: String)] {
        var options = model.accounts
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            .map { (id: $0.id, name: $0.name, symbol: $0.type.symbol) }
        for ref in [transfer?.account, transfer?.toAccount].compactMap({ $0 }) where !options.contains(where: { $0.id == ref.id }) {
            options.append((id: ref.id, name: ref.name, symbol: ref.type.symbol))
        }
        return options
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    AmountHeroField(text: $amountText, tint: Theme.mint)
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)

                Section {
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                        .environment(\.timeZone, Format.utc)
                        .appRow()

                    accountPicker("From", selection: $fromId)
                        .appRow()

                    HStack {
                        Spacer()
                        Button {
                            let previousFrom = fromId; fromId = toId; toId = previousFrom
                        } label: {
                            Label("Swap", systemImage: "arrow.up.arrow.down")
                                .font(.system(size: 13, weight: .medium))
                        }
                        .buttonStyle(.borderless)
                        .disabled(fromId.isEmpty && toId.isEmpty)
                        Spacer()
                    }
                    .appRow()

                    accountPicker("To", selection: $toId)
                        .appRow()
                } footer: {
                    if sameAccount {
                        Text("From and To must be different accounts.").foregroundStyle(Theme.danger)
                    } else if accountOptions.count < 2 {
                        Text("You need at least two accounts to record a transfer.")
                    }
                }

                Section("Notes") {
                    TextField("Optional", text: $notes, axis: .vertical)
                        .lineLimit(1 ... 4)
                        .appRow()
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
            .navigationTitle(transfer == nil ? "New Transfer" : "Edit Transfer")
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

    private func accountPicker(_ title: String, selection: Binding<String>) -> some View {
        Picker(title, selection: selection) {
            Text("Select account").tag("")
            ForEach(accountOptions, id: \.id) { option in
                Label(option.name, systemImage: option.symbol).tag(option.id)
            }
        }
    }

    private func save() async {
        guard isValid, let amount else { return }
        let input = TransferInput(
            date: Format.dayString(date),
            amount: amount,
            fromAccountId: fromId,
            toAccountId: toId,
            notes: notes.nilIfBlank
        )
        isSaving = true
        errorText = nil
        defer { isSaving = false }
        do {
            if let transfer {
                _ = try await model.api.updateTransfer(transfer.id, input)
            } else {
                _ = try await model.api.createTransfer(input)
            }
            model.didMutate()
            model.showToast(transfer == nil ? "Transfer added" : "Transfer updated")
            dismiss()
        } catch is CancellationError {
        } catch {
            errorText = error.localizedDescription
        }
    }

    fileprivate static func plainAmount(_ value: Double) -> String {
        if value == value.rounded() { return String(Int(value)) }
        return String(format: "%.2f", value)
    }
}
