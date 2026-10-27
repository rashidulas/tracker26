import SwiftUI

/// Siri-style hold-to-talk orb (web `.siri-orb`): mint → info → purple gradient core with breathing rings.
/// Scales up and ripples while listening; hue-spins while busy (transcribing / thinking).
struct ChatOrb: View {
    enum Phase: Equatable { case idle, listening, busy }

    var state: Phase
    var size: CGFloat = 54

    private static let mintBright = Color(hex: "#5ee0b8")
    private static let info = Color(hex: "#7aa2f7")
    private static let purple = Color(hex: "#bb9af7")

    private var ringGradient: LinearGradient {
        LinearGradient(
            colors: [Self.mintBright.opacity(0.7), Self.info.opacity(0.6), Self.purple.opacity(0.65)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    var body: some View {
        // Idle breathing is slow, so 30fps is plenty; full rate while listening / busy.
        TimelineView(.animation(minimumInterval: state == .idle ? 1.0 / 30.0 : nil)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            let breathe = (sin(t * 2 * .pi / 3.2) + 1) / 2                // 0…1 over 3.2s
            let breatheB = (sin((t - 0.4) * 2 * .pi / 3.2) + 1) / 2
            let ripple = (t.truncatingRemainder(dividingBy: 1.4)) / 1.4     // 0…1 over 1.4s
            let rippleB = ((t + 0.7).truncatingRemainder(dividingBy: 1.4)) / 1.4
            let pulse = (sin(t * 2 * .pi / 1.1) + 1) / 2
            let listening = state == .listening

            ZStack {
                // Outer ring
                Circle()
                    .strokeBorder(ringGradient, lineWidth: 1.5)
                    .scaleEffect(listening ? 0.92 + 0.38 * ripple : 1 + 0.04 * breatheB)
                    .opacity(listening ? 0.9 * (1 - ripple) + 0.1 : 0.2 + 0.25 * breatheB)
                // Inner ring
                Circle()
                    .strokeBorder(ringGradient, lineWidth: 1.5)
                    .padding(size * 0.08)
                    .scaleEffect(listening ? 0.92 + 0.38 * rippleB : 1 + 0.04 * breathe)
                    .opacity(listening ? 0.9 * (1 - rippleB) + 0.1 : 0.35 + 0.3 * breathe)

                // Core
                ZStack {
                    LinearGradient(
                        colors: [Self.mintBright, Self.info, Self.purple],
                        startPoint: UnitPoint(x: 0.15, y: 0.0),
                        endPoint: UnitPoint(x: 0.85, y: 1.0)
                    )
                    RadialGradient(colors: [Theme.mint, .clear], center: UnitPoint(x: 0.6, y: 0.3), startRadius: 0, endRadius: size * 0.3)
                    RadialGradient(colors: [Self.purple, .clear], center: UnitPoint(x: 0.4, y: 0.8), startRadius: 0, endRadius: size * 0.3)
                    RadialGradient(colors: [.white.opacity(0.95), .clear], center: UnitPoint(x: 0.3, y: 0.28), startRadius: 0, endRadius: size * 0.22)
                }
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(.white.opacity(0.3), lineWidth: 0.75))
                .padding(size * 0.2)
                .hueRotation(.degrees(state == .busy ? (t * 150).truncatingRemainder(dividingBy: 360) : 0))
                .brightness(listening ? 0.08 * pulse : 0)
                .scaleEffect(listening ? 1.12 : 1 + 0.02 * breathe)
                .shadow(color: Theme.mint.opacity(listening ? 0.6 : 0.35), radius: listening ? 14 : 9)
                .shadow(color: Self.info.opacity(listening ? 0.45 : 0.2), radius: listening ? 24 : 16)

                Image(systemName: state == .busy ? "waveform" : "mic.fill")
                    .font(.system(size: size * 0.2, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.92))
                    .shadow(color: .black.opacity(0.25), radius: 2, y: 1)
                    .scaleEffect(listening ? 1.12 : 1)
            }
            .frame(width: size, height: size)
            .scaleEffect(listening ? 1.15 : 1)
        }
        .animation(.spring(duration: 0.25), value: state)
        .frame(width: size, height: size)
        .contentShape(Circle())
    }
}
