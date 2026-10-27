import SwiftUI

/// Design tokens mirroring the web app (`app/globals.css` + `tailwind.config.ts`).
enum Theme {
    // Backgrounds
    static let bg = Color(hex: "#0a0b0d")
    static let bgElevated = Color(hex: "#0f1115")
    static let surface = Color(hex: "#12151b")
    static let surfaceHover = Color(hex: "#181c24")
    static let surface2 = Color(hex: "#1a1f28")
    static let border = Color(hex: "#262b36")
    static let borderSubtle = Color(hex: "#1c212b")

    // Text
    static let ink = Color(hex: "#f0f2f5")
    static let inkSecondary = Color(hex: "#9aa1ad")
    static let inkMuted = Color(hex: "#6b7280")

    // Accents
    static let mint = Color(hex: "#3dcea6")
    static let mintBright = Color(hex: "#5ee0b8")
    static let mintDim = Color(hex: "#3dcea6").opacity(0.12)
    static let mintGlow = Color(hex: "#3dcea6").opacity(0.18)
    static let danger = Color(hex: "#f07178")
    static let dangerDim = Color(hex: "#f07178").opacity(0.12)
    static let warning = Color(hex: "#e8c468")
    static let warningDim = Color(hex: "#e8c468").opacity(0.12)
    static let info = Color(hex: "#7aa2f7")
    static let infoDim = Color(hex: "#7aa2f7").opacity(0.12)
    static let purple = Color(hex: "#bb9af7")
    static let orange = Color(hex: "#e8a05a")
    static let cyan = Color(hex: "#7dcfff")
    static let lavender = Color(hex: "#c0caf5")

    /// Preset palette used by category / friend pickers on the web.
    static let palette: [String] = ["#3dcea6", "#5ee0b8", "#7aa2f7", "#bb9af7", "#f07178", "#e8a05a", "#e8c468", "#7dcfff", "#9aa1ad", "#c0caf5"]
    static let emojiPresets: [String] = ["📁", "🚗", "🛒", "🍽️", "🏠", "💡", "✈️", "💼", "🎬", "🏥", "🛍️", "💰"]

    // Radii
    static let radiusSm: CGFloat = 8
    static let radiusMd: CGFloat = 12
    static let radiusLg: CGFloat = 16
    static let radiusXl: CGFloat = 24
}

extension Font {
    /// Money / numbers — monospaced digits like the web's JetBrains Mono `.money` class.
    static func money(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
    /// Display titles (web: Instrument Sans).
    static func display(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .default)
    }
}

extension Color {
    /// Accepts `#rgb`, `#rrggbb`, `#rrggbbaa`. Falls back to mint for invalid input (e.g. the web's `#gray`).
    init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        var value: UInt64 = 0
        guard (s.count == 6 || s.count == 8), Scanner(string: s).scanHexInt64(&value) else {
            self = Color(red: 61 / 255, green: 206 / 255, blue: 166 / 255)
            return
        }
        let r, g, b, a: Double
        if s.count == 8 {
            r = Double((value >> 24) & 0xff) / 255
            g = Double((value >> 16) & 0xff) / 255
            b = Double((value >> 8) & 0xff) / 255
            a = Double(value & 0xff) / 255
        } else {
            r = Double((value >> 16) & 0xff) / 255
            g = Double((value >> 8) & 0xff) / 255
            b = Double(value & 0xff) / 255
            a = 1
        }
        self = Color(.sRGB, red: r, green: g, blue: b, opacity: a)
    }
}
