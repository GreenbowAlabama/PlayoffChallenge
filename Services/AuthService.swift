//
//  AuthService.swift
//  PlayoffChallenge
//
//  V2 - Matching Actual Database Schema
//  With Debug Logging (No Emojis)
//  TOS gating via capability-based flags endpoint
//

import SwiftUI
import AuthenticationServices
import Combine

@MainActor
class AuthService: ObservableObject {
    @Published var currentUser: User?
    @Published var isAuthenticated = false
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var needsToAcceptTOS = false
    @Published var needsUsernameSetup = false
    @Published var pendingAppleCredential: (appleId: String, email: String?, name: String?)? = nil

    init() {
        print("AuthService: Initializing...")
        if let userIdString = UserDefaults.standard.string(forKey: "userId"),
           let userId = UUID(uuidString: userIdString) {
            print("AuthService: Found saved userId: \(userId)")
            Task {
                await loadUser(userId: userId)
            }
        } else {
            print("AuthService: No saved userId found")
        }
    }

    func handleAppleIDCredential(credential: ASAuthorizationAppleIDCredential) async {
        print("AuthService: Starting Apple authentication...")
        print(
          "API_BASE_URL:",
          Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") ?? "MISSING"
        )
        isLoading = true
        errorMessage = nil

        do {
            let appleId = credential.user
            let email = credential.email
            let fullName = credential.fullName

            print("AuthService: Apple ID: \(appleId)")
            print("AuthService: Email: \(email ?? "nil")")

            var name: String?
            if let givenName = fullName?.givenName, let familyName = fullName?.familyName {
                name = "\(givenName) \(familyName)"
            } else if let givenName = fullName?.givenName {
                name = givenName
            }
            print("AuthService: Name: \(name ?? "nil")")

            print("AuthService: Calling backend API (checking existing user)...")

            // Try to get existing user first (without compliance fields)
            do {
                let user = try await APIService.shared.getOrCreateUser(
                    appleId: appleId,
                    email: email,
                    name: name
                )

                // Check if user has confirmed eligibility
                if !user.hasConfirmedEligibility {
                    print("AuthService: New user - needs eligibility confirmation")
                    // User needs to complete eligibility flow
                    self.pendingAppleCredential = (appleId, email, name)
                    isLoading = false
                    return
                }

                // Existing user or eligibility completed
                print("AuthService: Got user from API: \(user.id)")
                print("AuthService: Username: \(user.username ?? "nil")")

                self.currentUser = user
                self.isAuthenticated = true

                UserDefaults.standard.set(user.id.uuidString, forKey: "userId")
                print("AuthService: Saved userId to UserDefaults")

                // V2: Check TOS requirement via flags endpoint (capability-based)
                await checkTOSFlags(userId: user.id)

                print("AuthService: isAuthenticated = \(self.isAuthenticated)")
                print("AuthService: Authentication complete!")

                isLoading = false
            } catch APIError.needsEligibility {
                // New user needs to complete eligibility flow
                print("AuthService: New user - needs eligibility confirmation")
                self.pendingAppleCredential = (appleId, email, name)
                isLoading = false
                return
            }
        } catch {
            print("AuthService ERROR: Error during authentication: \(error)")
            print("AuthService ERROR: Error details: \(error.localizedDescription)")
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    func loadUser(userId: UUID) async {
        print("AuthService: Loading user \(userId)...")
        isLoading = true
        errorMessage = nil

        do {
            let user = try await APIService.shared.getUser(userId: userId)
            print("AuthService: User loaded successfully")
            print("AuthService: Username: \(user.username ?? "nil")")
            self.currentUser = user
            self.isAuthenticated = true
            print("AuthService: isAuthenticated = \(self.isAuthenticated)")

            // V2: Check TOS requirement via flags endpoint (capability-based)
            await checkTOSFlags(userId: user.id)

        } catch {
            print("AuthService ERROR: Failed to load user: \(error)")
            errorMessage = error.localizedDescription
            signOut()
        }

        isLoading = false
    }

    // MARK: - V2 TOS Flags

    /// Checks TOS requirement via capability-based flags endpoint.
    /// This is the only source of truth for TOS gating in v2.
    func checkTOSFlags(userId: UUID) async {
        do {
            let flags = try await APIService.shared.getUserFlags(userId: userId)
            self.needsToAcceptTOS = flags.requiresTos
            print("AuthService: TOS required = \(self.needsToAcceptTOS)")
        } catch {
            // Fail open to avoid blocking users on transient errors
            print("AuthService: Failed to load TOS flags, defaulting to no gate: \(error)")
            self.needsToAcceptTOS = false
        }
    }

    // MARK: - Email/Password Authentication (Debug Only)

    #if DEBUG
    func loginWithEmail(email: String, password: String) async {
        print("AuthService: Starting email login...")
        isLoading = true
        errorMessage = nil

        do {
            let user = try await APIService.shared.loginWithEmail(email: email, password: password)

            print("AuthService: Got user from API: \(user.id)")
            print("AuthService: Username: \(user.username ?? "nil")")

            self.currentUser = user
            self.isAuthenticated = true

            UserDefaults.standard.set(user.id.uuidString, forKey: "userId")
            print("AuthService: Saved userId to UserDefaults")

            // V2: Check TOS requirement via flags endpoint (capability-based)
            await checkTOSFlags(userId: user.id)

            print("AuthService: isAuthenticated = \(self.isAuthenticated)")
            print("AuthService: Login complete!")

            isLoading = false
        } catch {
            print("AuthService ERROR: Error during login: \(error)")
            print("AuthService ERROR: Error details: \(error.localizedDescription)")
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    func registerWithEmail(email: String, password: String, name: String?, state: String, eligibilityCertified: Bool) async {
        print("AuthService: Starting email registration...")
        isLoading = true
        errorMessage = nil

        do {
            let user = try await APIService.shared.registerWithEmail(
                email: email,
                password: password,
                name: name,
                state: state,
                eligibilityCertified: eligibilityCertified
            )

            print("AuthService: Got user from API: \(user.id)")
            print("AuthService: Username: \(user.username ?? "nil")")

            self.currentUser = user
            self.isAuthenticated = true
            self.needsUsernameSetup = true

            UserDefaults.standard.set(user.id.uuidString, forKey: "userId")
            print("AuthService: Saved userId to UserDefaults")

            // V2: Check TOS requirement via flags endpoint (capability-based)
            await checkTOSFlags(userId: user.id)

            print("AuthService: isAuthenticated = \(self.isAuthenticated)")
            print("AuthService: Registration complete!")

            isLoading = false
        } catch {
            print("AuthService ERROR: Error during registration: \(error)")
            print("AuthService ERROR: Error details: \(error.localizedDescription)")
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }
    #endif

    func signOut() {
        print("AuthService: Signing out...")
        currentUser = nil
        isAuthenticated = false
        needsToAcceptTOS = false
        UserDefaults.standard.removeObject(forKey: "userId")
    }

    var isAdmin: Bool {
        return currentUser?.isAdmin ?? false
    }

    var hasPaid: Bool {
        return currentUser?.paid ?? false
    }

    var displayName: String {
        return currentUser?.username ?? "User"
    }
}

struct SignInWithAppleButton: UIViewRepresentable {
    @EnvironmentObject var authService: AuthService

    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(type: .signIn, style: .black)
        button.addTarget(context.coordinator, action: #selector(Coordinator.handleTap), for: .touchUpInside)
        return button
    }

    func updateUIView(_ uiView: ASAuthorizationAppleIDButton, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(authService: authService)
    }

    class Coordinator: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
        let authService: AuthService

        init(authService: AuthService) {
            self.authService = authService
        }

        @objc func handleTap() {
            print("SignInButton: Button tapped")
            let appleIDProvider = ASAuthorizationAppleIDProvider()
            let request = appleIDProvider.createRequest()
            request.requestedScopes = [.fullName, .email]

            let authorizationController = ASAuthorizationController(authorizationRequests: [request])
            authorizationController.delegate = self
            authorizationController.presentationContextProvider = self
            authorizationController.performRequests()
        }

        func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
            print("SignInButton: Authorization succeeded")
            if let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential {
                Task { @MainActor in
                    await authService.handleAppleIDCredential(credential: appleIDCredential)
                }
            }
        }

        func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
            print("SignInButton ERROR: Authorization failed: \(error)")
            Task { @MainActor in
                authService.errorMessage = error.localizedDescription
            }
        }

        func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
            guard let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first,
                  let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first else {
                // Fallback: create window with first available scene
                if let firstScene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
                    return UIWindow(windowScene: firstScene)
                }
                return UIWindow()
            }
            return window
        }
    }
}
