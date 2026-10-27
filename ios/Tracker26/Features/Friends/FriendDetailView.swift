import SwiftUI

/// One friend: balance, notes, activity (swipe to delete), edit / remove, add entry.
struct FriendDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var friend: Friend
    @State private var showEdit = false
    @State private var showAddEntry = false
    @State private var confirmRemove = false
    @State private var pendingDelete: FriendEntry?
    @State private var lastRevision: Int?

    init(friend: Friend) {
        _friend = State(initialValue: friend)
    }

    private var tint: Color {
        if friend.isSettled { return Theme.inkMuted }
        return friend.balance > 0 ? Theme.mint : Theme.danger
    }

    var body: some View {
        List {
            Section {
                balanceBox
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))

                if let notes = friend.notes?.nilIfBlank {
                    Text(notes)
                        .font(.subheadline)
                        .foregroundStyle(Theme.inkSecondary)
                        .panel(padding: 14, radius: Theme.radiusMd)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                }

                Button { showAddEntry = true } label: { Label("Add entry", systemImage: "plus") }
                    .buttonStyle(.primary)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 4, trailing: 0))
            }
            .listRowSeparator(.hidden)

            Section {
                if friend.entries.isEmpty {
                    Text("No entries yet")
                        .font(.subheadline)
                        .foregroundStyle(Theme.inkMuted)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, 12)
                        .appRow()
                } else {
                    ForEach(friend.entries) { entry in
                        FriendEntryRow(entry: entry)
                            .appRow()
                            .listRowSeparatorTint(Theme.borderSubtle)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) { pendingDelete = entry } label: { Label("Delete", systemImage: "trash") }
                                    .tint(Theme.danger)
                            }
                            .contextMenu {
                                Button(role: .destructive) { pendingDelete = entry } label: { Label("Delete entry", systemImage: "trash") }
                            }
                    }
                }
            } header: {
                Text("Activity")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.inkSecondary)
                    .textCase(nil)
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(12)
        .appScreen()
        .navigationTitle(friend.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { showEdit = true } label: { Label("Edit friend", systemImage: "pencil") }
                    Button(role: .destructive) { confirmRemove = true } label: { Label("Remove friend", systemImage: "person.badge.minus") }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .task(id: model.revision) { await refresh() }
        .refreshable { await refresh(force: true) }
        .sheet(isPresented: $showEdit) {
            FriendFormSheet(editing: friend) { friend = $0 }
        }
        .sheet(isPresented: $showAddEntry) {
            FriendEntrySheet(friend: friend) { friend = $0 }
        }
        .confirmationDialog("Remove \(friend.name)?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove friend", role: .destructive, action: removeFriend)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This deletes \(friend.name) and all of their entries.")
        }
        .confirmationDialog(
            "Delete this entry?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { entry in
            Button("Delete \(Format.money(entry.amount))", role: .destructive) { deleteEntry(entry) }
            Button("Cancel", role: .cancel) {}
        } message: { entry in
            Text("\(entry.description?.nilIfBlank ?? entry.type.label) · \(Format.shortDate(entry.date))")
        }
    }

    private var balanceBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                InitialsAvatar(initials: friend.initials, color: friend.swiftColor, size: 32)
                SectionLabel(friend.isSettled ? "Balance" : (friend.balance > 0 ? "They owe you" : "You owe them"))
            }
            if friend.isSettled {
                Text("Settled up").font(.display(30)).foregroundStyle(Theme.ink)
            } else {
                MoneyText(value: friend.balance, size: 34, color: tint, signed: true)
            }
            Text("\(friend.entries.count) entr\(friend.entries.count == 1 ? "y" : "ies")")
                .font(.system(size: 13))
                .foregroundStyle(Theme.inkMuted)
        }
        .tintedPanel(friend.isSettled ? Theme.inkMuted : tint, padding: 18)
    }

    // MARK: Actions

    /// Re-fetch after mutations elsewhere (skips the very first run — we were handed fresh data).
    private func refresh(force: Bool = false) async {
        defer { lastRevision = model.revision }
        guard force || (lastRevision != nil && lastRevision != model.revision) else { return }
        do {
            let all = try await model.api.friends()
            if let updated = all.first(where: { $0.id == friend.id }) { friend = updated }
        } catch is CancellationError {
        } catch {
            model.showError(error)
        }
    }

    private func deleteEntry(_ entry: FriendEntry) {
        Task {
            do {
                try await model.api.deleteFriendEntry(entry.id)
                withAnimation {
                    friend.entries.removeAll { $0.id == entry.id }
                    friend.balance -= entry.signedAmount
                }
                model.didMutate()
                model.showToast("Entry deleted")
            } catch {
                model.showError(error)
            }
        }
    }

    private func removeFriend() {
        Task {
            do {
                try await model.api.deleteFriend(friend.id)
                model.didMutate()
                model.showToast("\(friend.name) removed")
                dismiss()
            } catch {
                model.showError(error)
            }
        }
    }
}

private struct FriendEntryRow: View {
    let entry: FriendEntry

    private var color: Color { entry.signedAmount >= 0 ? Theme.mint : Theme.danger }

    private var symbol: String {
        switch entry.type {
        case .THEY_OWE_ME: "arrow.down.left"
        case .I_OWE_THEM: "arrow.up.right"
        case .THEY_PAID_ME, .I_PAID_THEM: "arrow.left.arrow.right"
        }
    }

    private var tileTint: Color {
        switch entry.type {
        case .THEY_OWE_ME: Theme.mint
        case .I_OWE_THEM: Theme.danger
        case .THEY_PAID_ME, .I_PAID_THEM: Theme.info
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            IconTile(symbol: symbol, tint: tileTint, size: 36)
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.description?.nilIfBlank ?? entry.type.label)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text("\(Format.shortDate(entry.date)) · \(entry.type.label)")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.inkMuted)
                    .lineLimit(1)
                if let notes = entry.notes?.nilIfBlank {
                    Text(notes).font(.system(size: 12)).foregroundStyle(Theme.inkSecondary).lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            Text(Format.signedMoney(entry.signedAmount))
                .font(.money(15))
                .foregroundStyle(color)
                .lineLimit(1)
        }
        .padding(.vertical, 4)
    }
}
