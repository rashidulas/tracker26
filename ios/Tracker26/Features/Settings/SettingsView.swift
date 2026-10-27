import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var health: HealthResponse?
    @State private var healthError: String?
    @State private var isChecking = false
    @State private var confirmSignOut = false

    private var version: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(v) (\(b))"
    }

    var body: some View {
        Form {
            Section("Server") {
                LabeledContent("URL", value: model.serverURL?.absoluteString ?? "—")
                    .appRow()
                HStack {
                    Text("Status")
                    Spacer()
                    if isChecking {
                        ProgressView()
                    } else if let health {
                        Label("Connected · \(health.accounts) accounts", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(Theme.mint).font(.subheadline)
                    } else if let healthError {
                        Text(healthError).foregroundStyle(Theme.danger).font(.footnote).multilineTextAlignment(.trailing)
                    }
                }
                .appRow()
                Button("Test connection") { Task { await check() } }
                    .appRow()
            }

            Section {
                Button("Disconnect", role: .destructive) { confirmSignOut = true }
                    .appRow()
            } footer: {
                Text("Removes the server URL and API token from this device. Your data stays on the server.")
            }

            Section("About") {
                LabeledContent("Version", value: version).appRow()
            }
        }
        .appFormStyle()
        .navigationTitle("Settings")
        .task { await check() }
        .confirmationDialog("Disconnect from this server?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) { model.signOut() }
        }
    }

    private func check() async {
        isChecking = true
        defer { isChecking = false }
        do {
            health = try await model.api.health()
            healthError = nil
        } catch {
            health = nil
            healthError = error.localizedDescription
        }
    }
}
