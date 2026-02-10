//
//  DeepLinkCoordinator.swift
//  PlayoffChallenge
//
//  Coordinates deep link handling across services.
//  Resolves tokens and manages navigation state.
//  Never performs join operations — ContestDetailViewModel is the sole join owner.
//

import Foundation
import Combine

/// Coordinates deep link handling across services.
/// Resolves tokens and navigates. Never joins.
@MainActor
final class DeepLinkCoordinator: ObservableObject {

    // MARK: - Published State for UI Binding

    @Published private(set) var currentAction: DeepLinkAction?
    @Published private(set) var resolvedJoinLink: ResolvedJoinLink?
    @Published private(set) var isResolving = false
    @Published private(set) var error: JoinLinkError?
    @Published var shouldNavigateToContest = false

    /// The contest ID from the resolved join link — used as navigation source of truth
    var resolvedContestId: UUID? {
        resolvedJoinLink?.contestId
    }

    /// The join token from the resolved join link
    var resolvedJoinToken: String? {
        resolvedJoinLink?.token
    }

    // MARK: - Dependencies (protocol-typed for testability)

    private let joinLinkResolver: JoinLinkResolving
    private let pendingJoinStore: PendingJoinStoring

    // Auth state - settable for late binding in SwiftUI
    var getCurrentUserId: (() -> UUID?)?
    var getIsAuthenticated: (() -> Bool)?

    // MARK: - Initialization

    /// Full initializer for testing with all dependencies
    init(
        joinLinkResolver: JoinLinkResolving,
        pendingJoinStore: PendingJoinStoring,
        currentUserId: @escaping () -> UUID?,
        isAuthenticated: @escaping () -> Bool
    ) {
        self.joinLinkResolver = joinLinkResolver
        self.pendingJoinStore = pendingJoinStore
        self.getCurrentUserId = currentUserId
        self.getIsAuthenticated = isAuthenticated
    }

    /// Convenience initializer for production - auth state set via configure()
    init(
        joinLinkResolver: JoinLinkResolving,
        pendingJoinStore: PendingJoinStoring
    ) {
        self.joinLinkResolver = joinLinkResolver
        self.pendingJoinStore = pendingJoinStore
    }

    /// Configure auth state after initialization (for SwiftUI @StateObject pattern)
    func configure(currentUserId: @escaping () -> UUID?, isAuthenticated: @escaping () -> Bool) {
        self.getCurrentUserId = currentUserId
        self.getIsAuthenticated = isAuthenticated
    }

    // MARK: - URL Parsing

    /// Parses a URL into a deep link action
    func parse(url: URL) -> DeepLinkAction {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: true) else {
            return .unknown
        }

        let pathComponents = components.path
            .split(separator: "/")
            .map(String.init)
            .filter { !$0.isEmpty }

        // Check for /join/{token} pattern in path (HTTPS universal links)
        if pathComponents.count >= 2 {
            let joinIndex = pathComponents.firstIndex(of: "join")
            if let joinIndex = joinIndex, joinIndex + 1 < pathComponents.count {
                let token = pathComponents[joinIndex + 1]
                guard !token.isEmpty else { return .unknown }
                return .joinContest(token: token)
            }
        }

        // Check for custom scheme where host is "join" and path contains token
        if components.host == "join", let firstPathComponent = pathComponents.first, !firstPathComponent.isEmpty {
            return .joinContest(token: firstPathComponent)
        }

        return .unknown
    }

    // MARK: - Action Handling

    /// Handles a deep link action
    func handle(action: DeepLinkAction) async {
        currentAction = action
        error = nil

        switch action {
        case .joinContest(let token):
            await handleJoinLink(token: token)
        case .unknown:
            break
        }
    }

    // MARK: - Token Resolution (no join, no client-side gatekeeping)

    private func handleJoinLink(token: String) async {
        isResolving = true

        do {
            // Step 1: Resolve the token (unauthenticated, read-only)
            let resolved = try await joinLinkResolver.resolve(token: token)

            // Step 2: Check for environment mismatch (infra concern, not joinability)
            if !resolved.isValidForEnvironment {
                if let mismatch = resolved.environmentMismatch {
                    throw JoinLinkError.environmentMismatch(
                        expected: mismatch.expectedEnvironment,
                        actual: mismatch.actualEnvironment
                    )
                }
            }

            // Step 3: Store resolved link and navigate directly to ContestDetailView.
            // No client-side gatekeeping — ContestDetailView handles joinability.
            resolvedJoinLink = resolved
            isResolving = false

            // If not authenticated, store token for resume after sign-in
            if getIsAuthenticated?() != true {
                pendingJoinStore.store(token: resolved.token)
            }

            shouldNavigateToContest = true

        } catch let error as JoinLinkError {
            self.error = error
            isResolving = false
        } catch {
            self.error = .networkError(underlying: error.localizedDescription)
            isResolving = false
        }
    }

    /// Clear navigation state after navigating to contest
    func clearNavigationState() {
        shouldNavigateToContest = false
        resolvedJoinLink = nil
    }

    /// Called after successful authentication to resume pending join
    func resumePendingJoinIfNeeded() async {
        guard let token = pendingJoinStore.retrieve() else { return }
        await handle(action: .joinContest(token: token))
    }

    // MARK: - State Management

    func clearError() {
        error = nil
    }

    /// Store the current join token for resume after authentication.
    func storeTokenForLaterJoin() {
        guard let resolved = resolvedJoinLink else { return }
        pendingJoinStore.store(token: resolved.token)
    }

    func dismiss() {
        resolvedJoinLink = nil
        shouldNavigateToContest = false
        currentAction = nil
    }
}
