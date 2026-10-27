import Charts
import SwiftUI

// MARK: - Spending over time

struct DashSpendingChart: View {
    let points: [Dashboard.DayPoint]
    @State private var selectedDate: Date?

    private struct Point: Identifiable {
        let id: String
        let date: Date
        let amount: Double
    }

    private var series: [Point] {
        points.compactMap { p in Format.day(p.date).map { Point(id: p.date, date: $0, amount: p.amount) } }
    }

    private var total: Double { points.reduce(0) { $0 + $1.amount } }

    /// Explicit ticks taken from the data (UTC days) so labels never drift with the local time zone.
    private var tickDates: [Date] {
        let s = series
        return stride(from: 0, to: s.count, by: 7).map { s[$0].date }
    }

    private var selectedPoint: Point? {
        guard let selectedDate else { return nil }
        return series.min { abs($0.date.timeIntervalSince(selectedDate)) < abs($1.date.timeIntervalSince(selectedDate)) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            DashSectionHeader(title: "Spending over time", subtitle: "Daily expenses this month") {
                VStack(alignment: .trailing, spacing: 2) {
                    MoneyText(value: total, size: 16, cents: false)
                    Text("month to date").font(.system(size: 10)).foregroundStyle(Theme.inkMuted)
                }
            }

            if series.isEmpty || total <= 0 {
                Text("No spending data this month")
                    .font(.footnote)
                    .foregroundStyle(Theme.inkMuted)
                    .frame(maxWidth: .infinity, minHeight: 140)
            } else {
                chart.frame(height: 190)
            }
        }
        .panel(padding: 18)
    }

