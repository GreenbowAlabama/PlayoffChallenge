import SwiftUI

struct TermsOfServiceView: View {
    @EnvironmentObject var authService: AuthService
    @Environment(\.dismiss) var dismiss

    @State private var tosContent = ""
    @State private var tosVersion = ""
    @State private var hasAgreed = false
    @State private var isLoading = true
    @State private var isAccepting = false
    @State private var showError = false
    @State private var errorMessage = ""

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                Text("Terms of Service")
                    .font(.title)
                    .bold()
                    .padding()

                if isLoading {
                    Spacer()
                    ProgressView("Loading Terms...")
                    Spacer()
                } else {
                    ScrollView {
                        Text(tosContent)
                            .padding()
                            .font(.system(size: 14))
                    }
                    .frame(maxHeight: .infinity)

                    Divider()

                    VStack(spacing: 15) {
                        Toggle(isOn: $hasAgreed) {
                            Text("I have read and agree to the Terms of Service")
                                .font(.subheadline)
                        }
                        .padding(.horizontal)

                        Button(action: {
                            Task {
                                await acceptTOS()
                            }
                        }) {
                            if isAccepting {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                    .frame(maxWidth: .infinity)
                            } else {
                                Text("Accept")
                                    .font(.headline)
                                    .foregroundColor(.white)
                                    .frame(maxWidth: .infinity)
                                    .padding()
                            }
                        }
                        .background(hasAgreed ? DesignTokens.Color.Action.secondary : DesignTokens.Color.Action.disabled)
                        .cornerRadius(DesignTokens.Radius.lg)
                        .disabled(!hasAgreed || isAccepting)
                        .padding(.horizontal)
                        .padding(.bottom, 20)
                    }
                }
            }
            .navigationBarHidden(true)
        }
        .task {
            await loadTOS()
        }
        .alert("Error", isPresented: $showError) {
            Button("OK") { }
        } message: {
            Text(errorMessage)
        }
    }

    func loadTOS() async {
        do {
            let (content, version) = try await APIService.shared.getTermsOfService()
            await MainActor.run {
                tosContent = content
                tosVersion = version
                isLoading = false
            }
        } catch {
            await MainActor.run {
                errorMessage = "Failed to load Terms of Service: \(error.localizedDescription)"
                showError = true
                isLoading = false
            }
        }
    }

    func acceptTOS() async {
        guard let userId = authService.currentUser?.id else { return }

        isAccepting = true

        do {
            try await APIService.shared.acceptTermsOfService(userId: userId, tosVersion: tosVersion)
            await MainActor.run {
                authService.needsToAcceptTOS = false
                dismiss()
            }
        } catch {
            await MainActor.run {
                errorMessage = "Failed to accept Terms: \(error.localizedDescription)"
                showError = true
                isAccepting = false
            }
        }
    }
}

#Preview {
    TermsOfServiceView()
        .environmentObject(AuthService())
}
