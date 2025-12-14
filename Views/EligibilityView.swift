import SwiftUI

struct EligibilityView: View {
    @EnvironmentObject var authService: AuthService
    @Environment(\.dismiss) var dismiss

    let appleId: String
    let email: String?
    let name: String?

    @State private var selectedState: String = ""
    @State private var age18Confirmed = false
    @State private var notRestrictedStateConfirmed = false
    @State private var skillBasedConfirmed = false
    @State private var showError = false
    @State private var errorMessage = ""
    @State private var isCreatingAccount = false

    let restrictedStates = ["NV", "HI", "ID", "MT", "WA"]

    let allStates = [
        ("AL", "Alabama"), ("AK", "Alaska"), ("AZ", "Arizona"), ("AR", "Arkansas"),
        ("CA", "California"), ("CO", "Colorado"), ("CT", "Connecticut"), ("DE", "Delaware"),
        ("FL", "Florida"), ("GA", "Georgia"), ("HI", "Hawaii"), ("ID", "Idaho"),
        ("IL", "Illinois"), ("IN", "Indiana"), ("IA", "Iowa"), ("KS", "Kansas"),
        ("KY", "Kentucky"), ("LA", "Louisiana"), ("ME", "Maine"), ("MD", "Maryland"),
        ("MA", "Massachusetts"), ("MI", "Michigan"), ("MN", "Minnesota"), ("MS", "Mississippi"),
        ("MO", "Missouri"), ("MT", "Montana"), ("NE", "Nebraska"), ("NV", "Nevada"),
        ("NH", "New Hampshire"), ("NJ", "New Jersey"), ("NM", "New Mexico"), ("NY", "New York"),
        ("NC", "North Carolina"), ("ND", "North Dakota"), ("OH", "Ohio"), ("OK", "Oklahoma"),
        ("OR", "Oregon"), ("PA", "Pennsylvania"), ("RI", "Rhode Island"), ("SC", "South Carolina"),
        ("SD", "South Dakota"), ("TN", "Tennessee"), ("TX", "Texas"), ("UT", "Utah"),
        ("VT", "Vermont"), ("VA", "Virginia"), ("WA", "Washington"), ("WV", "West Virginia"),
        ("WI", "Wisconsin"), ("WY", "Wyoming"), ("DC", "District of Columbia")
    ]

    var canContinue: Bool {
        !selectedState.isEmpty &&
        age18Confirmed &&
        notRestrictedStateConfirmed &&
        skillBasedConfirmed &&
        !restrictedStates.contains(selectedState)
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 20) {
                Text("Confirm Eligibility")
                    .font(.largeTitle)
                    .bold()
                    .padding(.top, 20)

                Text("Required to play")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Spacer()

                VStack(alignment: .leading, spacing: 20) {
                    Text("State of Residence")
                        .font(.headline)

                    Picker("Select State", selection: $selectedState) {
                        Text("Select your state").tag("")
                        ForEach(allStates, id: \.0) { state in
                            if restrictedStates.contains(state.0) {
                                Text(state.1 + " (Not Available)")
                                    .foregroundColor(.gray)
                                    .tag(state.0)
                            } else {
                                Text(state.1).tag(state.0)
                            }
                        }
                    }
                    .pickerStyle(.menu)
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(10)

                    if restrictedStates.contains(selectedState) {
                        Text("Fantasy contests are not available in this state")
                            .font(.caption)
                            .foregroundColor(.red)
                    }

                    Divider()

                    VStack(alignment: .leading, spacing: 15) {
                        Toggle(isOn: $age18Confirmed) {
                            Text("I am 18 years or older")
                        }

                        Toggle(isOn: $notRestrictedStateConfirmed) {
                            Text("I am not a resident of Nevada, Hawaii, Idaho, Montana, or Washington")
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        Toggle(isOn: $skillBasedConfirmed) {
                            Text("I understand this is a skill-based fantasy contest, not gambling")
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    Text("Providing false information may result in account termination and forfeiture of entry fees")
                        .font(.caption)
                        .foregroundColor(.orange)
                        .padding(.top, 10)
                }
                .padding()

                Spacer()

                Button(action: {
                    Task {
                        await createAccount()
                    }
                }) {
                    if isCreatingAccount {
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
                .background(canContinue ? Color.blue : Color.gray)
                .cornerRadius(10)
                .disabled(!canContinue || isCreatingAccount)
                .padding(.horizontal)
                .padding(.bottom, 20)
            }
            .padding()
            .navigationBarHidden(true)
        }
        .alert("Error", isPresented: $showError) {
            Button("OK") { }
        } message: {
            Text(errorMessage)
        }
    }

    func createAccount() async {
        isCreatingAccount = true

        do {
            let user = try await APIService.shared.getOrCreateUser(
                appleId: appleId,
                email: email,
                name: name,
                state: selectedState,
                eligibilityCertified: true,
                tosVersion: "2025-12-12"
            )

            await MainActor.run {
                authService.currentUser = user
                authService.isAuthenticated = true
                authService.pendingAppleCredential = nil
                UserDefaults.standard.set(user.id.uuidString, forKey: "userId")
                dismiss()
            }
        } catch let error as APIError {
            await MainActor.run {
                errorMessage = error.localizedDescription
                showError = true
                isCreatingAccount = false
            }
        } catch {
            await MainActor.run {
                errorMessage = "An error occurred: \(error.localizedDescription)"
                showError = true
                isCreatingAccount = false
            }
        }
    }
}

#Preview {
    EligibilityView(appleId: "test123", email: "test@test.com", name: "Test User")
        .environmentObject(AuthService())
}
