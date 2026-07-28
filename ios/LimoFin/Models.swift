import Foundation

// Decoded with .convertFromSnakeCase — property names are the camelCase
// mirror of the LimoFin API fields (server.js /api/today, /api/insights,
// /api/receipts).

struct TodayResponse: Codable {
    let date: String
    let noPlan: Bool
    let plan: PlanInfo?
    let dayIndex: Int?
    let daysLeft: Int?
    let safeTodayCents: Int?
    let spentTodayCents: Int?
    let totals: PlanTotals?
    let envelopes: [Envelope]?
    let flags: [PlanFlag]?
    let runway: [RunwayPoint]?
    let runwayLowCents: Int?
    let steps: StepsSummary?
    let upcomingBills: [UpcomingBill]?
}

struct PlanInfo: Codable {
    let id: Int
    let weekStart: String
    let title: String?
    let verdict: String?
    let floorCents: Int?
}

struct PlanTotals: Codable {
    let allocatedCents: Int
    let spentCents: Int
    let remainingCents: Int
    let stepsTotal: Int
    let stepsDone: Int
}

struct Envelope: Codable, Identifiable, Hashable {
    let id: Int
    let name: String
    let allocatedCents: Int
    let spentCents: Int
    let remainingCents: Int
    let spentTodayCents: Int?
    let expectedToDateCents: Int?
    let pace: String?
}

struct PlanFlag: Codable, Hashable {
    let severity: String
    let text: String
}

struct RunwayPoint: Codable, Hashable {
    let label: String
    let amountCents: Int
}

struct StepsSummary: Codable {
    let total: Int
    let done: Int
}

struct UpcomingBill: Codable, Identifiable, Hashable {
    let billId: Int
    let name: String
    let amountCents: Int
    let dueDate: String
    let inDays: Int
    let autopay: Bool
    let light: String
    var id: Int { billId }
}

// MARK: - Insights

struct InsightsResponse: Codable {
    let window: InsightsWindow
    let daily: [DailySpend]
    let windowTotalCents: Int
    let avgDailyCents: Int
    let noSpendDays: Int
    let weekdayAvg: [WeekdayAvg]
    let topMemos: [MemoRollup]
    let weeks: [WeekRollup]
    let month: String
    let monthCategories: [CategoryRollup]
    let monthTotalCents: Int
}

struct InsightsWindow: Codable {
    let start: String
    let end: String
    let days: Int
}

struct DailySpend: Codable, Identifiable, Hashable {
    let date: String
    let spentCents: Int
    var id: String { date }
}

struct WeekdayAvg: Codable, Identifiable, Hashable {
    let dow: Int
    let avgCents: Int
    var id: Int { dow }
}

struct MemoRollup: Codable, Identifiable, Hashable {
    let label: String
    let count: Int
    let totalCents: Int
    var id: String { label }
}

struct WeekRollup: Codable, Identifiable, Hashable {
    let weekStart: String
    let title: String?
    let allocatedCents: Int
    let spentCents: Int
    let remainingCents: Int
    let adherencePct: Int?
    var id: String { weekStart }
}

struct CategoryRollup: Codable, Identifiable, Hashable {
    let category: String
    let count: Int
    let totalCents: Int
    var id: String { category }
}

// MARK: - Receipts

struct ReceiptUploadResponse: Codable {
    let ai: String
    let parsed: ParsedReceipt?
    let receipt: Receipt
}

struct ParsedReceipt: Codable {
    let merchant: String?
    let date: String?
    let totalCents: Int?
    let taxCents: Int?
    let category: String?
    let envelope: String?
    let confidence: Double?
}

struct Receipt: Codable, Identifiable {
    let id: Int
    let status: String
    let merchant: String?
    let purchaseDate: String?
    let totalCents: Int?
    let createdAt: String?
    let imageUrl: String?
}

struct CommitResponse: Codable {
    let receipt: Receipt
    let envelope: Envelope?
}

let expenseCategories = ["groceries", "dining", "gas", "shopping", "utilities", "health", "entertainment", "travel", "services", "other"]
