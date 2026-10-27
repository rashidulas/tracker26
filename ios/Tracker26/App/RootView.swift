import SwiftUI

/// Tabs mirror the web's mobile nav: Home · Expenses · Chat · More.
enum AppTab: Hashable {
    case home, expenses, chat, more
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var tab: AppTab = {
        #if DEBUG
        // Simulator convenience: `-debugTab expenses|chat|more`.
        switch UserDefaults.standard.string(forKey: "debugTab") {
        case "expenses": return .expenses
        case "chat": return .chat
        case "more": return .more
        default: return .home
        }
        #else
        return .home
        #endif
    }()

    var body: some View {
        Group {
            if model.isConfigured {
                TabView(selection: $tab) {
                    NavigationStack { DashboardView() }
                        .tabItem { Label("Home", systemImage: "square.grid.2x2") }
                        .tag(AppTab.home)

                    NavigationStack { ExpensesView() }
                        .tabItem { Label("Expenses", systemImage: "chart.line.downtrend.xyaxis") }
                        .tag(AppTab.expenses)

                    NavigationStack { ChatView() }
                        .tabItem { Label("Chat", systemImage: "bubble.left.and.text.bubble.right") }
                        .tag(AppTab.chat)

                    MoreView()
                        .tabItem { Label("More", systemImage: "ellipsis.circle") }
                        .tag(AppTab.more)
                }
                .task { await model.refreshLookups() }
            } else {
                OnboardingView()
            }
        }
        .modifier(ToastOverlay())
    }
}
