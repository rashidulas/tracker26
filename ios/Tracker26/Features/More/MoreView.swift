import SwiftUI

/// "Others" grid from the web's mobile nav sheet, as a tab.
struct MoreView: View {
    private struct Item: Identifiable {
        let id: String
        let title: String
        let hint: String
        let symbol: String
        let tint: Color
    }

    private let items: [Item] = [
        .init(id: "friends", title: "Friends", hint: "IOUs and shared money", symbol: "person.2", tint: Theme.info),
        .init(id: "analytics", title: "Analytics", hint: "AI daily money debrief", symbol: "sparkles", tint: Theme.purple),
        .init(id: "accounts", title: "Accounts", hint: "Balances, cards & loans", symbol: "wallet.bifold", tint: Theme.mint),
        .init(id: "income", title: "Income", hint: "Log and review income", symbol: "chart.line.uptrend.xyaxis", tint: Theme.mint),
        .init(id: "categories", title: "Categories", hint: "Income & spend labels", symbol: "folder", tint: Theme.orange),
        .init(id: "transfers", title: "Transfers", hint: "Move between accounts", symbol: "arrow.left.arrow.right", tint: Theme.cyan),
    ]

    @State private var path: [String] = {
        #if DEBUG
        // Simulator convenience: `-debugMore friends|analytics|accounts|income|categories|transfers|settings`.
        if let id = UserDefaults.standard.string(forKey: "debugMore") { return [id] }
        #endif
        return []
    }()

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        NavigationStack(path: $path) { content }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                LazyVGrid(columns: columns, spacing: 10) {
                    ForEach(items) { item in
                        NavigationLink(value: item.id) {
                            VStack(alignment: .leading, spacing: 10) {
                                IconTile(symbol: item.symbol, tint: item.tint, size: 36)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.title).font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.ink)
                                    Text(item.hint).font(.system(size: 11)).foregroundStyle(Theme.inkMuted).lineLimit(1)
                                }
                            }
                            .panel(padding: 14)
                        }
                        .buttonStyle(.plain)
                    }
                }

                NavigationLink(value: "settings") {
                    HStack(spacing: 12) {
                        IconTile(symbol: "gearshape", tint: Theme.inkSecondary, size: 36)
                        Text("Settings").font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.ink)
                        Spacer()
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkMuted)
                    }
                    .panel(padding: 14)
                }
                .buttonStyle(.plain)
            }
            .padding(16)
        }
        .appScreen()
        .navigationTitle("More")
        .navigationDestination(for: String.self) { id in
            switch id {
            case "friends": FriendsView()
            case "analytics": AnalyticsView()
            case "accounts": AccountsView()
            case "income": IncomeView()
            case "categories": CategoriesView()
            case "transfers": TransfersView()
            default: SettingsView()
            }
        }
    }
}
