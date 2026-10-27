import SwiftUI

/// Friends: who owes whom. Summary tiles, friend cards → detail with activity.
struct FriendsView: View {
    @Environment(AppModel.self) private var model

    @State private var friends: [Friend] = []
    @State private var hasLoaded = false
    @State private var isLoading = false
    @State private var loadError: String?
    @State private var showAdd = false

    private var owedToYou: Double { friends.filter { $0.balance > 0 }.reduce(0) { $0 + $1.balance } }
    private var youOwe: Double { friends.filter { $0.balance < 0 }.reduce(0) { $0 - $1.balance } }
    private var net: Double { owedToYou - youOwe }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let loadError {
                    ErrorBanner(message: loadError) { Task { await load() } }
                }

                if !hasLoaded && isLoading {
                    LoadingView(message: "Loading friends…")
                } else if hasLoaded {
                    summaryTiles

                    if friends.isEmpty {
                        EmptyStateView(
                            symbol: "person.2",
                            title: "No friends yet",
                            message: "Track shared expenses and IOUs with the people you split money with.",
                            tint: Theme.info
                        ) {
                            Button { showAdd = true } label: { Label("Add Friend", systemImage: "person.badge.plus") }
                                .buttonStyle(.primary)
                                .padding(.top, 6)
                        }
                    } else {
                        SectionLabel("People")
                            .padding(.top, 4)
                        LazyVStack(spacing: 10) {
                            ForEach(friends) { friend in
                                NavigationLink(value: FriendRoute(friend: friend)) {
                                    FriendCard(friend: friend)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
            .padding(16)
        }
        .appScreen()
        .navigationTitle("Friends")
        .navigationDestination(for: FriendRoute.self) { route in
            FriendDetailView(friend: route.friend)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showAdd = true } label: { Image(systemName: "person.badge.plus") }
                    .accessibilityLabel("Add friend")
            }
        }
        .task(id: model.revision) { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showAdd) { FriendFormSheet(editing: nil) { _ in } }
    }

    private var summaryTiles: some View {
        HStack(spacing: 10) {
            FriendSummaryTile(title: "Owed to you", value: owedToYou, color: Theme.mint)
            FriendSummaryTile(title: "You owe", value: youOwe, color: Theme.danger)
            FriendSummaryTile(
                title: "Net",
                value: net,
                color: abs(net) < 0.005 ? Theme.ink : (net > 0 ? Theme.mint : Theme.danger),
                signed: true
            )
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            friends = try await model.api.friends()
            loadError = nil
            hasLoaded = true
        } catch is CancellationError {
        } catch {
            loadError = error.localizedDescription
            hasLoaded = true
        }
    }
}

/// Navigation value (a distinct type so it doesn't collide with `String` routes in More).
struct FriendRoute: Hashable {
    let friend: Friend
}

private struct FriendSummaryTile: View {
    let title: String
    let value: Double
    let color: Color
    var signed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(title)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            MoneyText(value: value, size: 17, color: color, signed: signed)
        }
        .tintedPanel(color == Theme.ink ? Theme.inkMuted : color, padding: 12, radius: Theme.radiusMd)
    }
}

private struct FriendCard: View {
    let friend: Friend

    private var amountColor: Color {
        if friend.isSettled { return Theme.inkMuted }
        return friend.balance > 0 ? Theme.mint : Theme.danger
    }

    private var status: String {
        let base = friend.isSettled ? "Settled up" : (friend.balance > 0 ? "They owe you" : "You owe them")
        let n = friend.entries.count
        guard n > 0 else { return base }
        return "\(base) · \(n) entr\(n == 1 ? "y" : "ies")"
    }

    var body: some View {
        HStack(spacing: 12) {
            InitialsAvatar(initials: friend.initials, color: friend.swiftColor, size: 42)
            VStack(alignment: .leading, spacing: 3) {
                Text(friend.name).font(.system(size: 16, weight: .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(status).font(.system(size: 12)).foregroundStyle(Theme.inkMuted).lineLimit(1)
            }
            Spacer(minLength: 8)
            if friend.isSettled {
                Image(systemName: "checkmark.circle").foregroundStyle(Theme.inkMuted)
            } else {
                MoneyText(value: abs(friend.balance), size: 16, color: amountColor)
            }
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.inkMuted)
        }
        .padding(14)
        .padding(.leading, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous))
        .overlay(alignment: .leading) {
            friend.swiftColor
                .frame(width: 4)
                .padding(.vertical, 14)
                .clipShape(Capsule())
        }
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous).strokeBorder(Theme.borderSubtle, lineWidth: 1))
        .contentShape(Rectangle())
    }
}
