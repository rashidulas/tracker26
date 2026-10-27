import SwiftUI

// Small form / list helpers shared by the Expenses, Income, Friends and Chat features.
// Prefixed `Ledger…` to avoid clashing with symbols from other feature folders.

enum LedgerTags {
    /// `"business, deductible"` → `["business", "deductible"]`.
    static func parse(_ text: String) -> [String] {
        text.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    static func join(_ tags: [String]) -> String { tags.joined(separator: ", ") }
}

enum LedgerAmount {
    /// Parses a typed amount and rounds to cents; nil when empty / invalid.
    static func parse(_ text: String) -> Double? {
        guard let v = Double(amountString: text), v.isFinite else { return nil }
        return (v * 100).rounded() / 100
    }

    static func cents(_ value: Double) -> Int { Int((value * 100).rounded()) }

    /// Value for pre-filling an amount field (`12.5` → `"12.50"`).
    static func text(_ value: Double) -> String { String(format: "%.2f", value) }
}

enum LedgerMonths {
    static var current: String { Format.monthKey(Format.todayUTC()) }

    /// The current month and the previous `count - 1` months, newest first.
    static func recent(_ count: Int = 12) -> [String] {
        let start = Format.todayUTC()
        return (0 ..< count).compactMap { offset in
            Format.utcCalendar.date(byAdding: .month, value: -offset, to: start).map(Format.monthKey)
        }
    }

    /// `"2026-10"` → `"Oct 2026"`.
    static func shortTitle(_ key: String) -> String {
        guard let d = Format.monthFromKey(key) else { return key }
        return shortFormatter.string(from: d)
    }

    private static let shortFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Format.utcCalendar
        f.locale = Locale(identifier: "en_US")
        f.timeZone = Format.utc
        f.dateFormat = "MMM yyyy"
        return f
    }()
}

/// Toolbar month menu: a list of months plus "All months" (`nil`).
struct LedgerMonthMenu: View {
    @Binding var selection: String?
    let months: [String]

    var body: some View {
        Menu {
            Picker("Month", selection: $selection) {
                Text("All months").tag(String?.none)
                ForEach(months, id: \.self) { key in
                    Text(Format.monthTitle(key)).tag(Optional(key))
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "calendar")
                Text(selection.map(LedgerMonths.shortTitle) ?? "All months")
                    .font(.system(size: 15, weight: .medium))
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold))
            }
            .foregroundStyle(Theme.mint)
        }
    }
}

/// Date field bound to a `"YYYY-MM-DD"` string, shown in UTC so the calendar day never shifts.
struct LedgerDayPicker: View {
    @Binding var day: String
    var label: String = "Date"

    private var date: Binding<Date> {
        Binding(
            get: { Format.day(day) ?? Format.todayUTC() },
            set: { day = Format.dayString($0) }
        )
    }

    var body: some View {
        HStack {
            Text(label).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.inkSecondary)
            Spacer()
            DatePicker(label, selection: date, displayedComponents: .date)
                .labelsHidden()
                .environment(\.timeZone, Format.utc)
                .tint(Theme.mint)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
    }
}

/// Field-styled menu for choosing an account.
struct LedgerAccountMenu: View {
    @Binding var selection: String?
    let accounts: [Account]
    var placeholder: String = "Select account…"
    /// When set, shows a `nil` option with this label (e.g. "No account").
    var noneLabel: String? = nil
    /// Show credit cards & loans in their own section first (debt payments).
    var liabilitiesFirst: Bool = false
    /// Account ids that can't be chosen (e.g. the other side of a payment).
    var excluded: Set<String> = []

    private var selected: Account? { accounts.first { $0.id == selection } }

    private var available: [Account] { accounts.filter { !excluded.contains($0.id) || $0.id == selection } }

