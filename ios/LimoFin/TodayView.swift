import SwiftUI

struct TodayView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    if let today = state.today {
                        if !state.reachable, let at = state.todayFetchedAt {
                            Text("Offline — showing data from \(at.formatted(.relative(presentation: .named)))")
                                .font(.caption2)
                                .foregroundStyle(Theme.muted)
                        }
                        if today.noPlan {
                            noPlanCard
                        } else {
                            heroCard(today)
                            if let verdict = today.plan?.verdict, !verdict.isEmpty {
                                Card(padding: 14) {
                                    Text(verdict)
                                        .font(.system(size: 13))
                                        .foregroundStyle(Theme.muted)
                                }
                            }
                            if let envelopes = today.envelopes, !envelopes.isEmpty {
                                SectionLabel(text: "Envelopes")
                                ForEach(envelopes) { envelope in
                                    envelopeRow(envelope)
                                }
                            }
                            if let flags = today.flags, !flags.isEmpty {
                                SectionLabel(text: "Flags")
                                Card(padding: 0) {
                                    VStack(spacing: 0) {
                                        ForEach(flags, id: \.self) { flag in
                                            flagRow(flag)
                                        }
                                    }
                                }
                            }
                        }
                        if let bills = today.upcomingBills, !bills.isEmpty {
                            SectionLabel(text: "Bills next 7 days")
                            Card(padding: 0) {
                                VStack(spacing: 0) {
                                    ForEach(bills) { bill in
                                        billRow(bill)
                                        if bill.id != bills.last?.id {
                                            Divider().overlay(Color.white.opacity(0.08))
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        ContentUnavailableView(
                            state.reachable ? "Loading…" : "Can't reach LimoFin",
                            systemImage: "wifi.exclamationmark",
                            description: Text("Connect to home Wi-Fi and pull to refresh.")
                        )
                        .padding(.top, 80)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 24)
            }
            .background(Theme.bg)
            .navigationTitle("LimoFin")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Circle()
                        .fill(state.reachable ? Theme.green : Theme.red)
                        .frame(width: 8, height: 8)
                }
            }
            .refreshable {
                await state.refreshToday()
            }
        }
    }

    private var noPlanCard: some View {
        Card {
            VStack(alignment: .center, spacing: 6) {
                Text("NO WEEK PLAN")
                    .font(.system(size: 12, weight: .bold))
                    .kerning(1.5)
                    .foregroundStyle(Theme.muted)
                Text("—")
                    .font(.system(size: 52, weight: .heavy))
                    .foregroundStyle(Theme.yellow)
                Text("No plan covers today. Run the /finance weekly review to push this week's plan.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
        }
    }

    private func heroColor(_ today: TodayResponse) -> Color {
        guard let totals = today.totals else { return Theme.green }
        if totals.remainingCents < 0 { return Theme.red }
        let ratio = totals.allocatedCents > 0 ? Double(totals.spentCents) / Double(totals.allocatedCents) : 0
        if ratio > 0.85 && (today.daysLeft ?? 0) > 1 { return Theme.yellow }
        return Theme.green
    }

    private func heroCard(_ today: TodayResponse) -> some View {
        Card {
            VStack(spacing: 6) {
                Text("SAFE TO SPEND TODAY")
                    .font(.system(size: 12, weight: .bold))
                    .kerning(1.5)
                    .foregroundStyle(Theme.muted)
                Text(money(today.safeTodayCents))
                    .font(.system(size: 52, weight: .heavy, design: .rounded))
                    .foregroundStyle(heroColor(today))
                    .contentTransition(.numericText())
                Text("Spent today \(money(today.spentTodayCents)) · \(money(max(0, today.totals?.remainingCents ?? 0))) left this week")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
                HStack(spacing: 6) {
                    if let dayIndex = today.dayIndex {
                        chip("Day \(dayIndex + 1) of 7", color: Theme.muted)
                    }
                    if let floor = today.plan?.floorCents, let low = today.runwayLowCents {
                        chip("Floor \(money(floor, compact: true)) · low \(money(low, compact: true))",
                             color: low >= floor ? Theme.green : Theme.red)
                    }
                    if let steps = today.steps, steps.total > 0 {
                        chip("Checklist \(steps.done)/\(steps.total)", color: Theme.muted)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
        }
    }

    private func chip(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(color == Theme.muted ? Theme.text : color)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Theme.surfaceAlt)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(color.opacity(color == Theme.muted ? 0.15 : 0.5), lineWidth: 1))
    }

    private func paceLabel(_ pace: String?) -> (String, Color) {
        switch pace {
        case "over": return ("over", Theme.red)
        case "hot": return ("running hot", Theme.yellow)
        case "cool": return ("under pace", Theme.blue)
        default: return ("on pace", Theme.green)
        }
    }

    private func envelopeRow(_ envelope: Envelope) -> some View {
        let ratio = envelope.allocatedCents > 0
            ? min(1, Double(envelope.spentCents) / Double(envelope.allocatedCents))
            : (envelope.spentCents > 0 ? 1 : 0)
        let barColor: Color = envelope.remainingCents < 0 ? Theme.red : (envelope.pace == "hot" ? Theme.yellow : Theme.green)
        let pace = paceLabel(envelope.pace)
        return Card(padding: 14) {
            VStack(spacing: 7) {
                HStack {
                    Text(envelope.name).font(.system(size: 15, weight: .bold))
                    Spacer()
                    Text("\(money(envelope.remainingCents)) left")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(envelope.remainingCents < 0 ? Theme.red : Theme.text)
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.surfaceAlt)
                        Capsule().fill(barColor).frame(width: geo.size.width * ratio)
                    }
                }
                .frame(height: 8)
                HStack {
                    Text("\(money(envelope.spentCents)) of \(money(envelope.allocatedCents))")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.muted)
                    Spacer()
                    Text(pace.0)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(pace.1)
                }
            }
        }
    }

    private func flagRow(_ flag: PlanFlag) -> some View {
        let color: Color = flag.severity == "danger" ? Theme.red : (flag.severity == "warn" ? Theme.yellow : Theme.muted)
        return Text(flag.text)
            .font(.system(size: 13))
            .foregroundStyle(color)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
    }

    private func billRow(_ bill: UpcomingBill) -> some View {
        let dotColor: Color = bill.light == "green" ? Theme.green : (bill.light == "yellow" ? Theme.yellow : Theme.red)
        let when = bill.inDays == 0 ? "today" : (bill.inDays == 1 ? "tomorrow" : "in \(bill.inDays) days")
        return HStack(spacing: 10) {
            Circle().fill(dotColor).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 2) {
                Text(bill.name).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                Text(when + (bill.autopay ? " · autopay" : ""))
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.muted)
            }
            Spacer()
            Text(money(bill.amountCents))
                .font(.system(size: 14, weight: .bold))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }
}
