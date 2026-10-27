import Foundation
import Observation

/// App-wide state: connection settings, shared lookups (accounts / categories) and a change revision.
///
/// Screens read `model.api` to call the server. After any mutation, call `model.didMutate()` —
/// every screen that observes `model.revision` (via `.onChange` or `.task(id:)`) reloads.
@MainActor
@Observable
final class AppModel {
    private static let serverURLKey = "serverURL"
    private static let tokenKey = "apiToken"

    let api = APIClient()

    private(set) var serverURL: URL?
    private(set) var isConfigured = false

    /// Bumped after every create / update / delete so other screens refresh.
    private(set) var revision = 0

    /// Shared lookups used by forms and pickers.
    private(set) var accounts: [Account] = []
    private(set) var categories: [Category] = []

    var expenseCategories: [Category] { categories.filter { $0.type == .EXPENSE } }
    var incomeCategories: [Category] { categories.filter { $0.type == .INCOME } }

    /// Expense categories without the special Payment / Debt Payment sentinels (web hides them from the regular picker).
    var regularExpenseCategories: [Category] {
        expenseCategories.filter { $0.name != "Payment" && $0.name != "Debt Payment" }
    }

    init() {
        #if DEBUG
        // Dev convenience: `-debugServerURL http://localhost:3000 -debugApiToken <token>` launch arguments.
        // Saved like a normal sign-in, so later launches from the home screen stay connected.
        if let raw = UserDefaults.standard.string(forKey: "debugServerURL"), let url = URL(string: raw),
           let token = UserDefaults.standard.string(forKey: "debugApiToken") {
            UserDefaults.standard.set(url.absoluteString, forKey: Self.serverURLKey)
            Keychain.set(token, for: Self.tokenKey)
            apply(url: url, token: token)
            return
        }
        #endif
        if let raw = UserDefaults.standard.string(forKey: Self.serverURLKey),
           let url = URL(string: raw),
           let token = Keychain.get(Self.tokenKey), !token.isEmpty {
            apply(url: url, token: token)
        }
    }

    func account(_ id: String?) -> Account? { id.flatMap { id in accounts.first { $0.id == id } } }
    func category(_ id: String?) -> Category? { id.flatMap { id in categories.first { $0.id == id } } }

    // MARK: - Connection

    /// Normalises user input like `tracker.example.com` → `https://tracker.example.com`.
    static func normalizedURL(_ input: String) -> URL? {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasSuffix("/") { s.removeLast() }
        if s.isEmpty { return nil }
        if !s.lowercased().hasPrefix("http://") && !s.lowercased().hasPrefix("https://") { s = "https://" + s }
        guard let url = URL(string: s), url.host != nil else { return nil }
        return url
    }

    /// Verifies the connection, then saves it.
    func connect(urlString: String, token: String) async throws {
        guard let url = Self.normalizedURL(urlString) else { throw APIError.network("Enter a valid server URL") }
        let token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { throw APIError.network("Enter your API token") }

        let probe = APIClient(config: .init(baseURL: url, token: token))
        _ = try await probe.health()

        UserDefaults.standard.set(url.absoluteString, forKey: Self.serverURLKey)
        Keychain.set(token, for: Self.tokenKey)
        apply(url: url, token: token)
        await refreshLookups()
    }

    func signOut() {
        UserDefaults.standard.removeObject(forKey: Self.serverURLKey)
        Keychain.set(nil, for: Self.tokenKey)
        api.config = nil
        serverURL = nil
        isConfigured = false
        accounts = []
        categories = []
    }

    private func apply(url: URL, token: String) {
        api.config = .init(baseURL: url, token: token)
        serverURL = url
        isConfigured = true
    }

    // MARK: - Lookups

    func refreshLookups() async {
        guard isConfigured else { return }
        async let a = try? api.accounts()
        async let c = try? api.categories()
        if let accounts = await a { self.accounts = accounts }
        if let categories = await c { self.categories = categories }
    }

    /// Call after any successful mutation.
    func didMutate() {
        revision += 1
        Task { await refreshLookups() }
    }

    // MARK: - Toasts

    private(set) var toast: ToastMessage?

    /// Shows a short toast at the top of the screen (auto-dismisses after ~2.5s).
    func showToast(_ text: String, style: ToastMessage.Style = .success) {
        let message = ToastMessage(text: text, style: style)
        toast = message
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            if toast?.id == message.id { toast = nil }
        }
    }

    /// Convenience for catch blocks: shows the error as a toast.
    func showError(_ error: Error) {
        if error is CancellationError { return }
        showToast(error.localizedDescription, style: .error)
    }
}
