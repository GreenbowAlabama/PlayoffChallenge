# iOS Compliance Implementation Guide

**Status:** Phase 5 - Ready for Implementation
**Date:** 2025-12-12
**Backend:** ✅ Deployed to Production
**Database:** ✅ All compliance tables ready

---

## Summary of Changes Needed

The iOS app needs to be updated to support the new compliance signup flow. This document provides the exact code changes needed.

### Files to Modify:
1. ✅ `Models/Models.swift` - **DONE** (compliance fields added)
2. `Services/APIService.swift` - Update endpoints
3. `Services/AuthService.swift` - Update signup flow
4. `Views/EligibilityView.swift` - **NEW FILE** (state selector + checkboxes)
5. `Views/TermsOfServiceView.swift` - **NEW FILE** (TOS display + acceptance)
6. `Views/SignInView.swift` - Optional minor updates

---

## Step 1: Update APIService.swift

### Location: `ios-app/PlayoffChallenge/Services/APIService.swift`

**Add these new methods:**

```swift
// MARK: - Compliance Endpoints

/// Get Terms of Service
func getTermsOfService() async throws -> (content: String, version: String) {
    let url = URL(string: "\(baseURL)/api/terms")!
    let (data, _) = try await URLSession.shared.data(from: url)

    struct TOSResponse: Codable {
        let content: String
        let version: String
    }

    let response = try JSONDecoder().decode(TOSResponse.self, from: data)
    return (response.content, response.version)
}

/// Accept Terms of Service
func acceptTermsOfService(userId: UUID, tosVersion: String) async throws {
    let url = URL(string: "\(baseURL)/api/users/\(userId.uuidString)/accept-tos")!
    var request = URLRequest(url: url)
    request.httpMethod = "PUT"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let body: [String: Any] = ["tos_version": tosVersion]
    request.httpBody = try JSONSerialization.data(withJSONObject: body)

    let (_, response) = try await URLSession.shared.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse,
          (200...299).contains(httpResponse.statusCode) else {
        throw APIError.serverError
    }
}
```

**Update existing `getOrCreateUser` method:**

Find the current `getOrCreateUser` method and replace it with:

```swift
/// Create or get user with compliance fields
func getOrCreateUser(
    appleId: String,
    email: String?,
    name: String?,
    state: String? = nil,
    eligibilityCertified: Bool = false,
    tosVersion: String = "2025-12-12"
) async throws -> User {
    let url = URL(string: "\(baseURL)/api/users")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    var body: [String: Any] = [
        "apple_id": appleId,
        "email": email ?? NSNull(),
        "name": name ?? NSNull()
    ]

    // Add compliance fields for new users
    if let state = state {
        body["state"] = state
        body["eligibility_certified"] = eligibilityCertified
        body["tos_version"] = tosVersion
    }

    request.httpBody = try JSONSerialization.data(withJSONObject: body)

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse else {
        throw APIError.invalidResponse
    }

    // Handle restricted state blocking (403 Forbidden)
    if httpResponse.statusCode == 403 {
        struct ErrorResponse: Codable {
            let error: String
        }
        if let errorResponse = try? JSONDecoder().decode(ErrorResponse.self, from: data) {
            throw APIError.restrictedState(errorResponse.error)
        }
        throw APIError.serverError
    }

    guard (200...299).contains(httpResponse.statusCode) else {
        throw APIError.serverError
    }

    return try JSONDecoder().decode(User.self, from: data)
}
```

**Add new error case to `APIError` enum:**

Find the `APIError` enum and add:

```swift
enum APIError: Error, LocalizedError {
    // ... existing cases ...
    case restrictedState(String)

    var errorDescription: String? {
        switch self {
        // ... existing cases ...
        case .restrictedState(let message):
            return message
        }
    }
}
```

---

## Step 2: Create EligibilityView.swift

### Location: `ios-app/PlayoffChallenge/Views/EligibilityView.swift` (NEW FILE)

**Full file contents:**

```swift
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
```

---

## Step 3: Create TermsOfServiceView.swift

### Location: `ios-app/PlayoffChallenge/Views/TermsOfServiceView.swift` (NEW FILE)

**Full file contents:**

```swift
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
    @State private var scrollOffset: CGFloat = 0

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
                        .background(hasAgreed ? Color.blue : Color.gray)
                        .cornerRadius(10)
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
```

---

