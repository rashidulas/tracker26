import SwiftUI

// Reusable building blocks that mirror the web app's visual language.
// Use these in feature screens so everything feels like one system.

// MARK: - Backgrounds & containers

/// App background: graphite with the web's soft mint radial glows.
struct AppBackground: View {
    var body: some View {
        ZStack {
            Theme.bg
            RadialGradient(colors: [Theme.mint.opacity(0.07), .clear], center: UnitPoint(x: 1.0, y: -0.1), startRadius: 0, endRadius: 520)
            RadialGradient(colors: [Theme.mint.opacity(0.03), .clear], center: UnitPoint(x: 0, y: 1), startRadius: 0, endRadius: 420)
        }
        .ignoresSafeArea()
    }
}

extension View {
    /// Standard screen chrome: app background behind scroll content, dark nav bar.
    func appScreen() -> some View {
        self
            .scrollContentBackground(.hidden)
            .background(AppBackground())
            .toolbarBackground(Theme.bg.opacity(0.85), for: .navigationBar)
    }

    /// Web `.panel`: surface fill, subtle border, 16pt radius.
    func panel(padding: CGFloat = 16, radius: CGFloat = Theme.radiusLg) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Theme.borderSubtle, lineWidth: 1))
    }

    /// Tinted panel used for hero / summary strips (e.g. expenses total, friend balances).
    func tintedPanel(_ tint: Color, padding: CGFloat = 16, radius: CGFloat = Theme.radiusLg) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                LinearGradient(colors: [tint.opacity(0.14), Theme.surface], startPoint: .topLeading, endPoint: .bottomTrailing),
                in: RoundedRectangle(cornerRadius: radius, style: .continuous)
            )
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(tint.opacity(0.22), lineWidth: 1))
    }

    /// Text-field look from the web `Input`: surface-2 fill, border, 12pt radius.
    func fieldStyle() -> some View {
        self
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
            .foregroundStyle(Theme.ink)
    }

    /// Sheet chrome matching the web bottom-sheet modal. Also shows toasts, which the root overlay can't draw above a sheet.
    func appSheet() -> some View {
        self
            .modifier(ToastOverlay())
            .presentationBackground(Theme.surface)
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(Theme.radiusXl)
    }

    /// For SwiftUI `Form`/`List`: hide default background and use app chrome.
    func appFormStyle() -> some View {
        self
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .tint(Theme.mint)
    }
}

/// Apply to rows inside an app-styled `Form` / `List`.
extension View {
    func appRow() -> some View { listRowBackground(Theme.surface) }
}

// MARK: - Text

/// 11pt uppercase muted label with letter spacing (web section-label pattern).
struct SectionLabel: View {
    let text: String
    var color: Color = Theme.inkMuted

    init(_ text: String, color: Color = Theme.inkMuted) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(1.4)
            .foregroundStyle(color)
    }
}

/// Money in monospaced digits.
struct MoneyText: View {
    let value: Double
    var size: CGFloat = 15
    var weight: Font.Weight = .semibold
    var color: Color = Theme.ink
    var cents: Bool = true
    var signed: Bool = false

    var body: some View {
        Text(signed ? Format.signedMoney(value, cents: cents) : Format.money(value, cents: cents))
            .font(.money(size, weight: weight))
            .monospacedDigit()
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
    }
}

/// Screen header like the web `PageHeader` (use at top of a ScrollView when you want the subtitle).
struct PageHeader: View {
    let title: String
    var subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.display(28)).foregroundStyle(Theme.ink)
            if let subtitle { Text(subtitle).font(.subheadline).foregroundStyle(Theme.inkSecondary) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Tiles & chips

/// Rounded square with an SF Symbol on a tinted background.
struct IconTile: View {
    let symbol: String
    var tint: Color = Theme.mint
    var size: CGFloat = 36

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.44, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
    }
}

/// Rounded square with an emoji on a category-colour tint (web `${color}18`).
struct EmojiTile: View {
    let emoji: String
    var color: Color = Theme.mint
    var size: CGFloat = 44

    var body: some View {
        Text(emoji)
            .font(.system(size: size * 0.48))
            .frame(width: size, height: size)
            .background(color.opacity(0.13), in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
    }
}

/// Initials avatar used for friends.
struct InitialsAvatar: View {
    let initials: String
    var color: Color
    var size: CGFloat = 36