    private var chart: some View {
        let data = series
        return Chart {
            ForEach(data) { p in
                AreaMark(x: .value("Day", p.date), y: .value("Spent", p.amount))
                    .interpolationMethod(.monotone)
                    .foregroundStyle(
                        LinearGradient(colors: [Theme.mint.opacity(0.35), Theme.mint.opacity(0.02)], startPoint: .top, endPoint: .bottom)
                    )
                LineMark(x: .value("Day", p.date), y: .value("Spent", p.amount))
                    .interpolationMethod(.monotone)
                    .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                    .foregroundStyle(Theme.mint)
            }

            if data.count < 3 {
                ForEach(data) { p in
                    PointMark(x: .value("Day", p.date), y: .value("Spent", p.amount))
                        .foregroundStyle(Theme.mint)
                }
            }

            if let sel = selectedPoint {
                RuleMark(x: .value("Day", sel.date))
                    .foregroundStyle(Theme.inkMuted.opacity(0.6))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(Format.dayMonth(sel.id)).font(.system(size: 10)).foregroundStyle(Theme.inkMuted)
                            Text(Format.money(sel.amount)).font(.money(12)).foregroundStyle(Theme.mint)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
                    }
                PointMark(x: .value("Day", sel.date), y: .value("Spent", sel.amount))
                    .symbolSize(50)
                    .foregroundStyle(Theme.mint)
            }
        }
        .chartXSelection(value: $selectedDate)
        .chartXAxis {
            AxisMarks(values: tickDates) { value in
                AxisGridLine().foregroundStyle(Theme.borderSubtle)
                AxisValueLabel {
                    if let d = value.as(Date.self) {
                        Text(Format.dayMonth(Format.dayString(d))).font(.system(size: 10)).foregroundStyle(Theme.inkMuted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                AxisGridLine().foregroundStyle(Theme.borderSubtle)
                AxisValueLabel {
                    if let v = value.as(Double.self) {
                        Text(DashFormat.compactMoney(v)).font(.system(size: 10)).foregroundStyle(Theme.inkMuted)
                    }
                }
            }
        }
    }
}

// MARK: - Where it went (category donut)

struct DashCategoryDonut: View {
    let slices: [Dashboard.CategorySlice]

    private var positive: [Dashboard.CategorySlice] { slices.filter { $0.value > 0 } }
    private var total: Double { positive.reduce(0) { $0 + $1.value } }
    private let listLimit = 6

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            DashSectionHeader(title: "Where it went", subtitle: "This month by category")

            if positive.isEmpty || total <= 0 {
                Text("No expenses this month")
                    .font(.footnote)
                    .foregroundStyle(Theme.inkMuted)
                    .frame(maxWidth: .infinity, minHeight: 100)
            } else {
                ZStack {
                    Chart(positive) { slice in
                        SectorMark(
                            angle: .value("Amount", slice.value),
                            innerRadius: .ratio(0.64),
                            angularInset: 1.5
                        )
                        .cornerRadius(3)
                        .foregroundStyle(Color(hex: slice.color))
                    }
                    .chartLegend(.hidden)

                    VStack(spacing: 2) {
                        SectionLabel("Spent")
                        MoneyText(value: total, size: 19, cents: false)
                        Text("\(positive.count) categor\(positive.count == 1 ? "y" : "ies")")
                            .font(.system(size: 10))
                            .foregroundStyle(Theme.inkMuted)
                    }
                    .frame(maxWidth: 110)
                }
                .frame(height: 200)
                .frame(maxWidth: .infinity)

                VStack(spacing: 10) {
                    ForEach(positive.prefix(listLimit)) { slice in
                        row(slice)
                    }
                    if positive.count > listLimit {
                        Text("+ \(positive.count - listLimit) more")
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.inkMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .panel(padding: 18)
    }

    private func row(_ slice: Dashboard.CategorySlice) -> some View {
        let color = Color(hex: slice.color)
        let share = total > 0 ? slice.value / total : 0
        return HStack(spacing: 12) {
            EmojiTile(emoji: slice.icon?.nilIfBlank ?? "📁", color: color, size: 34)
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(slice.name)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    MoneyText(value: slice.value, size: 14)
                }
                HStack(spacing: 8) {
                    ProgressBar(value: share, tint: color, height: 4)
                    Text(Format.percent(share * 100, digits: 0))
                        .font(.money(10, weight: .regular))
                        .foregroundStyle(Theme.inkMuted)
                        .frame(width: 34, alignment: .trailing)
                }
            }
        }
    }
}

// MARK: - Income vs expenses (12 months)

struct DashTrendChart: View {
    let trend: [Dashboard.MonthPoint]

    private var hasData: Bool { trend.contains { $0.income > 0 || $0.expenses > 0 } }

    private var labels: [String: String] {
        Dictionary(trend.map { ($0.month, $0.label) }, uniquingKeysWith: { a, _ in a })
    }

    /// Every other month so 12 labels fit on a phone.
    private var tickMonths: [String] {
        let keys = trend.map(\.month)
        let step = keys.count > 6 ? 2 : 1
        // Anchor on the latest month so the current month always has a label.
        return keys.enumerated().filter { (keys.count - 1 - $0.offset) % step == 0 }.map(\.element)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            DashSectionHeader(title: "Income vs expenses", subtitle: "Last 12 months") {
                HStack(spacing: 10) {
                    legend("Income", Theme.mint)
                    legend("Expenses", Theme.danger)
                }
            }

            if !hasData {
                Text("No income or expenses yet")
                    .font(.footnote)
                    .foregroundStyle(Theme.inkMuted)
                    .frame(maxWidth: .infinity, minHeight: 140)
            } else {
                chart.frame(height: 200)
            }
        }
        .panel(padding: 18)
    }

    private func legend(_ text: String, _ color: Color) -> some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(text).font(.system(size: 11)).foregroundStyle(Theme.inkSecondary)
        }
    }

    private var chart: some View {
        let labels = labels
        return Chart {
            ForEach(trend) { p in
                AreaMark(
                    x: .value("Month", p.month),
                    y: .value("Amount", p.income),
                    series: .value("Series", "Income"),
                    stacking: .unstacked
                )
                .interpolationMethod(.monotone)
                .foregroundStyle(LinearGradient(colors: [Theme.mint.opacity(0.22), Theme.mint.opacity(0)], startPoint: .top, endPoint: .bottom))

                LineMark(
                    x: .value("Month", p.month),
                    y: .value("Amount", p.income),
                    series: .value("Series", "Income")
                )
                .interpolationMethod(.monotone)
                .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                .foregroundStyle(Theme.mint)
            }
            ForEach(trend) { p in
                AreaMark(
                    x: .value("Month", p.month),
                    y: .value("Amount", p.expenses),
                    series: .value("Series", "Expenses"),
                    stacking: .unstacked
                )
                .interpolationMethod(.monotone)
                .foregroundStyle(LinearGradient(colors: [Theme.danger.opacity(0.18), Theme.danger.opacity(0)], startPoint: .top, endPoint: .bottom))

                LineMark(
                    x: .value("Month", p.month),
                    y: .value("Amount", p.expenses),
                    series: .value("Series", "Expenses")
                )
                .interpolationMethod(.monotone)
                .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                .foregroundStyle(Theme.danger)
            }
        }
        .chartLegend(.hidden)
        .chartXAxis {
            AxisMarks(values: tickMonths) { value in
                AxisValueLabel {
                    if let key = value.as(String.self) {
                        Text(labels[key] ?? key).font(.system(size: 10)).foregroundStyle(Theme.inkMuted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                AxisGridLine().foregroundStyle(Theme.borderSubtle)
                AxisValueLabel {
                    if let v = value.as(Double.self) {
                        Text(DashFormat.compactMoney(v)).font(.system(size: 10)).foregroundStyle(Theme.inkMuted)
                    }
                }
            }
        }
    }
}
