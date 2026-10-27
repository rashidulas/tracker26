import SwiftUI

/// First-run connection screen: server URL + API token, verified against `/api/v1/health`.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var url = ""
    @State private var token = ""
    @State private var isConnecting = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 16) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(Theme.mintDim)
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.mint.opacity(0.25)))
                        Image(systemName: "wallet.bifold").font(.system(size: 22, weight: .semibold)).foregroundStyle(Theme.mint)
                    }
                    .frame(width: 52, height: 52)
                    .shadow(color: Theme.mintGlow, radius: 16)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Tracker26").font(.display(32)).foregroundStyle(Theme.ink)
                        Text("Your private picture of your money. Connect to your Tracker26 server to get started.")
                            .font(.subheadline).foregroundStyle(Theme.inkSecondary)
                    }
                }
                .padding(.top, 40)

                VStack(alignment: .leading, spacing: 16) {
                    LabeledField(label: "Server URL") {
                        TextField("", text: $url, prompt: Text("your-app.vercel.app").foregroundStyle(Theme.inkMuted))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                            .textContentType(.URL)
                            .fieldStyle()
                    }
                    LabeledField(label: "API token") {
                        SecureField("", text: $token, prompt: Text("MOBILE_API_TOKEN from your server").foregroundStyle(Theme.inkMuted))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .fieldStyle()
                    }
                    if let error { ErrorBanner(message: error) }

                    Button {
                        Task { await connect() }
                    } label: {
                        HStack(spacing: 8) {
                            if isConnecting { ProgressView().tint(Theme.bg) }
                            Text(isConnecting ? "Connecting…" : "Connect")
                        }
                    }
                    .buttonStyle(.primary)
                    .disabled(isConnecting || url.nilIfBlank == nil || token.nilIfBlank == nil)
                }
                .panel(padding: 20)

                VStack(alignment: .leading, spacing: 8) {
                    SectionLabel("How to connect")
                    Text("1. Deploy the Tracker26 web app (e.g. on Vercel).\n2. Set `MOBILE_API_TOKEN` to a long random string in its environment.\n3. Enter the app URL and that token here.")
                        .font(.footnote).foregroundStyle(Theme.inkMuted)
                }
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(AppBackground())
    }

    private func connect() async {
        isConnecting = true
        error = nil
        defer { isConnecting = false }
        do {
            try await model.connect(urlString: url, token: token)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
