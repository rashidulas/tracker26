import SwiftUI
import UIKit

/// Create / edit a category with live preview, emoji + colour presets and subcategories
/// (mirrors `app/categories/CategoryForm.tsx`).
struct CategoryFormSheet: View {
    let category: Category?

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var type: CategoryType
    @State private var emoji: String
    @State private var colorHex: String
    @State private var subcategories: [String]
    @State private var newSubcategory = ""
    @State private var isSaving = false
    @State private var errorText: String?
    @FocusState private var subFieldFocused: Bool

    init(category: Category?, defaultType: CategoryType) {
        self.category = category
        _name = State(initialValue: category?.name ?? "")
        _type = State(initialValue: category?.type ?? defaultType)
        _emoji = State(initialValue: category?.icon?.nilIfBlank ?? "📁")
        _colorHex = State(initialValue: category?.color.nilIfBlank ?? Theme.palette[0])
        _subcategories = State(initialValue: category?.subcategories.map(\.name) ?? [])
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var color: Color { Color(hex: colorHex) }
    private var displayEmoji: String { emoji.nilIfBlank ?? "📁" }
    private var isValid: Bool { !trimmedName.isEmpty }

    private var colorBinding: Binding<Color> {
        Binding(get: { Color(hex: colorHex) }, set: { colorHex = $0.categoryHexString })
    }

    private var canAddSub: Bool {
        guard let s = newSubcategory.nilIfBlank else { return false }
        return !subcategories.contains { $0.caseInsensitiveCompare(s) == .orderedSame }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    preview
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)

                Section("Name") {
                    TextField("e.g. Car, Groceries, Salary", text: $name)
                        .textInputAutocapitalization(.words)
                        .appRow()
                }

                Section("Type") {
                    Picker("Type", selection: $type) {
                        Text("Expense").tag(CategoryType.EXPENSE)
                        Text("Income").tag(CategoryType.INCOME)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .appRow()
                }

                Section("Icon") {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 6), spacing: 8) {
                        ForEach(Theme.emojiPresets, id: \.self) { preset in
                            let selected = displayEmoji == preset
                            Button {
                                emoji = preset
                            } label: {
                                Text(preset)
                                    .font(.system(size: 22))
                                    .frame(maxWidth: .infinity, minHeight: 44)
                                    .background(selected ? color.opacity(0.2) : Theme.surface2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .strokeBorder(selected ? color.opacity(0.7) : Theme.border, lineWidth: 1)
                                    )
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                    .padding(.vertical, 6)
                    .appRow()

                    HStack {
                        Text("Custom emoji").foregroundStyle(Theme.ink)
                        Spacer()
                        TextField("🙂", text: $emoji)
                            .multilineTextAlignment(.trailing)
                            .font(.system(size: 22))
                            .frame(width: 80)
                    }
                    .appRow()
                }

                Section("Colour") {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 5), spacing: 12) {
                        ForEach(Theme.palette, id: \.self) { hex in
                            let selected = colorHex.lowercased() == hex.lowercased()
                            Button {
                                colorHex = hex
                            } label: {
                                Circle()
                                    .fill(Color(hex: hex))
                                    .frame(width: 34, height: 34)
                                    .overlay {
                                        if selected {
                                            Image(systemName: "checkmark")
                                                .font(.system(size: 13, weight: .bold))
                                                .foregroundStyle(Theme.bg)
                                        }
                                    }
                                    .padding(3)
                                    .overlay(Circle().strokeBorder(selected ? Color.white.opacity(0.8) : .clear, lineWidth: 2))
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel(hex)
                        }
                    }
                    .padding(.vertical, 6)
                    .appRow()

                    ColorPicker("Custom colour", selection: colorBinding, supportsOpacity: false)
                        .foregroundStyle(Theme.ink)
                        .appRow()
                }

                Section {
                    if !subcategories.isEmpty {
                        FlowLayout(spacing: 8) {
                            ForEach(subcategories, id: \.self) { sub in
                                HStack(spacing: 6) {
                                    Text(sub)
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundStyle(Theme.ink)
                                    Button {
                                        subcategories.removeAll { $0 == sub }
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .font(.system(size: 14))
                                            .foregroundStyle(Theme.inkMuted)
                                    }
                                    .buttonStyle(.borderless)
                                    .accessibilityLabel("Remove \(sub)")
                                }
                                .padding(.leading, 10)
                                .padding(.trailing, 6)
                                .padding(.vertical, 6)
                                .background(color.opacity(0.14), in: Capsule())
                                .overlay(Capsule().strokeBorder(color.opacity(0.35), lineWidth: 1))
                            }
                        }
                        .padding(.vertical, 6)
                        .appRow()
                    }

                    HStack(spacing: 8) {
                        TextField("Add subcategory", text: $newSubcategory)
                            .textInputAutocapitalization(.words)
                            .focused($subFieldFocused)
                            .submitLabel(.done)
                            .onSubmit(addSubcategory)
                        Button(action: addSubcategory) {
                            Image(systemName: "plus.circle.fill")
                                .font(.system(size: 22))
                                .foregroundStyle(canAddSub ? Theme.mint : Theme.inkMuted)
                        }
                        .buttonStyle(.borderless)
                        .disabled(!canAddSub)
                        .accessibilityLabel("Add subcategory")
                    }
                    .appRow()
                } header: {
                    Text("Subcategories")
                } footer: {
                    if category != nil {
                        Text("Removing a subcategory clears it from transactions that used it.")
                    } else {
                        Text("Optional, e.g. Fuel and Insurance under Car.")
                    }
                }

                if let errorText {
                    Section {
                        Label(errorText, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(Theme.danger)
                            .appRow()
                    }
                }
            }
            .appFormStyle()
            .navigationTitle(category == nil ? "New Category" : "Edit Category")
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: emoji) { _, newValue in
                // Keep a single emoji: typing a new one replaces the old.
                if newValue.count > 1 { emoji = String(newValue.suffix(1)) }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView().tint(Theme.mint)
                    } else {
                        Button("Save") { Task { await save() } }
                            .fontWeight(.semibold)
                            .disabled(!isValid)
                    }
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
    }

