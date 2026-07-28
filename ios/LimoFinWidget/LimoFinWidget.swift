import WidgetKit
import SwiftUI

// Home-screen + lock-screen glance. The provider fetches /api/today directly
// (works on home Wi-Fi) and keeps the last payload cached so off-LAN the
// widget shows stale-but-honest numbers instead of an error.

struct TodaySnapshot: Codable {
    let safeTodayCents: Int?
    let remainingCents: Int?
    let spentTodayCents: Int?
    let dayIndex: Int?
    let floorCents: Int?
    let runwayLowCents: Int?
    let noPlan: Bool
    let envelopes: [EnvelopeSnapshot]
    let fetchedAt: Date

    struct EnvelopeSnapshot: Codable {
        let name: String
        let allocatedCents: Int
        let spentCents: Int
        let remainingCents: Int
        let pace: String?
    }
}

struct Entry: TimelineEntry {
    let date: Date
    let snapshot: TodaySnapshot?
    let stale: Bool
}

struct Provider: TimelineProvider {
    static let baseURL = URL(string: "http://10.117.1.82:3002")!

    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), snapshot: cached() ?? sample, stale: false)
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: Date(), snapshot: cached() ?? sample, stale: false))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        Task {
            var snapshot: TodaySnapshot? = nil
            var stale = false
            do {
                snapshot = try await fetchToday()
                cache(snapshot!)
            } catch {
                snapshot = cached()
                stale = true
            }
            let entry = Entry(date: Date(), snapshot: snapshot, stale: stale)
            let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date())!
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func fetchToday() async throws -> TodaySnapshot {
        var request = URLRequest(url: Self.baseURL.appendingPathComponent("api/today"))
        request.timeoutInterval = 6
        let (data, _) = try await URLSession.shared.data(for: request)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase

        struct Raw: Codable {
            struct Plan: Codable { let floorCents: Int? }
            struct Totals: Codable { let remainingCents: Int }
            struct Env: Codable {
                let name: String
                let allocatedCents: Int
                let spentCents: Int
                let remainingCents: Int
                let pace: String?
            }
            let noPlan: Bool
            let plan: Plan?
            let dayIndex: Int?
            let safeTodayCents: Int?
            let spentTodayCents: Int?
            let runwayLowCents: Int?
            let totals: Totals?
            let envelopes: [Env]?
        }
        let raw = try decoder.decode(Raw.self, from: data)
        return TodaySnapshot(
            safeTodayCents: raw.safeTodayCents,
            remainingCents: raw.totals?.remainingCents,
            spentTodayCents: raw.spentTodayCents,
            dayIndex: raw.dayIndex,
            floorCents: raw.plan?.floorCents,
            runwayLowCents: raw.runwayLowCents,
            noPlan: raw.noPlan,
            envelopes: (raw.envelopes ?? []).map {
                TodaySnapshot.EnvelopeSnapshot(name: $0.name, allocatedCents: $0.allocatedCents,
                                               spentCents: $0.spentCents, remainingCents: $0.remainingCents,
                                               pace: $0.pace)
            },
            fetchedAt: Date()
        )
    }

    private func cache(_ snapshot: TodaySnapshot) {
        if let data = try? JSONEncoder().encode(snapshot) {
            UserDefaults.standard.set(data, forKey: "widgetToday")
        }
    }

    private func cached() -> TodaySnapshot? {
        guard let data = UserDefaults.standard.data(forKey: "widgetToday") else { return nil }
        return try? JSONDecoder().decode(TodaySnapshot.self, from: data)
    }

    private var sample: TodaySnapshot {
        TodaySnapshot(safeTodayCents: 2500, remainingCents: 15000, spentTodayCents: 0, dayIndex: 1,
                      floorCents: 150000, runwayLowCents: 165000, noPlan: false,
                      envelopes: [
                        .init(name: "Groceries", allocatedCents: 8000, spentCents: 0, remainingCents: 8000, pace: "on"),
                        .init(name: "Gas", allocatedCents: 7000, spentCents: 0, remainingCents: 7000, pace: "on")
                      ],
                      fetchedAt: Date())
    }
}

func widgetMoney(_ cents: Int?) -> String {
    guard let cents else { return "–" }
    let dollars = Double(cents) / 100
    if abs(dollars) >= 1000 { return String(format: "$%.1fk", dollars / 1000) }
    return cents % 100 == 0 ? String(format: "$%.0f", dollars) : String(format: "$%.2f", dollars)
}

struct LimoFinWidgetEntryView: View {
    var entry: Entry
    @Environment(\.widgetFamily) var family

    private let green = Color(red: 0.133, green: 0.773, blue: 0.369)
    private let yellow = Color(red: 0.918, green: 0.702, blue: 0.031)
    private let red = Color(red: 0.937, green: 0.267, blue: 0.267)
    private let muted = Color(red: 0.612, green: 0.639, blue: 0.686)

