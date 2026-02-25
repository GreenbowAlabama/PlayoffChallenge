//
//  CreateUsernameView.swift
//  PlayoffChallenge
//
//  Create Username - Part of onboarding flow
//

import SwiftUI

struct CreateUsernameView: View {
    @EnvironmentObject var authService: AuthService
    @Environment(\.dismiss) var dismiss

    @State private var username: String
    @State private var isUpdating = false
    @State private var showError = false
    @State private var errorMessage = ""

    init() {
        // Initialize with the auto-generated username from current user
        _username = State(initialValue: "")
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 30) {
                Spacer()

                Image(systemName: "person.circle.fill")
                    .font(.system(size: 80))
                    .foregroundColor(.orange)

                Text("Create Your Username")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                Text("We've generated a username for you, but feel free to change it to something you prefer")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                Spacer()

                VStack(alignment: .leading, spacing: 10) {
                    Text("Username")
                        .font(.headline)

                    TextField("Username", text: $username)
                        .textContentType(.username)
                        .autocapitalization(.none)
                        .textFieldStyle(.roundedBorder)
                        .padding(.horizontal)

                    Text("Your username will be visible on the leaderboard")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(.horizontal)
                }
                .padding()

                Spacer()

                Button(action: {
                    Task {
                        await continueToNextStep()
                    }
                }) {
                    if isUpdating {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            .frame(maxWidth: .infinity)
                    } else {
                        Text("Continue")
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding()
                    }
                }
                .background(username.isEmpty ? Color.gray : Color.blue)
                .cornerRadius(DesignTokens.Radius.lg)
                .disabled(username.isEmpty || isUpdating)
                .padding(.horizontal)
                .padding(.bottom, 20)
            }
            .padding()
            .navigationBarHidden(true)
        }
        .onAppear {
            // Set the username from current user when view appears
            if let currentUsername = authService.currentUser?.username {
                username = currentUsername
            }
        }
        .alert("Error", isPresented: $showError) {
            Button("OK") { }
        } message: {
            Text(errorMessage)
        }
    }

    func continueToNextStep() async {
        guard let userId = authService.currentUser?.id else {
            errorMessage = "User not found"
            showError = true
            return
        }

        isUpdating = true

        do {
            // Update the username if it was changed
            let updatedUser = try await APIService.shared.updateUserProfile(
                userId: userId,
                username: username,
                email: nil,
                phone: nil,
                name: nil
            )

            // Re-check TOS flags before completing onboarding
            // This ensures new users see TOS gate if required
            await authService.checkTOSFlags(userId: userId)

            await MainActor.run {
                authService.currentUser = updatedUser
                authService.needsUsernameSetup = false
                isUpdating = false
                dismiss()
            }
        } catch {
            await MainActor.run {
                errorMessage = "Failed to update username: \(error.localizedDescription)"
                showError = true
                isUpdating = false
            }
        }
    }
}

#Preview {
    CreateUsernameView()
        .environmentObject(AuthService())
}
