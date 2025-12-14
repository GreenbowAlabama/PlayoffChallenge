//
//  PlayoffChallengeApp.swift
//  PlayoffChallenge
//
//  Created by Ian Carter on 10/18/25.
//

import SwiftUI

@main
struct PlayoffChallengeApp: App {
    @StateObject private var authService = AuthService()

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
}
