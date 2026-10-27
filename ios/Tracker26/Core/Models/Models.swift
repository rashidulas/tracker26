import Foundation
import SwiftUI

// Codable DTOs matching ios/API.md. Dates for transactions are "YYYY-MM-DD" strings.

enum AccountType: String, Codable, CaseIterable, Identifiable, Hashable {
    case CHECKING, SAVINGS, CREDIT_CARD, CASH, INVESTMENT, LOAN
    var id: String { rawValue }

    var label: String {
        switch self {
        case .CHECKING: "Checking"
        case .SAVINGS: "Savings"
        case .CREDIT_CARD: "Credit Card"
        case .CASH: "Cash"
        case .INVESTMENT: "Investment"
        case .LOAN: "Loan"
        }
    }

    /// SF Symbol equivalent of the web's lucide icon per type.
    var symbol: String {
        switch self {
        case .CHECKING: "building.columns"
        case .SAVINGS: "banknote"
        case .CREDIT_CARD: "creditcard"
        case .CASH: "dollarsign.circle"
        case .INVESTMENT: "chart.line.uptrend.xyaxis"
        case .LOAN: "hand.raised"
        }
    }

    var isLiability: Bool { self == .CREDIT_CARD || self == .LOAN }
}

enum CategoryType: String, Codable, CaseIterable, Identifiable, Hashable {
    case INCOME, EXPENSE
    var id: String { rawValue }
    var label: String { self == .INCOME ? "Income" : "Expense" }
}

enum TransactionKind: String, Codable, Hashable {
    case INCOME, EXPENSE, TRANSFER
}

enum FriendEntryType: String, Codable, CaseIterable, Identifiable, Hashable {
    case THEY_OWE_ME, I_OWE_THEM, THEY_PAID_ME, I_PAID_THEM
    var id: String { rawValue }

    var label: String {
        switch self {
        case .THEY_OWE_ME: "They owe me"
        case .I_OWE_THEM: "I owe them"
        case .THEY_PAID_ME: "They paid me"
        case .I_PAID_THEM: "I paid them"
        }
    }

    var hint: String {
        switch self {
        case .THEY_OWE_ME: "You covered a shared expense"
        case .I_OWE_THEM: "They covered a shared expense"
        case .THEY_PAID_ME: "Settlement received"
        case .I_PAID_THEM: "Settlement sent"
        }
    }

    /// +1 when it increases what they owe you (matches lib/friends.ts signedFriendAmount).
    var sign: Double {
        switch self {
        case .THEY_OWE_ME, .I_PAID_THEM: 1
        case .I_OWE_THEM, .THEY_PAID_ME: -1
        }
    }
}

enum Confidence: String, Codable, Hashable {
    case high, medium, low
}

// MARK: - Accounts

struct Account: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var type: AccountType
    var institution: String?
    var startingBalance: Double
    var creditLimit: Double?
    var currentBalance: Double
    var transactionCount: Int
}

struct AccountInput: Encodable {
    var name: String
    var type: AccountType
    var institution: String?
    var startingBalance: Double
    var creditLimit: Double?
}

struct AccountRef: Codable, Hashable {
    let id: String
    let name: String
    let type: AccountType
}

// MARK: - Categories

struct Subcategory: Codable, Identifiable, Hashable {
    let id: String
    let name: String
}

struct Category: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var type: CategoryType
    var color: String
    var icon: String?
    var subcategories: [Subcategory]
    var transactionCount: Int

    var swiftColor: Color { Color(hex: color) }
    var emoji: String { icon?.nilIfBlank ?? "📁" }
}

struct CategoryInput: Encodable {
    var name: String
    var type: CategoryType
    var color: String
    var icon: String?
    var subcategories: [String]
}

struct CategoryRef: Codable, Hashable {
    let id: String
    let name: String
    let type: CategoryType
    let color: String
    let icon: String?

    var swiftColor: Color { Color(hex: color) }
    var emoji: String { icon?.nilIfBlank ?? "📁" }
}

// MARK: - Transactions

struct AccountSplit: Codable, Hashable {
    var accountId: String
    var amount: Double
}

struct Transaction: Codable, Identifiable, Hashable {
    let id: String
    let date: String
    let amount: Double
    let kind: TransactionKind
    let categoryId: String?
    let subcategoryId: String?
    let accountId: String?
    let toAccountId: String?
    let merchantOrSource: String?
    let notes: String?
    let tags: [String]
    let accountSplits: [AccountSplit]
    let category: CategoryRef?
    let subcategory: Subcategory?
    let account: AccountRef?
    let toAccount: AccountRef?

    var isPayment: Bool { kind == .TRANSFER && tags.contains("payment") }
    var isDebtPayment: Bool { kind == .TRANSFER && tags.contains("debt-payment") }

    /// Title shown in lists: merchant → category → fallback.
    var title: String {
        merchantOrSource?.nilIfBlank ?? category?.name ?? (kind == .TRANSFER ? "Transfer" : "Untitled")
    }
}

struct ExpenseInput: Encodable {
    var date: String
    var amount: Double
    var categoryId: String
    var subcategoryId: String?
    var accountId: String?
    var merchantOrSource: String?
    var notes: String?
    var tags: [String]
}

struct IncomeInput: Encodable {
    var date: String
    var amount: Double
    var categoryId: String
    var subcategoryId: String?
    var accountSplits: [AccountSplit]
    var merchantOrSource: String?
    var notes: String?
    var tags: [String]
}

struct TransferInput: Encodable {
    var date: String
    var amount: Double
    var fromAccountId: String
    var toAccountId: String
    var notes: String?
}