    private var preview: some View {
        let subCount = subcategories.count
        return HStack(spacing: 14) {
            Text(displayEmoji)
                .font(.system(size: 28))
                .frame(width: 56, height: 56)
                .background(color.opacity(0.18), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.white.opacity(0.1), lineWidth: 1))
            VStack(alignment: .leading, spacing: 3) {
                SectionLabel("Preview")
                Text(trimmedName.isEmpty ? "New category" : trimmedName)
                    .font(.display(18))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    CategoryTypeBadge(type: type)
                    if subCount > 0 {
                        Text("\(subCount) subcategor\(subCount == 1 ? "y" : "ies")")
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.inkSecondary)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: [color.opacity(0.16), Theme.surface2], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous)
        )
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous).strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
        .animation(.easeOut(duration: 0.2), value: colorHex)
    }

    private func addSubcategory() {
        guard canAddSub, let s = newSubcategory.nilIfBlank else { return }
        subcategories.append(s)
        newSubcategory = ""
        subFieldFocused = true
    }

    private func save() async {
        guard isValid else { return }
        var subs = subcategories
        // Include a typed-but-not-added subcategory so it isn't silently lost.
        if canAddSub, let pending = newSubcategory.nilIfBlank { subs.append(pending) }

        let input = CategoryInput(
            name: trimmedName,
            type: type,
            color: colorHex,
            icon: emoji.nilIfBlank,
            subcategories: subs
        )
        isSaving = true
        errorText = nil
        defer { isSaving = false }
        do {
            if let category {
                _ = try await model.api.updateCategory(category.id, input)
            } else {
                _ = try await model.api.createCategory(input)
            }
            model.didMutate()
            model.showToast(category == nil ? "Category created" : "Category updated")
            dismiss()
        } catch is CancellationError {
        } catch {
            errorText = error.localizedDescription
        }
    }
}

private extension Color {
    /// `#rrggbb` (sRGB, clamped) for storing colours picked with `ColorPicker`.
    var categoryHexString: String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
        func byte(_ v: CGFloat) -> Int { Int((max(0, min(1, v)) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", byte(r), byte(g), byte(b))
    }
}
