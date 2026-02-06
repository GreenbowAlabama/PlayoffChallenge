//
//  DeepLinkCoordinator.swift
//  PlayoffChallenge
//
//  Coordinates deep link handling across services.
//  Main entry point for universal link processing.
//

import Foundation
import Combine

/// Coordinates deep link handling across services.
/// Main entry point for universal link processing.
@MainActor
final class DeepLinkCoordinator: ObservableObject {

    // MARK: - Published State for UI Binding

    @Published private(set) var currentAction: DeepLinkAction?
    @Published private(set) var resolvedJoinLink: ResolvedJoinLink?
    @Published private(set) var isResolving = false
    @Published private(set) var error: JoinLinkError?
    @Published var showJoinPreview = false
    @Published private(set) var joinedContestId: UUID?
    @Published var shouldNavigateToContest = false

    // MARK: - Dependencies (protocol-typed for testability)

    private let joinLinkResolver: JoinLinkResolving
    private let contestJoiner: ContestJoining
    private let pendingJoinStore: PendingJoinStoring

    // Auth state - settable for late binding in SwiftUI
    var getCurrentUserId: (() -> UUID?)?
    var getIsAuthenticated: (() -> Bool)?

    // MARK: - Initialization

    /// Full initializer for testing with all dependencies
    init(
        joinLinkResolver: JoinLinkResolving,
        contestJoiner: ContestJoining,
        pendingJoinStore: PendingJoinStoring,
        currentUserId: @escaping () -> UUID?,
        isAuthenticated: @escaping () -> Bool
    ) {
        self.joinLinkResolver = joinLinkResolver
        self.contestJoiner = contestJoiner
        self.pendingJoinStore = pendingJoinStore
        self.getCurrentUserId = currentUserId
        self.getIsAuthenticated = isAuthenticated
    }

    /// Convenience initializer for production - auth state set via configure()
    init(
        joinLinkResolver: JoinLinkResolving,
        contestJoiner: ContestJoining,
        pendingJoinStore: PendingJoinStoring
    ) {
        self.joinLinkResolver = joinLinkResolver
        self.contestJoiner = contestJoiner
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
        // e.g., https://app.playoffchallenge.com/join/abc123
        if pathComponents.count >= 2 {
            let joinIndex = pathComponents.firstIndex(of: "join")
            if let joinIndex = joinIndex, joinIndex + 1 < pathComponents.count {
                let token = pathComponents[joinIndex + 1]
                guard !token.isEmpty else { return .unknown }
                return .joinContest(token: token)
            }
        }

        // Check for custom scheme where host is "join" and path contains token
        // e.g., playoffchallenge://join/xyz789
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

    // MARK: - Join Flow

    private func handleJoinLink(token: String) async {
        isResolving = true

        do {
            // Step 1: Resolve the token (unauthenticated)
            let resolved = try await joinLinkResolver.resolve(token: token)

            // Step 2: Check for environment mismatch
            if !resolved.isValidForEnvironment {
                if let mismatch = resolved.environmentMismatch {
                    throw JoinLinkError.environmentMismatch(
                        expected: mismatch.expectedEnvironment,
                        actual: mismatch.actualEnvironment
                    )
                }
            }

            // Step 3: Check contest availability
            if resolved.contest.status == .locked {
                throw JoinLinkError.contestLocked
            }
            if resolved.contest.isFull {
                throw JoinLinkError.contestFull
            }
            if resolved.contest.status == .cancelled {
                throw JoinLinkError.contestCancelled
            }

            // Step 4: Short-circuit if user is already a participant
            let alreadyJoined = JoinedContestsStore.shared.isJoined(contestId: resolved.contest.id)
            let isOrganizer = CreatedContestsStore.shared.getAll().contains { $0.id == resolved.contest.id }

            if alreadyJoined || isOrganizer {
                resolvedJoinLink = resolved
                isResolving = false
                shouldNavigateToContest = true
                return
            }

            // Step 5: Store resolved link and show preview
            resolvedJoinLink = resolved
            isResolving = false
            showJoinPreview = true

        } catch let error as JoinLinkError {
            self.error = error
            isResolving = false
        } catch {
            self.error = .networkError(underlying: error.localizedDescription)
            isResolving = false
        }
    }

    /// Called when user taps "Join" from preview screen
    func confirmJoin() async throws -> ContestJoinResult {
        guard let resolved = resolvedJoinLink else {
            throw JoinLinkError.invalidToken
        }

        // Check if authenticated
        let userId = getCurrentUserId?()
        let isAuth = getIsAuthenticated?() ?? false

        guard let userId = userId, isAuth else {
            // Store token for resume after auth
            pendingJoinStore.store(token: resolved.token)
            throw JoinLinkError.notAuthenticated
        }

        // Perform authenticated join
        let result = try await contestJoiner.joinContest(token: resolved.token, userId: userId)

        // Set joined contest for navigation
        joinedContestId = result.contestId
        shouldNavigateToContest = true

        // Clear preview state on success
        showJoinPreview = false

        return result
    }

    /// Create a MockContest from resolved join link for navigation
    func createMockContestFromResolved() -> MockContest? {
        guard let resolved = resolvedJoinLink else { return nil }

        // For organizers or already-joined users, prefer the locally stored contest
        // which has the real name, entry counts, and join URL.
        let isOrganizer = CreatedContestsStore.shared.getAll().contains { $0.id == resolved.contest.id }
        if isOrganizer,
           let stored = CreatedContestsStore.shared.getAll().first(where: { $0.id == resolved.contest.id }) {
            return stored
        }
        if JoinedContestsStore.shared.isJoined(contestId: resolved.contest.id),
           let stored = JoinedContestsStore.shared.getContest(by: resolved.contest.id) {
            return stored
        }

        // For newly joined users, build from resolved metadata
        let entryCount = resolved.contest.hasSlotInfo
            ? resolved.contest.filledSlots + 1  // +1 for the user who just joined
            : 0
        return MockContest(
            id: resolved.contest.id,
            name: resolved.contest.name,
            entryCount: entryCount,
            maxEntries: resolved.contest.totalSlots,
            status: resolved.contest.status.rawValue.capitalized,
            creatorName: "Organizer",
            entryFee: resolved.contest.entryFee,
            joinToken: resolved.token,
            isJoined: true,
            lockTime: resolved.contest.lockTime
        )
    }

    /// Clear navigation state after navigating to contest
    func clearNavigationState() {
        joinedContestId = nil
        shouldNavigateToContest = false
        resolvedJoinLink = nil
    }

    /// Called after successful authentication to resume pending join
    func resumePendingJoinIfNeeded() async {
        guard let token = pendingJoinStore.retrieve() else { return }

        // Re-handle the join link
        await handle(action: .joinContest(token: token))
    }

    // MARK: - State Management

    func clearError() {
        error = nil
    }

    /// Store the current join token for resume after authentication.
    /// Called when an unauthenticated user taps "Sign In to Join".
    func storeTokenForLaterJoin() {
        guard let resolved = resolvedJoinLink else { return }
        pendingJoinStore.store(token: resolved.token)
    }

    func dismiss() {
        resolvedJoinLink = nil
        showJoinPreview = false
        currentAction = nil
    }
}
