import PhotosUI
import SwiftUI
import UIKit

/// AI finance assistant (web `FinanceAssistant`): text, photos and hold-to-talk voice.
/// Replies can carry an expense / income draft the user confirms or discards.
struct ChatView: View {
    @Environment(AppModel.self) private var model

    @State private var messages: [ChatUIMessage] = [.welcome]
    @State private var input = ""
    @State private var pendingImage: ChatPendingImage?
    @State private var isPreparingImage = false
    @State private var isSending = false
    @State private var isTranscribing = false
    @State private var confirmingId: UUID?
    @State private var conversationID = UUID()

    @State private var recorder = ChatVoiceRecorder()
    @GestureState private var orbPressed = false

    @State private var photoItem: PhotosPickerItem?
    @State private var showPhotoPicker = false
    @State private var showCamera = false
    @FocusState private var inputFocused: Bool

    private static let bottomID = "chat-bottom"

    private var canSend: Bool {
        !isSending && !isTranscribing && !recorder.isRecording && !isPreparingImage
            && (input.nilIfBlank != nil || pendingImage != nil)
    }

    private var orbPhase: ChatOrb.Phase {
        if recorder.isRecording { return .listening }
        if isTranscribing || isSending { return .busy }
        return .idle
    }

    private var statusText: String {
        if recorder.isRecording { return "Listening… release to send" }
        if isTranscribing { return "Transcribing…" }
        if isSending { return "Thinking…" }
        return "Hold to talk · or type below"
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(messages) { message in
                        messageRow(message).id(message.id)
                    }
                    if messages.count == 1 && !isSending { suggestions }
                    if isSending { ChatTypingBubble() }
                    Color.clear.frame(height: 1).id(Self.bottomID)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: messages.count) { _, _ in scrollToBottom(proxy) }
            .onChange(of: messages.last?.content) { _, _ in scrollToBottom(proxy) }
            .onChange(of: isSending) { _, _ in scrollToBottom(proxy) }
            .onChange(of: inputFocused) { _, focused in
                guard focused else { return }
                Task {
                    try? await Task.sleep(for: .milliseconds(300))
                    scrollToBottom(proxy)
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .appScreen()
        .navigationTitle("Chat")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: newChat) {
                    Label("New chat", systemImage: "square.and.pencil")
                }
                .disabled(messages.count <= 1 && input.isEmpty && pendingImage == nil)
            }
        }
        .photosPicker(isPresented: $showPhotoPicker, selection: $photoItem, matching: .images)
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            photoItem = nil
            Task {
                isPreparingImage = true
                defer { isPreparingImage = false }
                guard let ui = await MediaImage.load(item) else {
                    model.showToast("Couldn't load that photo", style: .error)
                    return
                }
                await attach(ui)
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            MediaCameraPicker { ui in
                Task { await attach(ui) }
            }
            .ignoresSafeArea()
        }
        .onChange(of: orbPressed) { _, pressed in
            if pressed { orbPressBegan() } else { orbPressEnded() }
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: recorder.isRecording)
        .onDisappear { if recorder.isRecording { recorder.cancel() } }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo(Self.bottomID, anchor: .bottom) }
    }

    // MARK: Messages

    @ViewBuilder
    private func messageRow(_ message: ChatUIMessage) -> some View {
        if message.role == .user {
            HStack {
                Spacer(minLength: 48)
                VStack(alignment: .trailing, spacing: 8) {
                    if let preview = message.preview {
                        Image(uiImage: preview)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 180, height: 140)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous))
                    }
                    if !message.content.isEmpty {
                        Text(message.content)
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.ink)
                            .textSelection(.enabled)
                    }
                }
                .padding(12)
                .background(Theme.mintDim, in: RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous).strokeBorder(Theme.mint.opacity(0.35), lineWidth: 1))
            }
        } else {
            HStack {
                VStack(alignment: .leading, spacing: 10) {
                    Text(Self.markdown(message.content))
                        .font(.system(size: 15))
                        .foregroundStyle(message.isError ? Theme.danger : Theme.ink)
                        .tint(Theme.mint)
                        .textSelection(.enabled)
                    if let draft = message.draft {
                        draftCard(draft, messageID: message.id)
                    }
                }
                .padding(12)
                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous).strokeBorder(Theme.borderSubtle, lineWidth: 1))
                Spacer(minLength: 32)
            }
        }
    }

    private static func markdown(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }

    private func categoryName(_ draft: AssistantDraft) -> String? {
        draft.categoryName?.nilIfBlank ?? model.category(draft.categoryId)?.name
    }

    private func accountName(_ draft: AssistantDraft) -> String? {
        draft.accountName?.nilIfBlank ?? model.account(draft.accountId)?.name
    }

    private func draftCard(_ draft: AssistantDraft, messageID: UUID) -> some View {
        let isIncome = draft.kind == .INCOME
        let color = isIncome ? Theme.mint : Theme.danger
        let meta = [categoryName(draft), Format.shortDate(draft.date), accountName(draft), draft.merchantOrSource?.nilIfBlank]
            .compactMap { $0 }
            .joined(separator: " · ")
        let isConfirming = confirmingId == messageID

        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionLabel(isIncome ? "Income draft" : "Expense draft", color: color)
                Spacer()
                LedgerConfidenceBadge(confidence: draft.confidence)
            }
            Text((isIncome ? "+" : "−") + Format.money(draft.amount))
                .font(.money(18))
                .foregroundStyle(color)
            Text(meta)
                .font(.system(size: 12))
                .foregroundStyle(Theme.inkSecondary)
            if let notes = draft.notes?.nilIfBlank {
                Text(notes).font(.system(size: 12)).foregroundStyle(Theme.inkMuted)
            }
            if !draft.tags.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(draft.tags, id: \.self) { Pill(text: $0) }
                }
            }
            HStack(spacing: 8) {
                Button {
                    confirm(draft, messageID: messageID)
                } label: {
                    HStack(spacing: 6) {
                        if isConfirming { ProgressView().controlSize(.small).tint(Theme.bg) } else { Image(systemName: "checkmark") }
                        Text("Confirm")
                    }
                }
                .buttonStyle(ChatCompactButtonStyle(prominent: true))
                .disabled(confirmingId != nil)

                Button {
                    discard(messageID)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "xmark")
                        Text("Discard")
                    }
                }
                .buttonStyle(ChatCompactButtonStyle(prominent: false))
                .disabled(isConfirming)
            }
            .padding(.top, 2)
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusMd, style: .continuous).strokeBorder(color.opacity(0.3), lineWidth: 1))
    }

    private var suggestions: some View {
        FlowLayout(spacing: 8) {
            ForEach(["What's my total balance?", "How much did I spend this month?", "Who owes me money?"], id: \.self) { s in
                Button {
                    Task { await send(text: s, image: nil) }
                } label: {
                    Text(s)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.inkSecondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Theme.surface, in: Capsule())
                        .overlay(Capsule().strokeBorder(Theme.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: Composer

    private var composer: some View {
        VStack(spacing: 8) {
            if pendingImage != nil || isPreparingImage {
                HStack {
                    pendingThumbnail
                    Spacer()
                }
            }

            HStack(alignment: .bottom, spacing: 10) {
                Menu {
                    Button { showPhotoPicker = true } label: { Label("Photo Library", systemImage: "photo.on.rectangle") }
                    if MediaCameraPicker.isAvailable {
                        Button { showCamera = true } label: { Label("Take Photo", systemImage: "camera") }
                    }
                } label: {
                    Image(systemName: "photo.badge.plus")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(Theme.inkSecondary)
                        .frame(width: 42, height: 42)
                        .background(Theme.surface2, in: Circle())
                        .overlay(Circle().strokeBorder(Theme.border, lineWidth: 1))
                }
                .accessibilityLabel("Attach photo")
                .padding(.bottom, 5)

                HStack(alignment: .bottom, spacing: 6) {
                    TextField("Ask about balances, or log an expense / income…", text: $input, axis: .vertical)
                        .lineLimit(1 ... 5)
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.ink)
                        .focused($inputFocused)
                        .padding(.vertical, 10)
                    Button {
                        let text = input
                        let image = pendingImage
                        Task { await send(text: text, image: image) }
                    } label: {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Theme.bg)
                            .frame(width: 32, height: 32)
                            .background(canSend ? Theme.mint : Theme.mint.opacity(0.3), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!canSend)
                    .padding(.bottom, 5)
                    .accessibilityLabel("Send")
                }
                .padding(.leading, 14)
                .padding(.trailing, 5)
                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 21, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 21, style: .continuous).strokeBorder(inputFocused ? Theme.mint.opacity(0.5) : Theme.border, lineWidth: 1))

                ChatOrb(state: orbPhase, size: 52)
                    .opacity(isSending || isTranscribing ? 0.75 : 1)
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .updating($orbPressed) { _, pressed, _ in pressed = true }
                    )
                    .accessibilityLabel("Hold to talk")
                    .accessibilityAddTraits(.isButton)
            }

            HStack(spacing: 6) {
                if recorder.isRecording {
                    Circle().fill(Theme.danger).frame(width: 6, height: 6)
                } else if isTranscribing || isSending {
                    ProgressView().controlSize(.mini).tint(Theme.inkMuted)
                }
                Text(statusText)
            }
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(recorder.isRecording ? Theme.mint : Theme.inkMuted)
            .animation(.easeInOut(duration: 0.2), value: statusText)
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background {
            Rectangle()
                .fill(Theme.bg.opacity(0.92))
                .background(.ultraThinMaterial)
                .overlay(alignment: .top) { Rectangle().fill(Theme.borderSubtle).frame(height: 1) }
                .ignoresSafeArea(edges: .bottom)
        }
    }

    @ViewBuilder
    private var pendingThumbnail: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let pendingImage {
                    Image(uiImage: pendingImage.preview)
                        .resizable()
                        .scaledToFill()
                } else {
                    ZStack {
                        Theme.surface2
                        ProgressView().tint(Theme.mint)
                    }
                }
            }
            .frame(width: 64, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSm, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusSm, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))

            if pendingImage != nil {
                Button {
                    pendingImage = nil
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Theme.ink)
                        .frame(width: 22, height: 22)
                        .background(Theme.bgElevated, in: Circle())
                        .overlay(Circle().strokeBorder(Theme.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .offset(x: 7, y: -7)
                .accessibilityLabel("Remove photo")
            }
        }
        .padding(.top, 6)
    }

    // MARK: Actions

    private func newChat() {
        if recorder.isRecording { recorder.cancel() }
        conversationID = UUID()
        messages = [.welcome]
        input = ""
        pendingImage = nil
        isSending = false
        isTranscribing = false
        confirmingId = nil
    }

    private func attach(_ ui: UIImage) async {
        isPreparingImage = true
        defer { isPreparingImage = false }
        guard let prepared = await MediaImage.prepare(ui) else {
            model.showToast("Couldn't process that photo", style: .error)
            return
        }
        pendingImage = ChatPendingImage(
            preview: prepared.image,
            payload: ChatImage(dataUrl: prepared.dataURL, mimeType: "image/jpeg")
        )
    }

    private func send(text: String, image: ChatPendingImage?) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || image != nil, !isSending else { return }

        let convo = conversationID
        messages.append(ChatUIMessage(
            role: .user,
            content: trimmed.isEmpty ? "Please review this image." : trimmed,
            preview: image?.preview,
            image: image?.payload
        ))
        input = ""
        pendingImage = nil
        isSending = true
        defer { if conversationID == convo { isSending = false } }

        let history = messages.filter { !$0.isLocal }
        let payload = history.enumerated().map { index, m in
            ChatMessagePayload(
                role: m.role.rawValue,
                content: m.content,
                image: index == history.count - 1 && m.role == .user ? m.image : nil
            )
        }

        do {
            let response = try await model.api.chat(payload)
            guard conversationID == convo else { return }
            if response.draft != nil {
                for i in messages.indices where messages[i].draft != nil { messages[i].draft = nil }
            }
            let content = response.message.nilIfBlank
                ?? (response.draft != nil ? "Here's a draft — confirm to save it." : "…")
            messages.append(ChatUIMessage(role: .assistant, content: content, draft: response.draft))
        } catch is CancellationError {
        } catch {
            guard conversationID == convo else { return }
            model.showError(error)
            messages.append(ChatUIMessage(role: .assistant, content: "I hit a snag: \(error.localizedDescription)", isLocal: true, isError: true))
        }
    }

    private func confirm(_ draft: AssistantDraft, messageID: UUID) {
        guard confirmingId == nil else { return }
        confirmingId = messageID
        Task {
            defer { confirmingId = nil }
            do {
                _ = try await model.api.confirmDraft(draft)
                let isIncome = draft.kind == .INCOME
                model.showToast(isIncome ? "Income added" : "Expense added")
                model.didMutate()
                let account = accountName(draft).map { " to \($0)" } ?? ""
                let line = "Saved \(isIncome ? "income" : "expense") of \(Format.money(draft.amount))\(account)."
                for i in messages.indices {
                    if messages[i].id == messageID {
                        messages[i].draft = nil
                        messages[i].content += "\n\n" + line
                    } else if messages[i].draft != nil {
                        messages[i].draft = nil
                    }
                }
            } catch {
                model.showError(error)
            }
        }
    }

    private func discard(_ messageID: UUID) {
        guard let i = messages.firstIndex(where: { $0.id == messageID }) else { return }
        withAnimation(.snappy) { messages[i].draft = nil }
    }

    // MARK: Voice

    private func orbPressBegan() {
        guard !isSending, !isTranscribing else { return }
        inputFocused = false
        switch recorder.start() {
        case .started:
            break
        case .needsPermission:
            Task {
                if await recorder.requestPermission() {
                    model.showToast("Microphone ready — hold the orb to talk", style: .info)
                } else {
                    model.showToast("Microphone permission is required for voice input", style: .error)
                }
            }
        case .denied:
            model.showToast("Microphone access is off. Enable it in Settings → Tracker26.", style: .error)
        case let .failed(message):
            model.showToast(message, style: .error)
        }
    }

    private func orbPressEnded() {
        guard recorder.isRecording else { return }
        guard let clip = recorder.stop(), clip.duration >= 0.4 else {
            model.showToast("Hold the orb while you speak, then release", style: .info)
            return
        }
        isTranscribing = true
        let convo = conversationID
        Task {
            do {
                let result = try await model.api.transcribe(audio: clip.data)
                isTranscribing = false
                guard conversationID == convo else { return }
                guard let text = result.text.nilIfBlank else {
                    model.showToast("Didn't catch that — try again", style: .info)
                    return
                }
                await send(text: text, image: pendingImage)
            } catch {
                isTranscribing = false
                model.showError(error)
            }
        }
    }
}

