import Foundation

/// Typed wrappers for every endpoint in ios/API.md. Screens should call these, not raw paths.
extension APIClient {
    // MARK: Health / dashboard
    func health() async throws -> HealthResponse { try await get("health") }
    func dashboard() async throws -> Dashboard { try await get("dashboard") }

    // MARK: Accounts
    func accounts() async throws -> [Account] { try await get("accounts") }
    func createAccount(_ input: AccountInput) async throws -> Account { try await post("accounts", body: input) }
    func updateAccount(_ id: String, _ input: AccountInput) async throws -> Account { try await patch("accounts/\(id)", body: input) }
    func deleteAccount(_ id: String) async throws { try await delete("accounts/\(id)") }

    // MARK: Categories
    func categories(type: CategoryType? = nil) async throws -> [Category] {
        try await get("categories", query: ["type": type?.rawValue])
    }
    func createCategory(_ input: CategoryInput) async throws -> Category { try await post("categories", body: input) }
    func updateCategory(_ id: String, _ input: CategoryInput) async throws -> Category { try await patch("categories/\(id)", body: input) }
    func deleteCategory(_ id: String) async throws { try await delete("categories/\(id)") }

    // MARK: Expenses
    struct TransactionFilter: Equatable {
        var month: String? // YYYY-MM
        var startDate: String?
        var endDate: String?
        var categoryId: String?
        var search: String?

        var query: [String: String?] {
            ["month": month, "startDate": startDate, "endDate": endDate, "categoryId": categoryId, "search": search?.nilIfBlank]
        }
    }

    func expenses(_ filter: TransactionFilter = .init()) async throws -> [Transaction] { try await get("expenses", query: filter.query) }
    func expenseMonths() async throws -> [String] { try await get("expenses/months") }
    func createExpense(_ input: ExpenseInput) async throws -> Transaction { try await post("expenses", body: input) }
    func updateExpense(_ id: String, _ input: ExpenseInput) async throws -> Transaction { try await patch("expenses/\(id)", body: input) }
    func createPayment(_ input: PaymentInput) async throws -> Transaction { try await post("payments", body: input) }

    // MARK: Income
    func income(_ filter: TransactionFilter = .init()) async throws -> [Transaction] { try await get("income", query: filter.query) }
    func createIncome(_ input: IncomeInput) async throws -> Transaction { try await post("income", body: input) }
    func updateIncome(_ id: String, _ input: IncomeInput) async throws -> Transaction { try await patch("income/\(id)", body: input) }

    // MARK: Transfers
    func transfers() async throws -> [Transaction] { try await get("transfers") }
    func createTransfer(_ input: TransferInput) async throws -> Transaction { try await post("transfers", body: input) }
    func updateTransfer(_ id: String, _ input: TransferInput) async throws -> Transaction { try await patch("transfers/\(id)", body: input) }

    // MARK: Generic transaction delete
    func deleteTransaction(_ id: String) async throws { try await delete("transactions/\(id)") }

    // MARK: Friends
    func friends() async throws -> [Friend] { try await get("friends") }
    func createFriend(_ input: FriendInput) async throws -> Friend { try await post("friends", body: input) }
    func updateFriend(_ id: String, _ input: FriendInput) async throws -> Friend { try await patch("friends/\(id)", body: input) }
    func deleteFriend(_ id: String) async throws { try await delete("friends/\(id)") }
    func addFriendEntry(friendId: String, _ input: FriendEntryInput) async throws -> Friend { try await post("friends/\(friendId)/entries", body: input) }
    func deleteFriendEntry(_ id: String) async throws { try await delete("friend-entries/\(id)") }

    // MARK: Analytics
    func debrief() async throws -> DebriefResponse { try await get("analytics/debrief") }

    // MARK: Assistant
    func chat(_ messages: [ChatMessagePayload]) async throws -> ChatResponse { try await post("assistant/chat", body: ChatRequest(messages: messages)) }
    func confirmDraft(_ draft: AssistantDraft) async throws -> Transaction { try await post("assistant/confirm", body: ConfirmDraftRequest(draft: draft.forConfirm)) }
    func transcribe(audio: Data, filename: String = "voice.m4a", mimeType: String = "audio/mp4") async throws -> TranscriptionResponse {
        try await upload("assistant/transcribe", field: "audio", filename: filename, mimeType: mimeType, data: audio)
    }

    // MARK: Receipts
    func scanReceipt(jpegBase64: String) async throws -> ReceiptScan {
        try await post("scan-receipt", body: ScanReceiptRequest(image: jpegBase64, mimeType: "image/jpeg"))
    }
}
