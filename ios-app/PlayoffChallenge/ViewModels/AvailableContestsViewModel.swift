//
//  AvailableContestsViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for the Available Contests list.
//

import Combine
import Foundation
import Core

/// ViewModel for the Available Contests screen.
/// Loads and manages the list of joinable contests from backend.
/// Backend is authoritative for filtering, capacity, sorting, and user_has_entered.
@MainActor
final class AvailableContestsViewModel: ObservableObject {

    // MARK: - Published State

    @Published private(set) var contests: [Contest] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    // MARK: - Computed Properties

    var featuredContests: [Contest] {
        contests
            .filter { $0.isPlatformOwned == true }
            .filter { $0.status != .complete && $0.status != .cancelled }
            .filter { contest in
                // PRESENTATION ONLY: Hide scheduled contests that have passed lock_time from
                // featured display. This is a display-freshness filter, not a join gate.
                // Join eligibility is determined exclusively by backend actions.canJoin.
                // Backend re-validates all join constraints on every join attempt.
                if contest.status == .scheduled,
                   let lockTime = contest.lockTime,
                   Date.now > lockTime {
                    return false
                }
                return true
            }
            .sorted { lhs, rhs in
                if lhs.status == .live && rhs.status != .live { return true }
                if lhs.status != .live && rhs.status == .live { return false }

                guard let l = lhs.lockTime, let r = rhs.lockTime else {
                    return false
                }

                return l < r
            }
    }

    var regularContests: [Contest] {
        contests
            .filter { $0.isPlatformOwned != true }
            .filter { $0.status != .complete && $0.status != .cancelled }
            .sorted { lhs, rhs in
                // Live first, then by remaining time for scheduled
                if lhs.status == .live && rhs.status != .live { return true }
                if lhs.status != .live && rhs.status == .live { return false }

                // For scheduled contests, sort by remaining time (upcoming first)
                let lhsUpcoming = lhs.status == .scheduled && isUpcomingScheduled(lhs)
                let rhsUpcoming = rhs.status == .scheduled && isUpcomingScheduled(rhs)

                if lhsUpcoming && rhsUpcoming {
                    let remaining1 = remainingTimeUntilLock(lhs)
                    let remaining2 = remainingTimeUntilLock(rhs)
                    return remaining1 < remaining2
                }

                // Upcoming scheduled comes before expired
                if lhsUpcoming && !rhsUpcoming { return true }
                if !lhsUpcoming && rhsUpcoming { return false }

                // Both expired or non-scheduled: sort by lock time
                guard let l = lhs.lockTime, let r = rhs.lockTime else {
                    return false
                }
                return l < r
            }
    }

    private func isUpcomingScheduled(_ contest: Contest) -> Bool {
        guard contest.status == .scheduled, let lockTime = contest.lockTime else {
            return false
        }
        return Date.now < lockTime
    }

    private func remainingTimeUntilLock(_ contest: Contest) -> TimeInterval {
        guard let lockTime = contest.lockTime else {
            return .infinity
        }
        return lockTime.timeIntervalSince(Date.now)
    }

    var showFeaturedSection: Bool {
        !featuredContests.isEmpty
    }

    // MARK: - Dependencies

    private let service: ContestServiceing

    // MARK: - Initialization

    init(service: ContestServiceing = CustomContestService()) {
        self.service = service
    }

    // MARK: - Actions

    func loadContests() async {
        isLoading = true
        errorMessage = nil

        do {
            let domainContests = try await service.fetchAvailableContests()
            print("[AvailableContestsViewModel] Loaded \(domainContests.count) domain objects from backend")

            // Use Domain objects directly.
            // Backend handles filtering, capacity, sorting, and user_has_entered (via actions.isJoined if applicable).
            // Client does NOT filter, sort, or modify entry counts.
            contests = domainContests

            print("[AvailableContestsViewModel] Loaded \(contests.count) Contest objects")
            for (index, contest) in contests.enumerated() {
                print("[AvailableContestsViewModel] Contest \(index): \(contest.contestName) (status: \(contest.status), entries: \(contest.entryCount))")
            }

            errorMessage = nil
        } catch {
            print("[AvailableContestsViewModel] ERROR loading contests: \(error)")
            // CRITICAL: Clear stale contests when error occurs to prevent ghost rows.
            // Error state and data state must be mutually exclusive.
            contests = []
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    func refresh() async {
        await loadContests()
    }
}
