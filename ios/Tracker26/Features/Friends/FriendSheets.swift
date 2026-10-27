import SwiftUI

/// Add friend (with optional opening balance) or edit name / notes / colour.
struct FriendFormSheet: View {
    let editing: Friend?
    var onSaved: (Friend) -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var notes: String
    @State private var color: String
    @State private var hasOpening = false
    @State private var openingType: FriendEntryType = .THEY_OWE_ME
    @State private var openingAmountText = ""
    @State private var isSaving = false

    init(editing: Friend?, onSaved: @escaping (Friend) -> Void) {
        self.editing = editing
        self.onSaved = onSaved
        _name = State(initialValue: editing?.name ?? "")
        _notes = State(initialValue: editing?.notes ?? "")
        _color = State(initialValue: editing?.color ?? Theme.palette.randomElement() ?? "#3dcea6")
    }

    private var isEditing: Bool { editing != nil }
    private var openingAmount: Double? { LedgerAmount.parse(openingAmountText) }

    private var canSave: Bool {
        guard !isSaving, name.nilIfBlank != nil else { return false }
        if hasOpening && !isEditing { return (openingAmount ?? 0) > 0 }
        return true
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(spacing: 14) {
                        InitialsAvatar(initials: initials, color: Color(hex: color), size: 52)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(name.nilIfBlank ?? "New friend").font(.display(18)).foregroundStyle(Theme.ink)
                            Text(isEditing ? "Edit details" : "Track who owes whom").font(.footnote).foregroundStyle(Theme.inkMuted)
                        }
                    }

                    LabeledField(label: "Name") {
                        LedgerTextField(placeholder: "e.g. Alex", text: $name, capitalization: .words)
                    }
                    LabeledField(label: "Notes (optional)") {
                        LedgerTextArea(placeholder: "Roommate, trip buddy…", text: $notes)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        SectionLabel("Colour")
                        FlowLayout(spacing: 10) {
                            ForEach(Theme.palette, id: \.self) { hex in
                                Button {
                                    color = hex
                                } label: {
                                    Circle()
                                        .fill(Color(hex: hex))
                                        .frame(width: 34, height: 34)
                                        .overlay(Circle().strokeBorder(Theme.ink, lineWidth: color.lowercased() == hex.lowercased() ? 2.5 : 0))
                                        .padding(2)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Colour \(hex)")
                            }
                        }
                    }

                    if !isEditing { openingSection }

                    Button(action: save) {
                        HStack(spacing: 8) {
                            if isSaving { ProgressView().tint(Theme.bg) }
                            Text(isEditing ? "Save Changes" : "Add Friend")
                        }
                    }
                    .buttonStyle(.primary)
                    .disabled(!canSave)
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.surface)
            .navigationTitle(isEditing ? "Edit Friend" : "Add Friend")
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

    private var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        let s = parts.compactMap { $0.first.map(String.init) }.joined()
        return s.isEmpty ? "?" : s.uppercased()
    }

    private var openingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Toggle(isOn: $hasOpening.animation(.snappy)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Opening balance").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.inkSecondary)
                    Text("Start with money already owed").font(.system(size: 12)).foregroundStyle(Theme.inkMuted)
                }
            }
            .tint(Theme.mint)

            if hasOpening {
                Picker("Direction", selection: $openingType) {
                    Text("They owe me").tag(FriendEntryType.THEY_OWE_ME)
                    Text("I owe them").tag(FriendEntryType.I_OWE_THEM)
                }
                .pickerStyle(.segmented)

                HStack(spacing: 4) {
                    Text("$").foregroundStyle(Theme.inkMuted)
                    TextField("0.00", text: $openingAmountText)
                        .keyboardType(.decimalPad)
                        .font(.money(17, weight: .medium))
                }
                .fieldStyle()
            }
        }
        .padding(14)
        .background(Theme.surface2.opacity(0.5), in: RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous).strokeBorder(Theme.borderSubtle, lineWidth: 1))
    }

    private func save() {
        guard canSave, let trimmed = name.nilIfBlank else { return }
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                let saved: Friend
                if let editing {
                    saved = try await model.api.updateFriend(editing.id, FriendInput(name: trimmed, notes: notes.nilIfBlank, color: color))
                    model.showToast("Friend updated")
                } else {
                    let opening = hasOpening ? openingAmount : nil
                    saved = try await model.api.createFriend(FriendInput(
                        name: trimmed,
                        notes: notes.nilIfBlank,
                        color: color,
                        openingAmount: opening,
                        openingType: opening == nil ? nil : openingType
                    ))
                    model.showToast("\(trimmed) added")
                }
                onSaved(saved)
                model.didMutate()
                dismiss()
            } catch {
                model.showError(error)
            }
        }
    }
}

