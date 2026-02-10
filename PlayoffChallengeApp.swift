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
    @StateObject private var deepLinkCoordinator = DeepLinkCoordinator(
        joinLinkResolver: JoinLinkService(),
        pendingJoinStore: PendingJoinManager()
    )

    var body: some Scene {
        WindowGroup {
            rootView
                .environmentObject(authService)
                .environmentObject(deepLinkCoordinator)
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
