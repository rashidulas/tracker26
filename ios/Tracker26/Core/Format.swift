import Foundation

/// Money + date formatting. Mirrors `lib/utils.ts`: USD only, transaction dates are UTC calendar days.
enum Format {
    private static let currency2: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "USD"
        f.locale = Locale(identifier: "en_US")
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return f
    }()

    private static let currency0: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "USD"
        f.locale = Locale(identifier: "en_US")
        f.minimumFractionDigits = 0
        f.maximumFractionDigits = 0
        return f
    }()

    /// `$1,234.56` (negative → `-$1,234.56`).
    static func money(_ value: Double, cents: Bool = true) -> String {
        let f = cents ? currency2 : currency0
        return f.string(from: NSNumber(value: value)) ?? "$0.00"
    }

    /// `+$12.00` / `−$12.00` (true minus sign, like the web's Friends / Payment previews).
    static func signedMoney(_ value: Double, cents: Bool = true) -> String {
        let body = money(abs(value), cents: cents)
        if abs(value) < 0.005 { return body }
        return value > 0 ? "+\(body)" : "−\(body)"
    }

    static func percent(_ value: Double, digits: Int = 1) -> String {
        String(format: "%.\(digits)f%%", value)
    }

    // MARK: - Dates (UTC calendar days)

    static let utc = TimeZone(identifier: "UTC")!

    static var utcCalendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = utc
        return c
    }()

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = utcCalendar
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = utc
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private static let monthKeyFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = utcCalendar
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = utc
        f.dateFormat = "yyyy-MM"
        return f
    }()

    private static func displayFormatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.calendar = utcCalendar
        f.locale = Locale(identifier: "en_US")
        f.timeZone = utc
        f.dateFormat = format
        return f
    }

    private static let shortDisplay = displayFormatter("MMM dd, yyyy")
    private static let monthDisplay = displayFormatter("MMMM yyyy")
    private static let dayMonthDisplay = displayFormatter("MMM d")

    /// `"2026-10-27"` → Date at UTC midnight.
    static func day(_ string: String) -> Date? { dayFormatter.date(from: String(string.prefix(10))) }

    /// Date → `"2026-10-27"` using the UTC calendar day of `date`.
    static func dayString(_ date: Date) -> String { dayFormatter.string(from: date) }

    /// The user's *local* today expressed as a UTC-midnight `Date`, so pickers default to the right day.
    static func todayUTC() -> Date {
        let local = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        return utcCalendar.date(from: local) ?? Date()
    }

    /// Local today as `"YYYY-MM-DD"`.
    static func todayString() -> String { dayString(todayUTC()) }

    /// `"2026-10"` for the month containing `date` (UTC).
    static func monthKey(_ date: Date) -> String { monthKeyFormatter.string(from: date) }
    static func monthFromKey(_ key: String) -> Date? { monthKeyFormatter.date(from: key) }

    /// `"Oct 05, 2026"` from `"2026-10-05"`.
    static func shortDate(_ day: String) -> String {
        guard let d = self.day(day) else { return day }
        return shortDisplay.string(from: d)
    }

    /// `"Oct 5"` from `"2026-10-05"`.
    static func dayMonth(_ day: String) -> String {
        guard let d = self.day(day) else { return day }
        return dayMonthDisplay.string(from: d)
    }

    /// `"October 2026"` from `"2026-10"`.
    static func monthTitle(_ key: String) -> String {
        guard let d = monthFromKey(key) else { return key }
        return monthDisplay.string(from: d)
    }
}

extension String {
    /// Trimmed string, or nil when empty — matches how the server treats empty optionals.
    var nilIfBlank: String? {
        let t = trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
}

extension Double {
    /// Parses user-typed amounts like "1,234.50" or "$12".
    init?(amountString: String) {
        let cleaned = amountString.replacingOccurrences(of: ",", with: "").replacingOccurrences(of: "$", with: "").trimmingCharacters(in: .whitespaces)
        guard let v = Double(cleaned) else { return nil }
        self = v
    }
}