    var body: some View {
        Group {
            switch family {
            case .accessoryCircular: circular
            case .accessoryRectangular: rectangular
            case .accessoryInline: inline
            case .systemMedium: medium
            default: small
            }
        }
        .widgetURL(URL(string: "limofin://today"))
    }

    private var heroColor: Color {
        guard let snapshot = entry.snapshot, !snapshot.noPlan else { return muted }
        if (snapshot.remainingCents ?? 0) < 0 { return red }
        if entry.stale { return yellow }
        return green
    }

    private var safeText: String {
        guard let snapshot = entry.snapshot else { return "–" }
        return snapshot.noPlan ? "no plan" : widgetMoney(snapshot.safeTodayCents)
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("LimoFin").font(.system(size: 10, weight: .bold)).foregroundStyle(muted)
                Spacer()
                if let day = entry.snapshot?.dayIndex {
                    Text("d\(day + 1)/7\(entry.stale ? " · stale" : "")")
                        .font(.system(size: 9)).foregroundStyle(entry.stale ? yellow : muted)
                }
            }
            Spacer()
            Text(safeText)
                .font(.system(size: entry.snapshot?.noPlan == true ? 20 : 30, weight: .heavy, design: .rounded))
                .foregroundStyle(heroColor)
                .minimumScaleFactor(0.6)
            Text(entry.snapshot?.noPlan == true ? "push via /finance" : "safe today · \(widgetMoney(max(0, entry.snapshot?.remainingCents ?? 0))) left wk")
                .font(.system(size: 9)).foregroundStyle(muted)
            Spacer(minLength: 0)
        }
    }

    private var medium: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text("LimoFin").font(.system(size: 10, weight: .bold)).foregroundStyle(muted)
                Spacer()
                Text(safeText)
                    .font(.system(size: 30, weight: .heavy, design: .rounded))
                    .foregroundStyle(heroColor)
                    .minimumScaleFactor(0.6)
                Text(entry.snapshot?.noPlan == true ? "push via /finance" : "safe today")
                    .font(.system(size: 9)).foregroundStyle(muted)
                Spacer(minLength: 0)
            }
            if let snapshot = entry.snapshot, !snapshot.noPlan {
                VStack(spacing: 7) {
                    ForEach(Array(snapshot.envelopes.prefix(3).enumerated()), id: \.offset) { _, envelope in
                        VStack(spacing: 2) {
                            HStack {
                                Text(envelope.name).font(.system(size: 10, weight: .medium)).foregroundStyle(muted).lineLimit(1)
                                Spacer()
                                Text(widgetMoney(envelope.remainingCents))
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(envelope.remainingCents < 0 ? red : .white)
                            }
                            GeometryReader { geo in
                                let ratio = envelope.allocatedCents > 0
                                    ? min(1, Double(envelope.spentCents) / Double(envelope.allocatedCents))
                                    : (envelope.spentCents > 0 ? 1 : 0)
                                ZStack(alignment: .leading) {
                                    Capsule().fill(Color.white.opacity(0.12))
                                    Capsule()
                                        .fill(envelope.remainingCents < 0 ? red : (envelope.pace == "hot" ? yellow : green))
                                        .frame(width: geo.size.width * ratio)
                                }
                            }
                            .frame(height: 4)
                        }
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(entry.snapshot?.noPlan == true ? "LimoFin: no plan" : "Safe today \(widgetMoney(entry.snapshot?.safeTodayCents))")
                .font(.system(size: 13, weight: .bold))
            if let snapshot = entry.snapshot, !snapshot.noPlan {
                Text("wk left \(widgetMoney(max(0, snapshot.remainingCents ?? 0))) · d\((snapshot.dayIndex ?? 0) + 1)/7\(entry.stale ? " · stale" : "")")
                    .font(.system(size: 11))
            }
        }
    }

    private var circular: some View {
        VStack(spacing: 0) {
            Text(entry.snapshot?.noPlan == true ? "—" : widgetMoney(entry.snapshot?.safeTodayCents))
                .font(.system(size: 14, weight: .heavy, design: .rounded))
                .minimumScaleFactor(0.5)
            Text("today").font(.system(size: 8))
        }
    }

    private var inline: some View {
        Text(entry.snapshot?.noPlan == true ? "LimoFin: no plan" : "Safe today \(widgetMoney(entry.snapshot?.safeTodayCents))")
    }
}

struct LimoFinWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LimoFinToday", provider: Provider()) { entry in
            LimoFinWidgetEntryView(entry: entry)
                .containerBackground(for: .widget) {
                    Color(red: 0.059, green: 0.067, blue: 0.082)
                }
        }
        .configurationDisplayName("Safe to spend")
        .description("Today's budget from LimoFin.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct LimoFinWidgetBundle: WidgetBundle {
    var body: some Widget {
        LimoFinWidget()
    }
}
