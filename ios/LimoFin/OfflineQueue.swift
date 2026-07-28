import Foundation
import UIKit

struct QueuedReceipt: Codable, Identifiable, Hashable {
    let id: UUID
    let createdAt: Date
}

// Receipts snapped off home Wi-Fi wait here (JPEGs in Documents/queue) until
// the LAN server is reachable again — same model as the PWA's IndexedDB queue.
enum OfflineQueue {
    private static var dir: URL {
        let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("queue", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private static var indexURL: URL { dir.appendingPathComponent("index.json") }

    static func list() -> [QueuedReceipt] {
        guard let data = try? Data(contentsOf: indexURL),
              let items = try? JSONDecoder().decode([QueuedReceipt].self, from: data) else { return [] }
        return items.sorted { $0.createdAt > $1.createdAt }
    }

    private static func save(_ items: [QueuedReceipt]) {
        if let data = try? JSONEncoder().encode(items) {
            try? data.write(to: indexURL)
        }
    }

    static func add(jpeg: Data) -> QueuedReceipt {
        let item = QueuedReceipt(id: UUID(), createdAt: Date())
        try? jpeg.write(to: dir.appendingPathComponent("\(item.id.uuidString).jpg"))
        save(list() + [item])
        return item
    }

    static func jpeg(for item: QueuedReceipt) -> Data? {
        try? Data(contentsOf: dir.appendingPathComponent("\(item.id.uuidString).jpg"))
    }

    static func image(for item: QueuedReceipt) -> UIImage? {
        jpeg(for: item).flatMap(UIImage.init(data:))
    }

    static func remove(_ item: QueuedReceipt) {
        try? FileManager.default.removeItem(at: dir.appendingPathComponent("\(item.id.uuidString).jpg"))
        save(list().filter { $0.id != item.id })
    }
}

// Downscale + JPEG-encode, mirroring the PWA (max 1600px, q0.82).
func receiptJPEG(from image: UIImage) -> Data? {
    let maxDim: CGFloat = 1600
    let largest = max(image.size.width, image.size.height)
    let scale = min(1, maxDim / max(largest, 1))
    let target = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    let scaled = UIGraphicsImageRenderer(size: target, format: format).image { _ in
        image.draw(in: CGRect(origin: .zero, size: target))
    }
    return scaled.jpegData(compressionQuality: 0.82)
}
