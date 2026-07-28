import SwiftUI

@main
struct LimoFinApp: App {
    @StateObject private var state = AppState()

    var body: some Scene {
        WindowGroup {
            TabView {
                TodayView()
                    .tabItem { Label("Today", systemImage: "circle.dashed.inset.filled") }
                ScanView()
                    .tabItem { Label("Scan", systemImage: "doc.viewfinder") }
                TrendsView()
                    .tabItem { Label("Trends", systemImage: "chart.bar.xaxis") }
            }
            .environmentObject(state)
            .tint(Theme.green)
            .preferredColorScheme(.dark)
            .background(Theme.bg)
            .task {
                await state.refreshToday()
            }
        }
    }
}