// MARK: - Supporting types

struct ChatPendingImage {
    let preview: UIImage
    let payload: ChatImage
}

struct ChatUIMessage: Identifiable {
    enum Role: String { case user, assistant }

    let id = UUID()
    let role: Role
    var content: String
    var preview: UIImage? = nil
    var image: ChatImage? = nil
    var draft: AssistantDraft? = nil
    /// Local-only messages (welcome, errors) are never sent to the server.
    var isLocal = false
    var isError = false

    static let welcome = ChatUIMessage(
        role: .assistant,
        content: "Hey — I can see your accounts, balances, spending, income, friends, and loans. Ask me anything, or say something like “I spent $42 on groceries at Walmart” and I'll draft it for you to confirm.",
        isLocal: true
    )
}

private struct ChatTypingBubble: View {
    var body: some View {
        HStack {
            HStack(spacing: 8) {
                TimelineView(.animation) { timeline in
                    let t = timeline.date.timeIntervalSinceReferenceDate
                    HStack(spacing: 4) {
                        ForEach(0 ..< 3) { i in
                            let phase = (sin((t * 2 * .pi / 1.2) - Double(i) * 0.9) + 1) / 2
                            Circle()
                                .fill(Theme.mint)
                                .frame(width: 6, height: 6)
                                .opacity(0.35 + 0.65 * phase)
                                .offset(y: -2 * phase)
                        }
                    }
                }
                Text("Thinking…").font(.system(size: 14)).foregroundStyle(Theme.inkMuted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusLg, style: .continuous).strokeBorder(Theme.borderSubtle, lineWidth: 1))
            Spacer()
        }
        .transition(.opacity)
    }
}

private struct ChatCompactButtonStyle: ButtonStyle {
    let prominent: Bool
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(prominent ? Theme.bg : Theme.inkSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(
                prominent ? (configuration.isPressed ? Theme.mintBright : Theme.mint) : Theme.surface2,
                in: RoundedRectangle(cornerRadius: Theme.radiusSm + 2, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusSm + 2, style: .continuous)
                    .strokeBorder(prominent ? Color.clear : Theme.border, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(isEnabled ? 1 : 0.5)
    }
}
