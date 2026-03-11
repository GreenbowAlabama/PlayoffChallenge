//
//  PlayoffChallengeApp.swift
//  PlayoffChallenge
//
//  Created by Ian Carter on 10/18/25.
//

import SwiftUI
import StripePaymentSheet

@main
struct PlayoffChallengeApp: App {
    init() {
        // Set Stripe publishable key once at app launch
        StripeAPI.defaultPublishableKey = AppEnvironment.shared.stripePublishableKey
        print("[PlayoffChallengeApp] Stripe initialized with key: \(AppEnvironment.shared.stripePublishableKey.prefix(10))...")
    }

    @StateObject private var authService = AuthService.shared
    @StateObject private var walletVM = UserWalletViewModel()
    @StateObject private var deepLinkCoordinator = DeepLinkCoordinator(
        joinLinkResolver: JoinLinkService(),
        pendingJoinStore: PendingJoinManager()
    )
    @StateObject private var availableContestsVM = AvailableContestsViewModel()
    @StateObject private var myContestsVM = MyContestsViewModel()

    var body: some Scene {
        WindowGroup {
            rootView
                .environmentObject(authService)
                .environmentObject(walletVM)
                .environmentObject(deepLinkCoordinator)
                .environmentObject(availableContestsVM)
                .environmentObject(myContestsVM)
                .onAppear {
                    // Configure auth state synchronously on appear — before onOpenURL can fire.
                    // This fixes the race where onOpenURL fires before .task{} runs.
                    deepLinkCoordinator.configure(
                        currentUserId: { [weak authService] in authService?.currentUser?.id },
                        isAuthenticated: { [weak authService] in authService?.isAuthenticated ?? false }
                    )
                }
                .onOpenURL { url in
                    handleUniversalLink(url)
                }
                .onChange(of: authService.isAuthenticated) { _, isAuthenticated in
                    if isAuthenticated {
                        Task {
                            await deepLinkCoordinator.resumePendingJoinIfNeeded()
                        }
                    }
                }
                .sheet(isPresented: .constant(deepLinkCoordinator.error != nil && !deepLinkCoordinator.shouldNavigateToContest)) {
                    if let error = deepLinkCoordinator.error {
                        JoinErrorView(error: error) {
                            deepLinkCoordinator.clearError()
                        }
                    }
                }
                .sheet(isPresented: $deepLinkCoordinator.shouldNavigateToContest) {
                    if let contestId = deepLinkCoordinator.resolvedContestId {
                        NavigationStack {
                            ContestDetailView(contestId: contestId)
                                .toolbar {
                                    ToolbarItem(placement: .navigationBarTrailing) {
                                        Button("Done") {
                                            deepLinkCoordinator.clearNavigationState()
                                        }
                                    }
                                }
                        }
                        .environmentObject(authService)
                        .environmentObject(walletVM)
                        .environmentObject(availableContestsVM)
                        .environmentObject(myContestsVM)
                    }
                }
        }
    }

    @ViewBuilder
    private var rootView: some View {
        if !authService.isAuthenticated {
            if let pending = authService.pendingAppleCredential {
                EligibilityView(
                    appleId: pending.appleId,
                    email: pending.email
                )
            } else {
                SignInView()
            }
        } else if authService.needsUsernameSetup {
            CreateUsernameView()
        } else if authService.needsToAcceptTOS {
            TermsOfServiceView()
        } else {
            ContentView()
        }
    }

    private func handleUniversalLink(_ url: URL) {
        let action = deepLinkCoordinator.parse(url: url)
        Task {
            await deepLinkCoordinator.handle(action: action)
        }
    }
}