enum PaymentMode: String, Codable {
    case PAYMENT, DEBT_PAYMENT
}

struct PaymentInput: Encodable {
    var mode: PaymentMode
    var amount: Double
    var date: String
    var fromAccountId: String
    var toAccountId: String
    var notes: String?
}

// MARK: - Dashboard

struct Dashboard: Codable, Hashable {
    struct Liability: Codable, Identifiable, Hashable {
        let id: String
        let name: String
        let institution: String?
        let currentBalance: Double
        let balanceAtMonthStart: Double
        let creditLimit: Double?
    }

    struct FriendSummary: Codable, Identifiable, Hashable {
        let id: String
        let name: String
        let color: String
        let balance: Double
        let entryCount: Int
    }

    struct CategorySlice: Codable, Hashable, Identifiable {
        let categoryId: String
        let name: String
        let value: Double
        let color: String
        let icon: String?
        var id: String { categoryId }
    }

    struct MonthPoint: Codable, Hashable, Identifiable {
        let month: String
        let label: String
        let income: Double
        let expenses: Double
        var id: String { month }
    }

    struct DayPoint: Codable, Hashable, Identifiable {
        let date: String
        let amount: Double
        var id: String { date }
    }

    let totalBalance: Double
    let cashBalance: Double
    let monthIncome: Double
    let monthExpenses: Double
    let lastMonthIncome: Double
    let lastMonthExpenses: Double
    let creditCards: [Liability]
    let loans: [Liability]
    let friends: [FriendSummary]
    let friendsOwedToYou: Double
    let friendsYouOwe: Double
    let categoryData: [CategorySlice]
    let monthlyTrend: [MonthPoint]
    let dailySpending: [DayPoint]
    let recentTransactions: [Transaction]
}

// MARK: - Friends

struct FriendEntry: Codable, Identifiable, Hashable {
    let id: String
    let friendId: String
    let date: String
    let amount: Double
    let type: FriendEntryType
    let description: String?
    let notes: String?

    var signedAmount: Double { amount * type.sign }
}

struct Friend: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var notes: String?
    var color: String
    var balance: Double
    var entries: [FriendEntry]

    var swiftColor: Color { Color(hex: color) }
    var isSettled: Bool { abs(balance) < 0.005 }
    var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        let s = parts.compactMap { $0.first.map(String.init) }.joined()
        return s.isEmpty ? "?" : s.uppercased()
    }
}

struct FriendInput: Encodable {
    var name: String
    var notes: String?
    var color: String?
    var openingAmount: Double?
    var openingType: FriendEntryType?
}

struct FriendEntryInput: Encodable {
    var date: String
    var amount: Double
    var type: FriendEntryType
    var description: String?
    var notes: String?
}

// MARK: - Analytics

struct DebriefResponse: Codable, Hashable {
    struct Debrief: Codable, Hashable {
        let headline: String
        let summary: String
        let mood: String
        let todayNote: String
        let monthNote: String
        let highlights: [String]
        let watchouts: [String]
        let actions: [String]
    }

    struct Stats: Codable, Hashable {
        let totalBalance: Double
        let cashBalance: Double
        let creditCardDebt: Double
        let loanDebt: Double
        let friendsOwedToYou: Double
        let friendsYouOwe: Double
        let friendsNet: Double
        let todayIncome: Double
        let todayExpenses: Double
        let weekExpenses: Double
        let last30DaysIncome: Double
        let last30DaysExpenses: Double
        let monthIncome: Double
        let monthExpenses: Double
        let monthNet: Double
    }

    struct TopCategory: Codable, Hashable, Identifiable {
        let name: String
        let amount: Double
        var id: String { name }
    }

    let debrief: Debrief
    let stats: Stats
    let generatedAt: String
    let topExpenseCategories: [TopCategory]
}

// MARK: - Assistant

struct ChatImage: Codable, Hashable {
    let dataUrl: String
    let mimeType: String
}

struct ChatMessagePayload: Codable, Hashable {
    let role: String // "user" | "assistant"
    let content: String
    let image: ChatImage?
}

struct ChatRequest: Encodable {
    let messages: [ChatMessagePayload]
}

struct AssistantDraft: Codable, Hashable {
    var kind: TransactionKind // EXPENSE | INCOME
    var amount: Double
    var date: String
    var categoryId: String
    var accountId: String?
    var merchantOrSource: String?
    var notes: String?
    var tags: [String]
    var confidence: Confidence
    var categoryName: String?
    var accountName: String?

    /// Draft payload for `/assistant/confirm` (drops display-only names).
    var forConfirm: AssistantDraft {
        var d = self
        d.categoryName = nil
        d.accountName = nil
        return d
    }
}

struct ChatResponse: Codable, Hashable {
    let message: String
    let draft: AssistantDraft?
}

struct ConfirmDraftRequest: Encodable {
    let draft: AssistantDraft
}

struct TranscriptionResponse: Codable, Hashable {
    let text: String
}

// MARK: - Receipt scan

struct ScanReceiptRequest: Encodable {
    let image: String
    let mimeType: String
}

struct ReceiptScan: Codable, Hashable {
    struct Item: Codable, Hashable {
        let name: String
        let amount: Double
        let suggestedCategory: String?
    }

    let merchant: String?
    let date: String?
    let totalAmount: Double?
    let category: String?
    let items: [Item]
    let notes: String?
    let tags: [String]
    let confidence: Confidence
}

// MARK: - Misc

struct HealthResponse: Codable, Hashable {
    let status: String
    let categories: Int
    let accounts: Int
    let serverTime: String
}

struct DeletedResponse: Codable, Hashable {
    let id: String
}
