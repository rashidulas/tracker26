import Charts
import SwiftUI

/// Big "Total Balance" hero with net-this-month and cash sub-line.
struct DashHeroCard: View {
    let data: Dashboard

    private var net: Double { data.monthIncome - data.monthExpenses }
    private var totalDebt: Double {
        (data.creditCards + data.loans).reduce(0) { $0 + DashFormat.debt($1.currentBalance) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                IconTile(symbol: "wallet.bifold", tint: Theme.mint, size: 30)
                SectionLabel("Total Balance")
            }

            Text(Format.money(data.totalBalance, cents: false))
                .font(.money(42, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(data.totalBalance >= 0 ? Theme.ink : Theme.danger)
                .lineLimit(1)
                .minimumScaleFactor(0.5)

            HStack(spacing: 5) {
                Image(systemName: net >= 0 ? "arrow.up.right" : "arrow.down.right")
                    .font(.system(size: 12, weight: .bold))
                Text("\(Format.signedMoney(net, cents: false)) this month")
                    .font(.system(size: 13, weight: .medium))
            }
            .foregroundStyle(net >= 0 ? Theme.mint : Theme.danger)

            HStack(spacing: 6) {
                Text("Cash & accounts")
                    .foregroundStyle(Theme.inkMuted)
                Text(Format.money(data.cashBalance, cents: false))
                    .font(.money(12, weight: .medium))
                    .foregroundStyle(Theme.inkSecondary)
                if totalDebt > 0.005 {
                    Text("·").foregroundStyle(Theme.inkMuted)
                    Text("Debt")
                        .foregroundStyle(Theme.inkMuted)
                    Text(Format.money(totalDebt, cents: false))
                        .font(.money(12, weight: .medium))
                        .foregroundStyle(Theme.inkSecondary)
                }
            }
            .font(.system(size: 12))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        }
        .tintedPanel(Theme.mint, padding: 20, radius: Theme.radiusXl)
    }
}

/// Monthly income / expense card with change vs last month and a sparkline.
struct DashMetricCard: View {
    let title: String
    let symbol: String
    let value: Double
    let lastMonth: Double
    let tint: Color
    /// For expenses a decrease is good.
    let lowerIsBetter: Bool
    let spark: [Double]

    private var change: Double? {
        guard lastMonth > 0.005 else { return nil }
        return (value - lastMonth) / lastMonth * 100
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center) {
                IconTile(symbol: symbol, tint: tint, size: 28)
                Spacer(minLength: 4)
                if spark.count >= 2, (spark.max() ?? 0) > 0 {
                    DashSparkline(values: spark, color: tint)
                        .frame(width: 58, height: 26)
                }
            }

            SectionLabel(title)
                .lineLimit(1)
                .minimumScaleFactor(0.8)

            MoneyText(value: value, size: 21, cents: false)

            changeLine
        }
        .panel(padding: 14)
    }

    @ViewBuilder
    private var changeLine: some View {
        if let change {
            let good = lowerIsBetter ? change <= 0 : change >= 0
            HStack(spacing: 3) {
                Image(systemName: change >= 0 ? "arrow.up.right" : "arrow.down.right")
                    .font(.system(size: 10, weight: .bold))
                Text("\(change >= 0 ? "+" : "−")\(Format.percent(abs(change))) vs last mo.")
                    .font(.system(size: 11, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .foregroundStyle(good ? Theme.mint : Theme.danger)
        } else {
            Text(value > 0.005 ? "Nothing last month" : "No activity yet")
                .font(.system(size: 11))
                .foregroundStyle(Theme.inkMuted)
                .lineLimit(1)
        }
    }
}

/// Tiny area + line chart with no axes.
struct DashSparkline: View {
    let values: [Double]
    let color: Color

    var body: some View {
        Chart {
            ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                AreaMark(x: .value("Index", index), y: .value("Value", value))
                    .interpolationMethod(.catmullRom)
                    .foregroundStyle(
                        LinearGradient(colors: [color.opacity(0.3), color.opacity(0)], startPoint: .top, endPoint: .bottom)
                    )
                LineMark(x: .value("Index", index), y: .value("Value", value))
                    .interpolationMethod(.catmullRom)
                    .lineStyle(StrokeStyle(lineWidth: 1.6, lineCap: .round))
                    .foregroundStyle(color)
            }
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartLegend(.hidden)
        .accessibilityHidden(true)
    }
}

/// "Cash & Accounts" row (checking, savings & other).
struct DashCashRow: View {
    let cash: Double

    var body: some View {
        HStack(spacing: 12) {
            IconTile(symbol: "building.columns", tint: Theme.mint, size: 32)
            VStack(alignment: .leading, spacing: 2) {
                SectionLabel("Cash & Accounts")
                Text("Checking, savings & other")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.inkMuted)
            }
            Spacer(minLength: 8)
            MoneyText(value: cash, size: 19, color: cash >= 0 ? Theme.mint : Theme.danger, cents: false)
        }
        .panel(padding: 14)
    }
}