    var body: some View {
        Menu {
            Picker("Account", selection: $selection) {
                if let noneLabel { Text(noneLabel).tag(String?.none) }
                if liabilitiesFirst {
                    let debts = available.filter { $0.type.isLiability }
                    let others = available.filter { !$0.type.isLiability }
                    if !debts.isEmpty {
                        Section("Cards & loans") { rows(debts) }
                    }
                    if !others.isEmpty {
                        Section("Other accounts") { rows(others) }
                    }
                } else {
                    rows(available)
                }
            }
        } label: {
            HStack(spacing: 10) {
                if let selected {
                    Image(systemName: selected.type.symbol).foregroundStyle(Theme.mint).frame(width: 20)
                    Text(selected.name).foregroundStyle(Theme.ink)
                } else {
                    Text(selection == nil && noneLabel != nil ? noneLabel! : placeholder).foregroundStyle(Theme.inkMuted)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.inkMuted)
            }
            .font(.system(size: 15))
            .lineLimit(1)
            .fieldStyle()
            .contentShape(Rectangle())
        }
    }

    @ViewBuilder
    private func rows(_ list: [Account]) -> some View {
        ForEach(list) { account in
            Label(account.name, systemImage: account.type.symbol).tag(Optional(account.id))
        }
    }
}

/// Multiline text input in the app field style.
struct LedgerTextArea: View {
    let placeholder: String
    @Binding var text: String

    var body: some View {
        TextField(placeholder, text: $text, axis: .vertical)
            .lineLimit(2 ... 5)
            .fieldStyle()
    }
}

/// Single-line text input in the app field style.
struct LedgerTextField: View {
    let placeholder: String
    @Binding var text: String
    var capitalization: TextInputAutocapitalization = .sentences

    var body: some View {
        TextField(placeholder, text: $text)
            .textInputAutocapitalization(capitalization)
            .fieldStyle()
    }
}

/// "high" / "medium" / "low" confidence badge (mint / warning / danger).
struct LedgerConfidenceBadge: View {
    let confidence: Confidence

    private var color: Color {
        switch confidence {
        case .high: Theme.mint
        case .medium: Theme.warning
        case .low: Theme.danger
        }
    }

    var body: some View {
        Pill(text: "\(confidence.rawValue.capitalized) confidence", color: color)
    }
}

/// "From −$x → To +$x" preview for payments / transfers.
struct LedgerMovePreview: View {
    let fromName: String
    let toName: String
    let amount: Double

    var body: some View {
        HStack(spacing: 12) {
            VStack(spacing: 4) {
                Text(fromName).font(.system(size: 12)).foregroundStyle(Theme.inkMuted).lineLimit(1)
                Text("−" + Format.money(amount)).font(.money(15)).foregroundStyle(Theme.danger)
            }
            .frame(maxWidth: .infinity)
            Image(systemName: "arrow.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.inkMuted)
            VStack(spacing: 4) {
                Text(toName).font(.system(size: 12)).foregroundStyle(Theme.inkMuted).lineLimit(1)
                Text("+" + Format.money(amount)).font(.money(15)).foregroundStyle(Theme.mint)
            }
            .frame(maxWidth: .infinity)
        }
        .padding(12)
        .background(Theme.surface.opacity(0.8), in: RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous).strokeBorder(Theme.borderSubtle, lineWidth: 1))
    }
}

/// Groups transactions (already date-desc) into day sections.
struct LedgerDayGroup: Identifiable {
    let day: String
    let items: [Transaction]
    var id: String { day }
    var total: Double { items.reduce(0) { $0 + $1.amount } }

    static func make(_ transactions: [Transaction]) -> [LedgerDayGroup] {
        var order: [String] = []
        var map: [String: [Transaction]] = [:]
        for t in transactions {
            let key = String(t.date.prefix(10))
            if map[key] == nil { order.append(key) }
            map[key, default: []].append(t)
        }
        return order.map { LedgerDayGroup(day: $0, items: map[$0] ?? []) }
    }

    /// "Today", "Yesterday" or "Mon, Oct 5".
    var title: String {
        let today = Format.todayString()
        if day == today { return "Today" }
        if let t = Format.day(today),
           let y = Format.utcCalendar.date(byAdding: .day, value: -1, to: t),
           Format.dayString(y) == day { return "Yesterday" }
        guard let d = Format.day(day) else { return day }
        return Self.titleFormatter.string(from: d)
    }

    private static let titleFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Format.utcCalendar
        f.locale = Locale(identifier: "en_US")
        f.timeZone = Format.utc
        f.dateFormat = "EEE, MMM d, yyyy"
        return f
    }()
}
