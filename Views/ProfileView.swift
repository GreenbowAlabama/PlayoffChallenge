import SwiftUI
import Combine

struct ProfileView: View {
    @EnvironmentObject var authService: AuthService
    @StateObject private var viewModel = ProfileViewModel()
    @State private var showSaveSuccess = false
    @State private var showError = false
    @State private var errorMessage = ""
    @State private var showDeleteConfirmation = false
    @State private var isDeleting = false

    private var appVersionString: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        return "Version \(version) (\(build))"
    }

    var body: some View {
        Form {
            Section(header: Text("Account")) {
                HStack {
                    Text("Username")
                    Spacer()
                    TextField("Username", text: $viewModel.editableUsername)
                        .multilineTextAlignment(.trailing)
                        .autocapitalization(.none)
                        .textInputAutocapitalization(.never)
                }

                HStack {
                    Text("Email")
                    Spacer()
                    TextField("Email (optional)", text: $viewModel.editableEmail)
                        .multilineTextAlignment(.trailing)
                        .autocapitalization(.none)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                }

                HStack {
                    Text("Phone")
                    Spacer()
                    TextField("Phone (optional)", text: $viewModel.editablePhone)
                        .multilineTextAlignment(.trailing)
                        .keyboardType(.phonePad)
                }

                HStack {
                    Text("Name")
                    Spacer()
                    TextField("Name (optional)", text: $viewModel.editableName)
                        .multilineTextAlignment(.trailing)
                }

                if viewModel.hasChanges {
                    Button(action: {
                        Task {
                            do {
                                try await viewModel.saveChanges()
                                showSaveSuccess = true
                            } catch {
                                errorMessage = error.localizedDescription
                                showError = true
                            }
                        }
                    }) {
                        HStack {
                            Spacer()
                            if viewModel.isSaving {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle())
                            } else {
                                Text("Save Changes")
                                    .fontWeight(.semibold)
                            }
                            Spacer()
                        }
                    }
                    .disabled(viewModel.isSaving)
                }
            }

            Section(header: Text("App Info")) {
                HStack {
                    Text("Version")
                    Spacer()
                    Text(appVersionString)
                        .foregroundColor(.secondary)
                }
            }

            Section {
                Button(action: {
                    authService.signOut()
                }) {
                    Text("Sign Out")
                        .foregroundColor(.red)
                }
            }

            Section {
                Button(action: {
                    showDeleteConfirmation = true
                }) {
                    HStack {
                        if isDeleting {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle())
                            Spacer()
                            Text("Deleting...")
                                .foregroundColor(.red)
                        } else {
                            Text("Delete Account")
                                .foregroundColor(.red)
                        }
                    }
                }
                .disabled(isDeleting)
            }
        }
        .navigationTitle("Profile")
        .task {
            if let userId = authService.currentUser?.id {
                await viewModel.loadUserData(userId: userId)
            }
        }
        .refreshable {
            if let userId = authService.currentUser?.id {
                await viewModel.loadUserData(userId: userId)
            }
        }
        .alert("Profile Updated", isPresented: $showSaveSuccess) {
            Button("OK", role: .cancel) { }
        } message: {
            Text("Your profile has been saved successfully.")
        }
        .alert("Error", isPresented: $showError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(errorMessage)
        }
        .alert("Delete Account", isPresented: $showDeleteConfirmation) {
            Button("Cancel", role: .cancel) { }
            Button("Delete", role: .destructive) {
                Task {
                    await deleteAccount()
                }
            }
        } message: {
            Text("This action permanently deletes your account and cannot be undone.")
        }
    }

    private func deleteAccount() async {
        guard let userId = authService.currentUser?.id else {
            errorMessage = "No user logged in"
            showError = true
            return
        }

        isDeleting = true

        do {
            try await APIService.shared.deleteAccount(userId: userId)
            authService.signOut()
        } catch {
            errorMessage = error.localizedDescription
            showError = true
            isDeleting = false
        }
    }
}

// MARK: - Profile View Model
@MainActor
class ProfileViewModel: ObservableObject {
    @Published var userData: User?
    @Published var isLoading = false
    @Published var isSaving = false
    @Published var entryAmount: Double = 50.0

    @Published var editableUsername: String = ""
    @Published var editableEmail: String = ""
    @Published var editablePhone: String = ""
    @Published var editableName: String = ""

    private var originalUsername: String = ""
    private var originalEmail: String = ""
    private var originalPhone: String = ""
    private var originalName: String = ""

    var displayUsername: String {
        // Priority: fetched user data -> name -> email -> username -> placeholder
        if let user = userData {
            return user.name ?? user.username ?? user.email ?? "User"
        }
        return "Loading..."
    }

    var hasPaid: Bool {
        userData?.paid ?? false
    }

    var hasChanges: Bool {
        editableUsername != originalUsername ||
        editableEmail != originalEmail ||
        editablePhone != originalPhone ||
        editableName != originalName
    }

    func loadUserData(userId: UUID) async {
        isLoading = true

        do {
            // Fetch fresh user data from API
            let response = try await APIService.shared.getCurrentUser(userId: userId)
            self.userData = response

            // Initialize editable fields
            self.editableUsername = response.username ?? ""
            self.editableEmail = response.email ?? ""
            self.editablePhone = response.phone ?? ""
            self.editableName = response.name ?? ""

            // Store original values
            self.originalUsername = response.username ?? ""
            self.originalEmail = response.email ?? ""
            self.originalPhone = response.phone ?? ""
            self.originalName = response.name ?? ""
        } catch {
            print("Failed to load user data: \(error)")
        }

        isLoading = false
    }

    func saveChanges() async throws {
        guard let userId = userData?.id else {
            throw APIError.invalidResponse
        }

        isSaving = true

        do {
            let updatedUser = try await APIService.shared.updateUserProfile(
                userId: userId,
                username: editableUsername.isEmpty ? nil : editableUsername,
                email: editableEmail.isEmpty ? nil : editableEmail,
                phone: editablePhone.isEmpty ? nil : editablePhone,
                name: editableName.isEmpty ? nil : editableName
            )

            // Update local state
            self.userData = updatedUser
            self.originalUsername = updatedUser.username ?? ""
            self.originalEmail = updatedUser.email ?? ""
            self.originalPhone = updatedUser.phone ?? ""
            self.originalName = updatedUser.name ?? ""

            isSaving = false
        } catch {
            isSaving = false
            throw error
        }
    }
}

#Preview {
    NavigationStack {
        ProfileView()
            .environmentObject(AuthService())
    }
}