    var body: some View {
        Text(initials)
            .font(.system(size: size * 0.36, weight: .semibold))
            .foregroundStyle(color)
            .frame(width: size, height: size)
            .background(color.opacity(0.16), in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
    }
}

/// Selectable chip (category picker, filters). Active chip is tinted with `color`.
struct Chip: View {
    let label: String
    var emoji: String? = nil
    var symbol: String? = nil
    var color: Color = Theme.mint
    var isSelected: Bool = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let emoji { Text(emoji) }
                if let symbol { Image(systemName: symbol).font(.system(size: 12, weight: .semibold)) }
                Text(label).font(.system(size: 14, weight: .medium))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .foregroundStyle(isSelected ? Theme.ink : Theme.inkSecondary)
            .background(isSelected ? color.opacity(0.16) : Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous)
                    .strokeBorder(isSelected ? color.opacity(0.6) : Theme.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

/// Small capsule tag (subcategory, type badge).
struct Pill: View {
    let text: String
    var color: Color = Theme.inkSecondary

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(color)
            .background(color.opacity(0.12), in: Capsule())
    }
}

/// Wrapping horizontal layout for chips.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > maxWidth {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: min(widest, maxWidth), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

// MARK: - Inputs

/// Big centred amount field (web ExpenseForm "AMOUNT" hero).
struct AmountHeroField: View {
    @Binding var text: String
    var tint: Color = Theme.danger
    var label: String = "Amount"
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 8) {
            SectionLabel(label)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("$").font(.system(size: 28, weight: .semibold)).foregroundStyle(Theme.inkMuted)
                TextField("0.00", text: $text)
                    .keyboardType(.decimalPad)
                    .font(.money(44))
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.center)
                    .fixedSize()
                    .focused($focused)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
        .background(
            LinearGradient(colors: [tint.opacity(0.10), Theme.surface2], startPoint: .top, endPoint: .bottom),
            in: RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous)
        )
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous).strokeBorder(tint.opacity(0.18), lineWidth: 1))
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
    }
}

/// Labelled input wrapper (web `Input` label above field).
struct LabeledField<Content: View>: View {
    let label: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.inkSecondary)
            content
        }
    }
}

// MARK: - Buttons

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Theme.bg)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(configuration.isPressed ? Theme.mintBright : Theme.mint, in: RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous))
            .shadow(color: Theme.mintGlow, radius: 12)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(isEnabled ? 1 : 0.45)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    var tint: Color = Theme.inkSecondary
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(isEnabled ? 1 : 0.45)
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var primary: PrimaryButtonStyle { PrimaryButtonStyle() }
}

extension ButtonStyle where Self == SecondaryButtonStyle {
    static var secondary: SecondaryButtonStyle { SecondaryButtonStyle() }
    static var destructive: SecondaryButtonStyle { SecondaryButtonStyle(tint: Theme.danger) }
}

// MARK: - States

struct LoadingView: View {
    var message: String = "Loading…"

    var body: some View {
        VStack(spacing: 12) {
            ProgressView().tint(Theme.mint)
            Text(message).font(.footnote).foregroundStyle(Theme.inkMuted)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }
}

/// Yellow inline warning with optional retry (web "fail visibly" principle).
struct ErrorBanner: View {
    let message: String
    var retry: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.warning)
            Text(message).font(.footnote).foregroundStyle(Theme.ink).frame(maxWidth: .infinity, alignment: .leading)
            if let retry {
                Button("Retry", action: retry).font(.footnote.weight(.semibold)).foregroundStyle(Theme.warning)
            }
        }
        .tintedPanel(Theme.warning, padding: 12, radius: Theme.radiusMd)
    }
}

struct EmptyStateView<Actions: View>: View {
    let symbol: String
    let title: String
    let message: String
    var tint: Color = Theme.mint
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(spacing: 12) {
            IconTile(symbol: symbol, tint: tint, size: 56)
            Text(title).font(.display(18)).foregroundStyle(Theme.ink)
            Text(message).font(.subheadline).foregroundStyle(Theme.inkMuted).multilineTextAlignment(.center)
            actions
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .background(Theme.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous).strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [6, 4])))
    }
}

extension EmptyStateView where Actions == EmptyView {
    init(symbol: String, title: String, message: String, tint: Color = Theme.mint) {
        self.init(symbol: symbol, title: title, message: message, tint: tint) { EmptyView() }
    }
}

/// Simple horizontal progress bar (credit usage, goals, top categories).
struct ProgressBar: View {
    let value: Double // 0...1
    var tint: Color = Theme.mint
    var height: CGFloat = 8
    var marker: Double? = nil // optional 0...1 tick (e.g. month-start balance)

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.surface2)
                Capsule().fill(tint).frame(width: max(0, min(1, value)) * geo.size.width)
                if let marker {
                    Rectangle().fill(Color.white.opacity(0.4)).frame(width: 2).offset(x: max(0, min(1, marker)) * geo.size.width - 1)
                }
            }
        }
        .frame(height: height)
    }
}

// MARK: - Toast

struct ToastMessage: Equatable, Identifiable {
    enum Style { case success, error, info }
    let id = UUID()
    let text: String
    let style: Style

    var tint: Color {
        switch style {
        case .success: Theme.mint
        case .error: Theme.danger
        case .info: Theme.info
        }
    }

    var symbol: String {
        switch style {
        case .success: "checkmark.circle.fill"
        case .error: "xmark.octagon.fill"
        case .info: "info.circle.fill"
        }
    }
}

/// Draws `AppModel.toast` at the top of whatever view it's applied to (root and every sheet).
struct ToastOverlay: ViewModifier {
    @Environment(AppModel.self) private var model

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if let toast = model.toast {
                    ToastView(toast: toast)
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .id(toast.id)
                }
            }
            .animation(.spring(duration: 0.35), value: model.toast)
    }
}

struct ToastView: View {
    let toast: ToastMessage

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: toast.symbol).foregroundStyle(toast.tint)
            Text(toast.text).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(toast.tint.opacity(0.35), lineWidth: 1))
        .shadow(color: .black.opacity(0.4), radius: 16, y: 8)
    }
}
