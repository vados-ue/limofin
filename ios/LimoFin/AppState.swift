import SwiftUI

@MainActor
final class AppState: ObservableObject {
    @Published var today: TodayResponse?
    @Published var todayFetchedAt: Date?
    @Published var insights: InsightsResponse?
    @Published var reachable = false
    @Published var queue: [QueuedReceipt] = []
    @Published var recent: [Receipt] = []

    init() {
        // Offline glance: restore the last /api/today payload immediately.
        if let cached = UserDefaults.standard.data(forKey: "cachedToday") {
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            today = try? decoder.decode(TodayResponse.self, from: cached)
            todayFetchedAt = UserDefaults.standard.object(forKey: "cachedTodayAt") as? Date
        }
        queue = OfflineQueue.list()
    }

    func refreshToday() async {
        reachable = await API.health()
        guard reachable else { return }
        do {
            let fresh = try await API.today()
            today = fresh
            todayFetchedAt = Date()
            let encoder = JSONEncoder()
            encoder.keyEncodingStrategy = .convertToSnakeCase
            if let data = try? encoder.encode(fresh) {
                UserDefaults.standard.set(data, forKey: "cachedToday")
                UserDefaults.standard.set(Date(), forKey: "cachedTodayAt")
            }
        } catch { /* keep cached */ }
    }

    func refreshInsights() async {
        do { insights = try await API.insights() } catch { /* keep old */ }
    }

    func refreshRecent() async {
        do { recent = try await API.recentReceipts() } catch { /* keep old */ }
    }

    func reloadQueue() {
        queue = OfflineQueue.list()
    }
}
