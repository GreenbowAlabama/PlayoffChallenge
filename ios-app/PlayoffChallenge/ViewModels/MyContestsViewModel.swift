//
//  MyContestsViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for the My Contests screen.
//

import Combine
import Foundation
import Core

/// ViewModel for displaying contests user has joined or created.
@MainActor
final class MyContestsViewModel: ObservableObject {

    // MARK: - Dependencies
    private let service: ContestServiceing
    private var refreshTask: Task<Void, Never>?

    init(service: ContestServiceing = CustomContestService()) {
        self.service = service
    }

    // MARK: - Published State
    @Published private(set) var myContests: [Contest] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var deletingIds: Set<UUID> = []

    // MARK: - Computed Properties

    /// Contests sorted by priority: LIVE → LOCKED → SCHEDULED → COMPLETE → CANCELLED
    /// Within same status, sorted by creation date (descending, newest first).
    var sortedContests: [Contest] {
        myContests.sorted { contest1, contest2 in
            let priority1 = priority(for: contest1)
            let priority2 = priority(for: contest2)

            // Different priority: sort by priority
            if priority1 != priority2 {
                return priority1 < priority2
            }

            // Same priority: for upcoming scheduled contests, sort by time until lock (soonest first)
            let isUpcoming1 = contest1.status == .scheduled && isUpcomingScheduled(contest1)
            let isUpcoming2 = contest2.status == .scheduled && isUpcomingScheduled(contest2)

            if isUpcoming1 && isUpcoming2 {
                let remaining1 = remainingTimeUntilLock(contest1)
                let remaining2 = remainingTimeUntilLock(contest2)
                return remaining1 < remaining2
            }

            // For other statuses/expired: sort by createdAt descending (newest first)
            let date1 = contest1.createdAt
            let date2 = contest2.createdAt
            return date1 > date2
        }
    }

    /// Checks if a scheduled contest hasn't passed its lock time yet.
    private func isUpcomingScheduled(_ contest: Contest) -> Bool {
        guard contest.status == .scheduled, let lockTime = contest.lockTime else {
            return false
        }
        return Date.now < lockTime
    }

    /// Calculates remaining time until lock for a contest.
    /// Returns a large number if no lockTime, so they sort to the bottom.
    private func remainingTimeUntilLock(_ contest: Contest) -> TimeInterval {
        guard let lockTime = contest.lockTime else {
            return .infinity
        }
        let remaining = lockTime.timeIntervalSince(Date.now)
        return remaining
    }

    /// Determines sort priority for a contest status.
    /// Lower number = higher priority (appears first).
    /// Scheduled contests past their lock time are treated as expired and sorted lower.
    private func priority(for contest: Contest) -> Int {
        switch contest.status {
        case .live:
            return 0
        case .locked:
            return 1
        case .scheduled:
            // If lockTime has passed, treat as expired and sort below complete
            if let lockTime = contest.lockTime, Date.now > lockTime {
                return 3  // Sort with completed contests
            }
            return 2
        case .complete:
            return 3
        case .cancelled:
            return 4
        case .error:
            return 5
        }
    }

    // MARK: - Actions

    func loadMyContests() async {
        isLoading = true
        errorMessage = nil

        do {
            // Fetch both endpoints in parallel
            async let createdContests = fetchCreatedContests()
            async let joinedContests = fetchJoinedContests()

            let created = try await createdContests
            let joined = try await joinedContests

            // Merge and deduplicate by ID
            var contestMap: [UUID: Contest] = [:]

            for contest in created {
                contestMap[contest.id] = contest
            }

            for contest in joined {
                if contestMap[contest.id] == nil {
                    contestMap[contest.id] = contest
                }
            }

            // Single atomic assignment
            myContests = Array(contestMap.values).sorted { $0.id.uuidString > $1.id.uuidString }
        } catch {
            // CRITICAL: Clear stale contests when error occurs to prevent stale list display.
            // Error state and data state must be mutually exclusive.
            myContests = []
            errorMessage = "Failed to load contests: \(error.localizedDescription)"
        }

        isLoading = false
    }

    private func fetchCreatedContests() async throws -> [Contest] {
        return try await service.fetchCreatedContests()
    }

    private func fetchJoinedContests() async throws -> [Contest] {
        let contests = try await service.fetchAvailableContests()
        return contests
            .filter { $0.actions?.canEditEntry == true || $0.actions?.canUnjoin == true }
    }

    /// Get a contest by ID
    func getContest(by id: UUID) -> Contest? {
        myContests.first { $0.id == id }
    }

    // MARK: - Mutation Actions

    /// Delete a contest (organizer-only, idempotent)
    /// Removes contest from list on success or 404 (idempotent)
    func deleteContest(_ id: UUID) async {
        // Guard against double-tap
        guard !deletingIds.contains(id) else { return }

        // Cancel any in-flight refresh before mutation
        refreshTask?.cancel()

        deletingIds.insert(id)
        errorMessage = nil

        do {
            _ = try await APIService.shared.deleteContest(id: id)
            // Success — remove from list
            myContests.removeAll { $0.id == id }
        } catch APIError.notFound {
            // 404 — idempotent removal (already deleted or never existed)
            myContests.removeAll { $0.id == id }
        } catch APIError.restrictedState(let reason) {
            // 403 — permission or lifecycle error, don't remove
            errorMessage = reason
        } catch {
            // Other errors
            errorMessage = error.localizedDescription
        }

        deletingIds.remove(id)
    }

    /// Unjoin a contest (participant, idempotent)
    /// Removes contest from list on success or 404 (idempotent)
    func unjoinContest(_ id: UUID) async {
        // Guard against double-tap
        guard !deletingIds.contains(id) else { return }

        // Cancel any in-flight refresh before mutation
        refreshTask?.cancel()

        deletingIds.insert(id)
        errorMessage = nil

        do {
            _ = try await APIService.shared.unjoinContest(id: id)
            // Success — remove from list
            myContests.removeAll { $0.id == id }
        } catch APIError.notFound {
            // 404 — idempotent removal (already unjoined or contest gone)
            myContests.removeAll { $0.id == id }
        } catch APIError.restrictedState(let reason) {
            // 403 — permission or lifecycle error, don't remove
            errorMessage = reason
        } catch {
            // Other errors
            errorMessage = error.localizedDescription
        }

        deletingIds.remove(id)
    }
}
