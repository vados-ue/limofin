import SwiftUI
import Charts

struct TrendsView: View {
    @EnvironmentObject var state: AppState
    private let dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    if let insights = state.insights {
                        statRow(insights)

                        SectionLabel(text: "Daily burn — last 28 days")
                        Card {
                            Chart(insights.daily) { day in
                                BarMark(
                                    x: .value("Day", String(day.date.suffix(5))),
                                    y: .value("Spent", Double(day.spentCents) / 100)
                                )
                                .foregroundStyle(day.spentCents == 0 ? Color.white.opacity(0.12) : Theme.blue)
                                .cornerRadius(2)
                            }
                            .chartXAxis {
                                let labels = insights.daily.enumerated()
                                    .filter { $0.offset % 7 == 0 }
                                    .map { String($0.element.date.suffix(5)) }
                                AxisMarks(values: labels) { _ in
                                    AxisValueLabel().font(.system(size: 9)).foregroundStyle(Theme.muted)
                                }
                            }
                            .chartYAxis {
                                AxisMarks { _ in
                                    AxisGridLine().foregroundStyle(Color.white.opacity(0.06))
                                    AxisValueLabel(format: .currency(code: "USD").precision(.fractionLength(0)))
                                        .font(.system(size: 9)).foregroundStyle(Theme.muted)
                                }
                            }
                            .frame(height: 140)
                        }

                        if !insights.weeks.isEmpty {
                            SectionLabel(text: "Weeks — spent vs allocated")
                            Card {
                                Chart {
                                    ForEach(insights.weeks.suffix(6)) { week in
                                        BarMark(
                                            x: .value("Amount", Double(week.allocatedCents) / 100),
                                            y: .value("Week", String(week.weekStart.suffix(5)))
                                        )
                                        .foregroundStyle(Color.white.opacity(0.12))
                                        .cornerRadius(3)
                                        BarMark(
                                            x: .value("Spent", Double(week.spentCents) / 100),
                                            y: .value("Week", String(week.weekStart.suffix(5)))
                                        )
                                        .foregroundStyle(week.spentCents > week.allocatedCents ? Theme.red : Theme.blue)
                                        .cornerRadius(3)
                                    }
                                }
                                .chartXAxis {
                                    AxisMarks { _ in
                                        AxisGridLine().foregroundStyle(Color.white.opacity(0.06))
                                        AxisValueLabel(format: .currency(code: "USD").precision(.fractionLength(0)))
                                            .font(.system(size: 9)).foregroundStyle(Theme.muted)
                                    }
                                }
                                .chartYAxis {
                                    AxisMarks { _ in
                                        AxisValueLabel().font(.system(size: 10)).foregroundStyle(Theme.muted)
                                    }
                                }
                                .frame(height: CGFloat(max(1, min(insights.weeks.count, 6))) * 34 + 30)
                            }
                        }

                        weekdayCard(insights)

                        if !insights.topMemos.isEmpty {
                            SectionLabel(text: "Where it went (28d)")
                            Card(padding: 0) {
                                VStack(spacing: 0) {
                                    ForEach(insights.topMemos) { memo in
                                        HStack {
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(memo.label).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                                                Text("\(memo.count)×").font(.system(size: 11)).foregroundStyle(Theme.muted)
                                            }
                                            Spacer()
                                            Text(money(memo.totalCents)).font(.system(size: 14, weight: .bold))
                                        }
                                        .padding(.horizontal, 14)
                                        .padding(.vertical, 9)
                                        if memo.id != insights.topMemos.last?.id {
                                            Divider().overlay(Color.white.opacity(0.08))
                                        }
                                    }
                                }
                            }
                        }

                        if !insights.monthCategories.isEmpty {
                            SectionLabel(text: "Ledger — \(insights.month)")
                            Card(padding: 0) {
                                VStack(spacing: 0) {
                                    ForEach(insights.monthCategories) { row in
                                        HStack {
                                            Text(row.category).font(.system(size: 14, weight: .semibold))
                                            Spacer()
                                            Text(money(row.totalCents)).font(.system(size: 14, weight: .bold))
                                        }
                                        .padding(.horizontal, 14)
                                        .padding(.vertical, 9)
                                        Divider().overlay(Color.white.opacity(0.08))
                                    }
                                    HStack {
                                        Text("Total").font(.system(size: 14, weight: .bold))
                                        Spacer()
                                        Text(money(insights.monthTotalCents)).font(.system(size: 14, weight: .bold))
                                    }
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 9)
                                }
                            }
                        }
                    } else {
                        ContentUnavailableView("Loading trends…", systemImage: "chart.bar.xaxis")
                            .padding(.top, 80)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 24)
            }
            .background(Theme.bg)
            .navigationTitle("Trends")
            .navigationBarTitleDisplayMode(.inline)
            .task { await state.refreshInsights() }
            .refreshable { await state.refreshInsights() }
        }
    }

    private func statRow(_ insights: InsightsResponse) -> some View {
        HStack(spacing: 8) {
            stat(money(insights.avgDailyCents, compact: true), "avg / day")
            stat("\(insights.noSpendDays)", "no-spend days")
            stat(money(insights.windowTotalCents, compact: true), "28-day total")
        }
    }

    private func stat(_ number: String, _ label: String) -> some View {
        Card(padding: 12) {
            VStack(spacing: 3) {
                Text(number).font(.system(size: 20, weight: .heavy, design: .rounded))
                Text(label.uppercased()).font(.system(size: 9, weight: .semibold))
                    .kerning(0.8).foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func weekdayCard(_ insights: InsightsResponse) -> some View {
        let active = insights.weekdayAvg.filter { $0.avgCents > 0 }
        let heaviest = insights.weekdayAvg.max { $0.avgCents < $1.avgCents }
        return Group {
            if !active.isEmpty {
                SectionLabel(text: "Weekday pattern")
                Card {
                    VStack(alignment: .leading, spacing: 8) {
                        Chart(insights.weekdayAvg) { day in
                            BarMark(
                                x: .value("Avg", Double(day.avgCents) / 100),
                                y: .value("Day", dowNames[day.dow])
                            )
                            .foregroundStyle(day.dow == heaviest?.dow ? Theme.yellow : Theme.blue)
                            .cornerRadius(3)
                        }
                        .chartXAxis {
                            AxisMarks { _ in
                                AxisGridLine().foregroundStyle(Color.white.opacity(0.06))
                                AxisValueLabel(format: .currency(code: "USD").precision(.fractionLength(0)))
                                    .font(.system(size: 9)).foregroundStyle(Theme.muted)
                            }
                        }
                        .chartYAxis {
                            AxisMarks { _ in
                                AxisValueLabel().font(.system(size: 10)).foregroundStyle(Theme.muted)
                            }
                        }
                        .frame(height: 180)
                        if let heaviest, heaviest.avgCents > 0 {
                            Text("\(dowNames[heaviest.dow]) is your heaviest day.")
                                .font(.system(size: 11)).foregroundStyle(Theme.muted)
                        }
                    }
                }
            }
        }
    }
}
