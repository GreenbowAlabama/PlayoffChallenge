//
//  ContestsLandingViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for the Contests landing page.
//  Drives navigation to Create Custom Contest, Join Contest, and Resume Pending Join.
//

import Foundation
import Combine

/// Navigation intents emitted by ContestsLandingViewModel
enum ContestsLandingNavigation: Equatable {
    case createCustomContest
    case joinByLink
    case resumePendingJoin
}

/// Protocol for checking pending join state (subset of PendingJoinStoring)
protocol PendingJoinChecking {
    var hasPendingJoin: Bool { get }
}

/// ViewModel for the Contests landing page.
/// Handles navigation intent emission and pending join visibility.
@MainActor
final class ContestsLandingViewModel: ObservableObject {

    // MARK: - Published State

    /// The current navigation intent, if any
    @Published private(set) var navigationIntent: ContestsLandingNavigation?

    // MARK: - Dependencies

    private let pendingJoinChecker: PendingJoinChecking

    // MARK: - Initialization

    init(pendingJoinChecker: PendingJoinChecking) {
        self.pendingJoinChecker = pendingJoinChecker
    }

    // MARK: - Computed Properties

    /// Whether the Resume Pending Join option should be visible
    var showResumePendingJoin: Bool {
        pendingJoinChecker.hasPendingJoin
    }

    // MARK: - Actions

    /// User tapped Create Custom Contest
    func selectCreateCustomContest() {
        navigationIntent = .createCustomContest
    }

    /// User tapped Join Contest by Link
    func selectJoinByLink() {
        navigationIntent = .joinByLink
    }

    /// User tapped Resume Pending Join
    func selectResumePendingJoin() {
        navigationIntent = .resumePendingJoin
    }

    /// Clear the current navigation intent after handling
    func clearNavigationIntent() {
        navigationIntent = nil
    }
}

// MARK: - PendingJoinStoring Conformance

extension PendingJoinManager: PendingJoinChecking {
    // Already conforms via hasPendingJoin property
}