/// Add an IOU / settlement entry. Returns the updated friend.
struct FriendEntrySheet: View {
    let friend: Friend
    var onSaved: (Friend) -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var amountText = ""
    @State private var type: FriendEntryType?
    @State private var date = Format.todayString()
    @State private var descriptionText = ""
    @State private var isSaving = false

    private var amount: Double? { LedgerAmount.parse(amountText) }
    private var canSave: Bool { !isSaving && (amount ?? 0) > 0 && type != nil && Format.day(date) != nil }

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    AmountHeroField(text: $amountText, tint: Theme.info)

                    VStack(alignment: .leading, spacing: 10) {
                        SectionLabel("What happened?")
                        LazyVGrid(columns: columns, spacing: 10) {
                            ForEach(FriendEntryType.allCases) { option in
                                typeButton(option)
                            }
                        }
                    }

                    LedgerDayPicker(day: $date)

                    LabeledField(label: "Description (optional)") {
                        LedgerTextField(placeholder: "e.g. Dinner at Nando's", text: $descriptionText)
                    }

                    if let type, let amount, amount > 0 {
                        let signed = amount * type.sign
                        HStack {
                            Text("Balance after").font(.system(size: 13)).foregroundStyle(Theme.inkMuted)
                            Spacer()
                            let after = friend.balance + signed
                            Text(abs(after) < 0.005 ? "Settled up" : Format.signedMoney(after))
                                .font(.money(14))
                                .foregroundStyle(abs(after) < 0.005 ? Theme.ink : (after > 0 ? Theme.mint : Theme.danger))
                        }
                        .panel(padding: 12, radius: Theme.radiusMd)
                    }

                    Button(action: save) {
                        HStack(spacing: 8) {
                            if isSaving { ProgressView().tint(Theme.bg) }
                            Text("Add Entry")
                        }
                    }
                    .buttonStyle(.primary)
                    .disabled(!canSave)
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.surface)
            .navigationTitle("Entry with \(friend.name)")
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

    private func tint(_ option: FriendEntryType) -> Color {
        switch option {
        case .THEY_OWE_ME: Theme.mint
        case .I_OWE_THEM: Theme.danger
        case .THEY_PAID_ME, .I_PAID_THEM: Theme.info
        }
    }

    private func typeButton(_ option: FriendEntryType) -> some View {
        let selected = type == option
        let color = tint(option)
        return Button {
            withAnimation(.snappy) { type = option }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(option.label).font(.system(size: 15, weight: .semibold)).foregroundStyle(selected ? color : Theme.ink)
                Text(option.hint).font(.system(size: 12)).foregroundStyle(Theme.inkMuted).multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .topLeading)
            .padding(12)
            .background(selected ? color.opacity(0.14) : Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous)
                    .strokeBorder(selected ? color.opacity(0.6) : Theme.border, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func save() {
        guard canSave, let amount, let type else { return }
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                let updated = try await model.api.addFriendEntry(
                    friendId: friend.id,
                    FriendEntryInput(date: date, amount: amount, type: type, description: descriptionText.nilIfBlank, notes: nil)
                )
                onSaved(updated)
                model.didMutate()
                model.showToast("Entry added")
                dismiss()
            } catch {
                model.showError(error)
            }
        }
    }
}
