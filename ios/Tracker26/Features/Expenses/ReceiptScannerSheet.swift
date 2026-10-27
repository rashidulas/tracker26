import PhotosUI
import SwiftUI

/// Pick / take a receipt photo → Gemini scan → review → save as an expense. Never auto-saves.
struct ReceiptScannerSheet: View {
    private enum Step {
        case pick
        case scanning
        case review(ReceiptScan)
        case failed(title: String, message: String)
    }

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var step: Step = .pick
    @State private var photoItem: PhotosPickerItem?
    @State private var showCamera = false
    @State private var image: MediaImage.Prepared?
    @State private var scanTask: Task<Void, Never>?

    // Review form
    @State private var date = Format.todayString()
    @State private var amountText = ""
    @State private var categoryId: String?
    @State private var accountId: String?
    @State private var merchant = ""
    @State private var notes = ""
    @State private var tagsText = ""
    @State private var isSaving = false

    private var amount: Double? { LedgerAmount.parse(amountText) }
    private var canSave: Bool {
        guard case .review = step, !isSaving, let amount, amount > 0, categoryId != nil, Format.day(date) != nil else { return false }
        return true
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    switch step {
                    case .pick: pickView
                    case .scanning: scanningView
                    case let .review(scan): reviewView(scan)
                    case let .failed(title, message): failedView(title: title, message: message)
                    }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.surface)
            .navigationTitle("Scan Receipt")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        scanTask?.cancel()
                        dismiss()
                    }
                    .foregroundStyle(Theme.inkSecondary)
                }
                if case .review = step {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save", action: save).disabled(!canSave).foregroundStyle(canSave ? Theme.mint : Theme.inkMuted)
                    }
                }
            }
            .interactiveDismissDisabled(isSaving)
        }
        .appSheet()
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            photoItem = nil
            Task {
                guard let ui = await MediaImage.load(item) else {
                    step = .failed(title: "Couldn't open photo", message: "That image couldn't be loaded. Try another one.")
                    return
                }
                await startScan(ui)
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            MediaCameraPicker { ui in
                Task { await startScan(ui) }
            }
            .ignoresSafeArea()
        }
    }

    // MARK: Steps

    private var pickView: some View {
        VStack(spacing: 16) {
            VStack(spacing: 12) {
                IconTile(symbol: "doc.text.viewfinder", tint: Theme.mint, size: 64)
                Text("Scan a receipt").font(.display(20)).foregroundStyle(Theme.ink)
                Text("We'll read the merchant, date, total and category. You review everything before it's saved.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.inkMuted)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)

            if MediaCameraPicker.isAvailable {
                Button {
                    showCamera = true
                } label: {
                    Label("Take Photo", systemImage: "camera")
                }
                .buttonStyle(.primary)
            }

            PhotosPicker(selection: $photoItem, matching: .images) {
                Label("Choose from Photos", systemImage: "photo.on.rectangle")
            }
            .buttonStyle(SecondaryButtonStyle(tint: MediaCameraPicker.isAvailable ? Theme.inkSecondary : Theme.mint))
        }
    }

    private var scanningView: some View {
        VStack(spacing: 18) {
            thumbnail(height: 260)
                .overlay {
                    RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous)
                        .fill(Theme.bg.opacity(0.45))
                    ProgressView().controlSize(.large).tint(Theme.mint)
                }
            Text("Scanning receipt…").font(.system(size: 16, weight: .medium)).foregroundStyle(Theme.ink)
            Text("This usually takes a few seconds.").font(.footnote).foregroundStyle(Theme.inkMuted)
        }
        .frame(maxWidth: .infinity)
    }

    private func failedView(title: String, message: String) -> some View {
        VStack(spacing: 16) {
            if image != nil { thumbnail(height: 180) }
            VStack(spacing: 8) {
                IconTile(symbol: "exclamationmark.triangle", tint: Theme.danger, size: 48)
                Text(title).font(.display(18)).foregroundStyle(Theme.ink)
                Text(message).font(.subheadline).foregroundStyle(Theme.inkSecondary).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .tintedPanel(Theme.danger)

            if let image {
                Button("Retry") {
                    Task { await scan(image) }
                }
                .buttonStyle(.primary)
            }
            Button("Choose another photo") { reset() }
                .buttonStyle(.secondary)
        }
    }

    private func reviewView(_ scan: ReceiptScan) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .center, spacing: 12) {
                if let image {
                    Image(uiImage: image.image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 56, height: 56)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSm, style: .continuous))
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Review scan").font(.display(17)).foregroundStyle(Theme.ink)
                    LedgerConfidenceBadge(confidence: scan.confidence)
                }
                Spacer()
            }

            if scan.confidence == .low {
                Text("Low confidence — double-check the amount and category.")
                    .font(.footnote)
                    .foregroundStyle(Theme.warning)
            }

            AmountHeroField(text: $amountText, tint: Theme.danger)

            LedgerDayPicker(day: $date)

            VStack(alignment: .leading, spacing: 10) {
                SectionLabel("Category")
                FlowLayout(spacing: 8) {
                    ForEach(model.regularExpenseCategories) { category in
                        Chip(label: category.name, emoji: category.emoji, color: category.swiftColor, isSelected: categoryId == category.id) {
                            categoryId = category.id
                        }
                    }
                }
                if categoryId == nil {
                    Text(scan.category.map { "Couldn't match “\($0)” — pick a category." } ?? "Pick a category.")
                        .font(.footnote)
                        .foregroundStyle(Theme.warning)
                }
            }

            LabeledField(label: "Account") {
                LedgerAccountMenu(selection: $accountId, accounts: model.accounts, noneLabel: "No account")
            }
            LabeledField(label: "Merchant") {
                LedgerTextField(placeholder: "e.g. Walmart", text: $merchant, capitalization: .words)
            }
            LabeledField(label: "Notes") {
                LedgerTextArea(placeholder: "Add notes…", text: $notes)
            }
            LabeledField(label: "Tags (comma-separated)") {
                LedgerTextField(placeholder: "e.g. business, deductible", text: $tagsText, capitalization: .never)
            }

            if !scan.items.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    SectionLabel("Detected items (\(scan.items.count))")
                    VStack(spacing: 0) {
                        ForEach(Array(scan.items.enumerated()), id: \.offset) { index, item in
                            HStack(alignment: .firstTextBaseline) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.name).font(.system(size: 14)).foregroundStyle(Theme.ink)
                                    if let s = item.suggestedCategory?.nilIfBlank {
                                        Text(s).font(.system(size: 11)).foregroundStyle(Theme.inkMuted)
                                    }
                                }
                                Spacer(minLength: 8)
                                MoneyText(value: item.amount, size: 14, weight: .medium, color: Theme.inkSecondary)
                            }
                            .padding(.vertical, 8)
                            if index < scan.items.count - 1 { Divider().overlay(Theme.borderSubtle) }
                        }
                    }
                    .panel(padding: 12, radius: Theme.radiusMd)
                }
            }

            Button(action: save) {
                HStack(spacing: 8) {
                    if isSaving { ProgressView().tint(Theme.bg) }
                    Text("Add Expense")
                }
            }
            .buttonStyle(.primary)
            .disabled(!canSave)

            Button("Scan another") { reset() }
                .buttonStyle(.secondary)
                .disabled(isSaving)
        }
    }

    @ViewBuilder
    private func thumbnail(height: CGFloat) -> some View {
        if let image {
            Image(uiImage: image.image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: height)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous))
        }
    }

    // MARK: Actions

    private func reset() {
        scanTask?.cancel()
        image = nil
        step = .pick
    }

    private func startScan(_ ui: UIImage) async {
        step = .scanning
        guard let prepared = await MediaImage.prepare(ui) else {
            step = .failed(title: "Couldn't read photo", message: "That image couldn't be processed. Try another one.")
            return
        }
        image = prepared
        await scan(prepared)
    }

    private func scan(_ prepared: MediaImage.Prepared) async {
        scanTask?.cancel()
        step = .scanning
        let task = Task {
            do {
                let result = try await model.api.scanReceipt(jpegBase64: prepared.base64)
                if Task.isCancelled { return }
                apply(result)
                step = .review(result)
            } catch is CancellationError {
                return
            } catch let APIError.server(status, message) where status == 422 {
                step = .failed(title: "Not a receipt", message: message)
            } catch {
                if Task.isCancelled { return }
                step = .failed(title: "Scan failed", message: error.localizedDescription)
            }
        }
        scanTask = task
        await task.value
    }

    private func apply(_ scan: ReceiptScan) {
        date = scan.date.flatMap { Format.day($0) != nil ? String($0.prefix(10)) : nil } ?? Format.todayString()
        amountText = scan.totalAmount.map(LedgerAmount.text) ?? ""
        categoryId = scan.category.flatMap(matchCategory)
        if accountId == nil { accountId = model.accounts.first?.id }
        merchant = scan.merchant ?? ""
        notes = scan.notes ?? ""
        tagsText = LedgerTags.join(scan.tags)
    }

    /// Exact (case-insensitive) → partial contains → keyword map, among regular expense categories.
    private func matchCategory(_ name: String) -> String? {
        let normalized = name.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return nil }
        let categories = model.regularExpenseCategories
        if let exact = categories.first(where: { $0.name.lowercased() == normalized }) { return exact.id }
        if let partial = categories.first(where: {
            let c = $0.name.lowercased()
            return c.contains(normalized) || normalized.contains(c)
        }) { return partial.id }

        let keywordMap: [(String, [String])] = [
            ("groceries", ["grocery", "supermarket", "market", "food", "produce"]),
            ("dining out", ["restaurant", "cafe", "coffee", "fast food", "takeout", "dine"]),
            ("transportation", ["gas", "uber", "lyft", "taxi", "parking", "bus", "train"]),
            ("utilities", ["electric", "water", "internet", "phone", "utility"]),
            ("healthcare", ["pharmacy", "doctor", "medical", "prescription", "health"]),
            ("entertainment", ["movie", "game", "stream", "netflix", "spotify", "concert"]),
            ("shopping", ["amazon", "clothing", "electronics", "online", "shop", "store"]),
            ("travel", ["flight", "hotel", "airbnb", "vacation"]),
            ("education", ["course", "book", "tuition", "school"]),
            ("insurance", ["insurance"]),
        ]
        for (key, keywords) in keywordMap where keywords.contains(where: { normalized.contains($0) }) {
            if let found = categories.first(where: { $0.name.lowercased() == key }) { return found.id }
        }
        return nil
    }

    private func save() {
        guard canSave, let amount, let categoryId else { return }
        isSaving = true
        let input = ExpenseInput(
            date: date,
            amount: amount,
            categoryId: categoryId,
            subcategoryId: nil,
            accountId: accountId,
            merchantOrSource: merchant.nilIfBlank,
            notes: notes.nilIfBlank,
            tags: LedgerTags.parse(tagsText)
        )
        Task {
            defer { isSaving = false }
            do {
                _ = try await model.api.createExpense(input)
                model.didMutate()
                model.showToast("Expense added")
                dismiss()
            } catch {
                model.showError(error)
            }
        }
    }
}
