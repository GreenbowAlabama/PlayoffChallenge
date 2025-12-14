import SwiftUI
import Combine

struct ProfileView: View {
    @EnvironmentObject var authService: AuthService
    @StateObject private var viewModel = ProfileViewModel()
    @State private var showSaveSuccess = false
    @State private var showError = false
    @State private var errorMessage = ""

    var body: some View {
        NavigationView {
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
                
                Section(header: Text("Payment Status")) {
                    HStack {
                        Text("Status")
                        Spacer()
                        if viewModel.hasPaid {
                            HStack {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                                Text("Paid")
                                    .foregroundColor(.green)
                            }
                        } else {
                            HStack {
                                Image(systemName: "exclamationmark.circle.fill")
                                    .foregroundColor(.orange)
                                Text("Pending")
                                    .foregroundColor(.orange)
                            }
                        }
                    }
                    
                    if !viewModel.hasPaid {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Payment Instructions")
                                .font(.headline)
                            
                            Text("Send $\(String(format: "%.0f", viewModel.entryAmount)) via:")
                                .font(.subheadline)
                            
                            Text("Venmo, Cash App, or Zelle")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            
                            Text("Include in memo:")
                                .font(.caption)
                                .padding(.top, 4)
                            
                            Text("PlayoffChallenge-\(viewModel.displayUsername)")
                                .font(.caption)
                                .fontWeight(.semibold)
                                .foregroundColor(.blue)
                        }
                        .padding(.vertical, 8)
                    }
                }
                
                // Show Admin button if user is admin
                if authService.isAdmin {
                    Section {
                        NavigationLink(destination: AdminView()) {
                            Label("Admin Panel", systemImage: "gear")
                        }
                    }
                }
                
                Section(header: Text("App Info")) {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("1.0.0")
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

    private var originalUsername: String = ""
    private var originalEmail: String = ""
    private var originalPhone: String = ""

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
        editablePhone != originalPhone
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

            // Store original values
            self.originalUsername = response.username ?? ""
            self.originalEmail = response.email ?? ""
            self.originalPhone = response.phone ?? ""

            // Also fetch entry amount from settings
            let settings = try await APIService.shared.getSettings()
            self.entryAmount = settings.entryAmount
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
                phone: editablePhone.isEmpty ? nil : editablePhone
            )

            // Update local state
            self.userData = updatedUser
            self.originalUsername = updatedUser.username ?? ""
            self.originalEmail = updatedUser.email ?? ""
            self.originalPhone = updatedUser.phone ?? ""

            isSaving = false
        } catch {
            isSaving = false
            throw error
        }
    }
}

#Preview {
    ProfileView()
        .environmentObject(AuthService())
}
