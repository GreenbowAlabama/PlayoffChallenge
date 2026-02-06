//
//  JoinPreviewViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for the join preview screen.
//

import Foundation

/// ViewModel for the join preview screen.
/// Simple value-based view model for computed properties.
final class JoinPreviewViewModel {

    // MARK: - Input Data

    let resolvedLink: ResolvedJoinLink
    let isAuthenticated: Bool

    // MARK: - UI State (simple properties, not @Published)

    var isJoining = false
    var joinError: JoinLinkError?
    var joinSucceeded = false

    // MARK: - Initialization

    init(
        resolvedLink: ResolvedJoinLink,
        isAuthenticated: Bool
    ) {
        self.resolvedLink = resolvedLink
        self.isAuthenticated = isAuthenticated
    }

    // MARK: - Computed Properties

    var contestName: String {
        resolvedLink.contest.name
    }

    var entryFee: String {
        String(format: "$%.2f", resolvedLink.contest.entryFee)
    }

    /// Whether slot information is available from the backend
    var hasSlotsInfo: Bool {
        resolvedLink.contest.hasSlotInfo
    }

    var slotsRemaining: Int {
        resolvedLink.contest.slotsRemaining
    }

    /// Capacity text for the availability label.
    /// Shows "X / Y entries" when slot info is available, otherwise "Open".
    var capacityText: String {
        guard hasSlotsInfo else {
            return "Open"
        }
        return "\(resolvedLink.contest.filledSlots) / \(resolvedLink.contest.totalSlots) entries"
    }

    var slotsRemainingText: String {
        // Backend doesn't always return slot counts
        guard hasSlotsInfo else {
            return "Open"
        }

        if slotsRemaining == 0 {
            return "Full"
        } else if slotsRemaining == 1 {
            return "1 spot left"
        } else {
            return "\(slotsRemaining) spots left"
        }
    }

    /// Formatted lock time for display, or nil if no lock time
    var lockTimeText: String? {
        guard let lockTime = resolvedLink.contest.lockTime else { return nil }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return "Entries close at \(formatter.string(from: lockTime))"
    }

    /// Whether the contest is past its lock time
    var isLocked: Bool {
        resolvedLink.contest.isLocked
    }

    var primaryButtonTitle: String {
        if isLocked {
            return "Entries Closed"
        }
        return isAuthenticated ? "Join Contest" : "Sign In to Join"
    }

    var canJoin: Bool {
        // isFull now correctly returns false when slot info is missing,
        // so we can simplify to: not full AND status is open AND not past lock time
        !resolvedLink.contest.isFull && resolvedLink.contest.status == .open && !isLocked
    }
}
