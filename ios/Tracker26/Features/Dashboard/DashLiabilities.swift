import SwiftUI

// MARK: - Credit cards

struct DashCreditCardsCard: View {
    let cards: [Dashboard.Liability]

    private var totalDebt: Double { cards.reduce(0) { $0 + DashFormat.debt($1.currentBalance) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 12) {
                IconTile(symbol: "creditcard", tint: Theme.danger, size: 32)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Credit Card Debt").font(.display(17)).foregroundStyle(Theme.ink)
                    Text("Outstanding balances").font(.system(size: 12)).foregroundStyle(Theme.inkMuted)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    MoneyText(value: totalDebt, size: 22, color: Theme.danger, cents: false)
                    Text("\(cards.count) card\(cards.count == 1 ? "" : "s")")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.inkMuted)
                }
            }

            ForEach(Array(cards.enumerated()), id: \.element.id) { index, card in
                if index > 0 { DashDivider() }
                DashCreditCardRow(card: card)
            }
        }
        .panel(padding: 18)
    }
}

private struct DashCreditCardRow: View {
    let card: Dashboard.Liability

    private var debt: Double { DashFormat.debt(card.currentBalance) }
    private var startDebt: Double { DashFormat.debt(card.balanceAtMonthStart) }
    private var delta: Double { debt - startDebt }

    private var limit: Double? {
        guard let l = card.creditLimit, l > 0 else { return nil }
        return l
    }

    /// 0…∞ fraction of the limit in use (nil without a limit).
    private var usage: Double? { limit.map { debt / $0 } }
    private var startUsage: Double? { limit.map { startDebt / $0 } }

    private var barColor: Color {
        guard let usage else { return Theme.warning }
        if usage > 0.8 { return Theme.danger }
        if usage > 0.5 { return Theme.orange }
        return Theme.warning
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(card.name)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    if let institution = card.institution?.nilIfBlank {
                        Text(institution)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.inkMuted)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    MoneyText(value: debt, size: 14, color: debt > 0.005 ? Theme.danger : Theme.inkSecondary)
                    Text(limit.map { "of \(Format.money($0, cents: false))" } ?? "No limit set")
                        .font(.system(size: 10))
                        .foregroundStyle(Theme.inkMuted)
                }
            }

            if let usage {
                DashUsageBar(
                    value: usage,
                    marker: (startUsage ?? 0) > 0 ? startUsage : nil,
                    color: barColor,
                    markerLabel: DashFormat.monthStartLabel
                )
            }

            footer
        }
    }

    @ViewBuilder
    private var footer: some View {
        let hasDelta = abs(delta) >= 0.005
        if usage != nil || hasDelta {
            HStack(spacing: 6) {
                if let usage {
                    Text("\(Format.percent(usage * 100)) used")
                        .foregroundStyle(Theme.inkMuted)
                }
                Spacer(minLength: 4)
                if hasDelta {
                    Text("\(delta > 0 ? "↑" : "↓") \(Format.money(abs(delta))) this month")
                        .fontWeight(.medium)
                        .foregroundStyle(delta > 0 ? Theme.danger : Theme.mint)
                }
                if let limit {
                    Spacer(minLength: 4)
                    Text("\(Format.money(max(limit - debt, 0), cents: false)) avail.")
                        .foregroundStyle(Theme.inkMuted)
                }
            }
            .font(.money(10, weight: .regular))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        }
    }
}

/// Usage bar with a gradient fill and a white tick (plus "Oct 1" caption) at the month-start usage.
private struct DashUsageBar: View {
    let value: Double
    let marker: Double?
    let color: Color
    let markerLabel: String

    private let barHeight: CGFloat = 10
    private let labelHeight: CGFloat = 13

    private func clamp(_ v: Double) -> CGFloat { CGFloat(max(0, min(1, v))) }

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            ZStack(alignment: .topLeading) {
                Capsule()
                    .fill(Theme.surface2)
                    .frame(width: width, height: barHeight)
                    .offset(y: labelHeight)

                Capsule()
                    .fill(LinearGradient(colors: [color.opacity(0.55), color], startPoint: .leading, endPoint: .trailing))
                    .frame(width: value > 0 ? max(clamp(value) * width, barHeight) : 0, height: barHeight)
                    .offset(y: labelHeight)

                if let marker {
                    let x = clamp(marker) * width
                    Text(markerLabel)
                        .font(.system(size: 9))
                        .foregroundStyle(Theme.inkMuted)
                        .fixedSize()
                        .position(x: min(max(x, 14), max(width - 14, 14)), y: labelHeight / 2 - 1)
                    RoundedRectangle(cornerRadius: 1)
                        .fill(Color.white.opacity(0.85))
                        .frame(width: 2, height: barHeight + 6)
                        .position(x: x, y: labelHeight + barHeight / 2)
                }
            }
        }
        .frame(height: labelHeight + barHeight)
        .accessibilityElement()
        .accessibilityLabel("\(Int((value * 100).rounded())) percent of limit used")
    }
}

// MARK: - Loans

struct DashLoansCard: View {
    let loans: [Dashboard.Liability]

    private var totalDebt: Double { loans.reduce(0) { $0 + DashFormat.debt($1.currentBalance) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                IconTile(symbol: "hand.raised", tint: Theme.warning, size: 32)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Loans").font(.display(17)).foregroundStyle(Theme.ink)
                    Text("Outstanding loan balances").font(.system(size: 12)).foregroundStyle(Theme.inkMuted)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    MoneyText(value: totalDebt, size: 22, color: Theme.warning, cents: false)
                    Text("\(loans.count) loan\(loans.count == 1 ? "" : "s")")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.inkMuted)
                }
            }

            VStack(spacing: 8) {
                ForEach(loans) { loan in
                    DashLoanRow(loan: loan)
                }
            }
        }
        .tintedPanel(Theme.warning, padding: 18)
    }
}

private struct DashLoanRow: View {
    let loan: Dashboard.Liability

    var body: some View {
        let debt = DashFormat.debt(loan.currentBalance)
        let delta = debt - DashFormat.debt(loan.balanceAtMonthStart)
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(loan.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                if let institution = loan.institution?.nilIfBlank {
                    Text(institution)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.inkMuted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                MoneyText(value: debt, size: 14, color: Theme.warning)
                if abs(delta) >= 0.005 {
                    Text("\(delta > 0 ? "↑" : "↓") \(Format.money(abs(delta))) this month")
                        .font(.money(10, weight: .medium))
                        .foregroundStyle(delta > 0 ? Theme.danger : Theme.mint)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Theme.surface2.opacity(0.4), in: RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous).strokeBorder(Theme.borderSubtle, lineWidth: 1))
    }
}
