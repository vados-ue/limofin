import Foundation

enum APIError: LocalizedError {
    case badStatus(Int, String)
    case unreachable

    var errorDescription: String? {
        switch self {
        case .badStatus(let code, let message):
            return message.isEmpty ? "Server error (\(code))" : message
        case .unreachable:
            return "Can't reach LimoFin. Are you on home Wi-Fi?"
        }
    }
}

enum API {
    static let defaultBase = "http://10.117.1.82:3002"

    static var baseURL: URL {
        let stored = UserDefaults.standard.string(forKey: "serverURL") ?? defaultBase
        return URL(string: stored) ?? URL(string: defaultBase)!
    }

    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    private static func request<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil, timeout: TimeInterval? = nil) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        if let timeout { request.timeoutInterval = timeout }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.unreachable
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? ""
            throw APIError.badStatus(status, message)
        }
        return try decoder.decode(T.self, from: data)
    }

    static func health(timeout: TimeInterval = 2.5) async -> Bool {
        struct Health: Codable { let ok: Bool }
        let result: Health? = try? await request("api/health", timeout: timeout)
        return result?.ok ?? false
    }

    static func today() async throws -> TodayResponse {
        try await request("api/today")
    }

    static func insights() async throws -> InsightsResponse {
        try await request("api/insights")
    }

    static func recentReceipts() async throws -> [Receipt] {
        try await request("api/receipts?status=committed&limit=5")
    }

    static func uploadReceipt(jpeg: Data) async throws -> ReceiptUploadResponse {
        try await request("api/receipts", method: "POST", body: [
            "media_type": "image/jpeg",
            "image_base64": jpeg.base64EncodedString()
        ], timeout: 90)
    }

    static func commitReceipt(id: Int, amountCents: Int, date: String, envelopeId: Int?, memo: String?, category: String?) async throws -> CommitResponse {
        var body: [String: Any] = ["amount_cents": amountCents, "date": date]
        if let envelopeId { body["envelope_id"] = envelopeId }
        if let memo, !memo.isEmpty { body["memo"] = memo }
        if let category, !category.isEmpty { body["category"] = category }
        return try await request("api/receipts/\(id)/commit", method: "POST", body: body)
    }

    static func dismissReceipt(id: Int) async throws {
        struct Ack: Codable { let ok: Bool }
        let _: Ack = try await request("api/receipts/\(id)/dismiss", method: "POST", body: [:])
    }
}

func isoToday() -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: Date())
}
