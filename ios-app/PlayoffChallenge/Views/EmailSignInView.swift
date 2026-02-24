//
//  EmailSignInView.swift
//  PlayoffChallenge
//
//  Email/Password Authentication (Debug Only)
//

import SwiftUI

#if DEBUG
struct EmailSignInView: View {
    @EnvironmentObject var authService: AuthService

    @State private var email = ""
    @State private var password = ""
    @State private var isSignUp = false
    @State private var showEligibilityForm = false

    var body: some View {
        VStack(spacing: 20) {
            Text(isSignUp ? "Sign Up with Email" : "Sign In with Email")
                .font(.headline)

            TextField("Email", text: $email)
                .textContentType(.emailAddress)
                .autocapitalization(.none)
                .keyboardType(.emailAddress)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)

            SecureField("Password", text: $password)
                .textContentType(isSignUp ? .newPassword : .password)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)

            if authService.isLoading {
                ProgressView()
            } else {
                Button(action: {
                    if isSignUp {
                        showEligibilityForm = true
                    } else {
                        Task {
                            await authService.loginWithEmail(email: email, password: password)
                        }
                    }
                }) {
                    Text(isSignUp ? "Continue to Eligibility" : "Sign In")
                        .font(.headline)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                }
                .background(isFormValid ? Color.blue : Color.gray)
                .cornerRadius(10)
                .disabled(!isFormValid)
                .padding(.horizontal)
            }

            if let errorMessage = authService.errorMessage {
                Text(errorMessage)
                    .foregroundColor(.red)
                    .font(.caption)
                    .padding()
            }

            Button(action: {
                isSignUp.toggle()
            }) {
                Text(isSignUp ? "Already have an account? Sign In" : "Don't have an account? Sign Up")
                    .font(.subheadline)
                    .foregroundColor(.blue)
            }
        }
        .sheet(isPresented: $showEligibilityForm) {
            EmailEligibilityView(
                email: email,
                password: password
            )
            .environmentObject(authService)
        }
    }

    var isFormValid: Bool {
        !email.isEmpty && !password.isEmpty && password.count >= 6
    }
}

struct EmailEligibilityView: View {
    @EnvironmentObject var authService: AuthService
    @Environment(\.dismiss) var dismiss

    let email: String
    let password: String

    @State private var selectedState: String = ""
    @State private var age18Confirmed = false
    @State private var notRestrictedStateConfirmed = false
    @State private var skillBasedConfirmed = false

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
                        await authService.registerWithEmail(
                            email: email,
                            password: password,
                            name: nil,
                            state: selectedState,
                            eligibilityCertified: true
                        )
                        dismiss()
                    }
                }) {
                    if authService.isLoading {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            .frame(maxWidth: .infinity)
                    } else {
                        Text("Create Account")
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding()
                    }
                }
                .background(canContinue ? Color.blue : Color.gray)
                .cornerRadius(10)
                .disabled(!canContinue || authService.isLoading)
                .padding(.horizontal)
                .padding(.bottom, 20)
            }
            .padding()
            .navigationBarHidden(true)
        }
    }
}

#Preview {
    EmailSignInView()
        .environmentObject(AuthService())
}
#endif