## Step 4: Update AuthService.swift

### Location: `ios-app/PlayoffChallenge/Services/AuthService.swift`

**Find the `handleAppleIDCredential` method and update it:**

Replace the existing method with:

```swift
func handleAppleIDCredential(credential: ASAuthorizationAppleIDCredential) async {
    print("AuthService: Starting Apple authentication...")
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
        let user = try await APIService.shared.getOrCreateUser(
            appleId: appleId,
            email: email,
            name: name
        )

        // Check if user has confirmed eligibility
        if !user.hasConfirmedEligibility {
            print("AuthService: New user - needs eligibility confirmation")
            // User needs to complete eligibility flow
            // This will be handled by showing EligibilityView (see Step 5)
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

        // Check if user needs to accept TOS
        if !user.hasAcceptedTOS {
            print("AuthService: User needs to accept TOS")
            self.needsToAcceptTOS = true
        }

        print("AuthService: isAuthenticated = \(self.isAuthenticated)")
        print("AuthService: Authentication complete!")

        isLoading = false
    } catch {
        print("AuthService ERROR: Error during authentication: \(error)")
        print("AuthService ERROR: Error details: \(error.localizedDescription)")
        errorMessage = error.localizedDescription
        isLoading = false
    }
}
```

**Add new properties to AuthService class:**

```swift
@Published var needsToAcceptTOS = false
@Published var pendingAppleCredential: (appleId: String, email: String?, name: String?)? = nil
```

---

## Step 5: Update PlayoffChallengeApp.swift (Main Entry Point)

### Location: `ios-app/PlayoffChallenge/PlayoffChallengeApp.swift`

**Update the body to handle the new flows:**

```swift
var body: some Scene {
    WindowGroup {
        if !authService.isAuthenticated {
            if let pending = authService.pendingAppleCredential {
                // Show eligibility view for new users
                EligibilityView(
                    appleId: pending.appleId,
                    email: pending.email,
                    name: pending.name
                )
                .environmentObject(authService)
            } else {
                // Show sign in view
                SignInView()
                    .environmentObject(authService)
            }
        } else if authService.needsToAcceptTOS {
            // Show TOS acceptance view
            TermsOfServiceView()
                .environmentObject(authService)
        } else {
            // Normal app flow
            ContentView()
                .environmentObject(authService)
        }
    }
}
```

---

## Testing Instructions

### 1. Test Allowed State (Should Work):
1. Delete any existing test user:
   ```bash
   ./scripts/delete-test-user.sh "your-apple-id-or-email"
   ```
2. Launch app and tap "Sign in with Apple"
3. Complete Apple auth
4. **EligibilityView should appear**
5. Select state: "Alabama" (or any non-restricted state)
6. Check all three boxes
7. Tap "Continue"
8. **TermsOfServiceView should appear**
9. Check "I have read and agree"
10. Tap "Accept"
11. **App should load normally**

### 2. Test Restricted State (Should Block):
1. Delete test user (if exists)
2. Sign in with Apple
3. Select state: "Nevada"
4. Check all boxes
5. Tap "Continue"
6. **Should show error:** "Fantasy contests are not available in your state"
7. User should NOT be created

### 3. Test Existing User (Should Skip Eligibility):
1. Complete Test #1 successfully
2. Force quit app
3. Relaunch app
4. **Should go directly to app** (skip Eligibility + TOS views)

---

## Database Verification

**After creating a test user, verify in database:**

```bash
psql "$DATABASE_URL" -c "
  SELECT
    id, email, state,
    eligibility_confirmed_at IS NOT NULL as eligible,
    tos_accepted_at IS NOT NULL as tos_accepted
  FROM users
  WHERE email = 'your-test-email@example.com';
"
```

**Should see:**
- `state`: "AL" (or whatever you selected)
- `eligible`: true
- `tos_accepted`: true

---

## Summary

**Files to Create:**
- `EligibilityView.swift` (new)
- `TermsOfServiceView.swift` (new)

**Files to Modify:**
- ✅ `Models.swift` - Done
- `APIService.swift` - Add TOS endpoints + update getOrCreateUser
- `AuthService.swift` - Add pending credential handling
- `PlayoffChallengeApp.swift` - Update view flow logic

**Story Points:** 8 (approximately 2-3 days of iOS work)

---

**Questions?** Refer back to Phase 3 & 4 backend implementation for API contract details.
