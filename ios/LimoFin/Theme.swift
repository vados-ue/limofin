import SwiftUI

// Palette mirrors the LimoFin web app (public/style.css + public/m/m.css).
enum Theme {
    static let bg = Color(hex: 0x0F1115)
    static let surface = Color(hex: 0x161A21)
    static let surfaceAlt = Color(hex: 0x1D2430)
    static let text = Color(hex: 0xF3F4F6)
    static let muted = Color(hex: 0x9CA3AF)
    static let green = Color(hex: 0x22C55E)
    static let yellow = Color(hex: 0xEAB308)
    static let red = Color(hex: 0xEF4444)
    static let blue = Color(hex: 0x38BDF8)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

func money(_ cents: Int?, compact: Bool = false) -> String {
    guard let cents else { return "–" }
    let dollars = Double(cents) / 100
    if compact && abs(dollars) >= 1000 {
        return String(format: "$%.1fk", dollars / 1000)
    }
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.currencyCode = "USD"
    formatter.maximumFractionDigits = cents % 100 == 0 ? 0 : 2
    formatter.minimumFractionDigits = cents % 100 == 0 ? 0 : 2
    return formatter.string(from: NSNumber(value: dollars)) ?? "$\(dollars)"
}

struct Card<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder let content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
            )
    }
}

struct SectionLabel: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .bold))
            .kerning(1.2)
            .foregroundStyle(Theme.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
            .padding(.top, 10)
    }
}
