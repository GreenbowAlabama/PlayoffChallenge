//
//  ContestDetailViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for managing contest detail state.
//  Sole owner of the join action.
//  Always fetches fresh data from backend by contestId.
//

import Combine
import Foundation

/// ViewModel for Contest Detail screen.
/// Sole owner of join logic — all join paths terminate here.
/// Always fetches contest detail from backend; injected data is placeholder only.
@MainActor
final class ContestDetailViewModel: ObservableObject {

    // MARK: - Published State

    @Published private(set) var contest: MockContest
    @Published private(set) var isJoined: Bool
    @Published private(set) var isLoading = false
    @Published private(set) var isFetching = false
    @Published private(set) var isJoining = false
    @Published private(set) var errorMessage: String?

    // MARK: - Dependencies

    let contestId: UUID
    private let contestJoiner: ContestJoining
    private let detailFetcher: ContestDetailFetching
    private let joinedStore: JoinedContestsStore
    private var currentUserId: UUID?
    private var hasFetched = false

    // MARK: - Initialization

    init(
        contestId: UUID,
        placeholder: MockContest? = nil,
        contestJoiner: ContestJoining,
        detailFetcher: ContestDetailFetching? = nil,
        joinedStore: JoinedContestsStore? = nil,
        getCurrentUserId: @escaping () -> UUID? = {
            guard let s = UserDefaults.standard.string(forKey: "userId") else { return nil }
            return UUID(uuidString: s)
        }
    ) {
        self.contestId = contestId
        self.contestJoiner = contestJoiner
        self.detailFetcher = detailFetcher ?? ContestDetailService(getCurrentUserId: getCurrentUserId)
        self.joinedStore = joinedStore ?? JoinedContestsStore.shared

        // Use placeholder if provided, otherwise create a minimal loading state
        let initial = placeholder ?? MockContest(
            id: contestId,
            name: "Loading…",
            entryCount: 0,
            maxEntries: 0,
            status: "Loading",
            creatorName: "—"
        )
        self.contest = initial

        // Check JoinedContestsStore as source of truth for joined state
        let persistedJoined = self.joinedStore.isJoined(contestId: contestId)
        self.isJoined = persistedJoined || initial.isJoined
    }

    /// Configure the user ID for join operations
    func configure(currentUserId: UUID?) {
        self.currentUserId = currentUserId
    }

    // MARK: - Backend Fetch (source of truth)

    /// Fire-and-forget wrapper for use in synchronous contexts (e.g. init).
    func fetchContestDetailDetached() {
        Task { [weak self] in
            await self?.fetchContestDetail()
        }
    }

    /// Fetches contest detail from the backend. Called once on appearance.
    /// Overwrites all placeholder data with the authoritative backend response.
    func fetchContestDetail() async {
        guard !hasFetched || contest.status == "Loading" else { return }
        isFetching = true
        print("JOIN PREVIEW FETCHING CONTEST DETAIL \(contestId)")

        do {
            let fetched = try await detailFetcher.fetchDetail(contestId: contestId)

            // Backend response is the single source of truth — no merging with placeholder
            contest = fetched
            hasFetched = true
            print("ContestDetailViewModel: contest set → \(fetched.id)")
            isJoined = fetched.isJoined || joinedStore.isJoined(contestId: contestId)
        } catch {
            // On fetch failure, keep placeholder data — don't blank the screen
            print("ContestDetailViewModel: fetch failed — \(error.localizedDescription)")
        }

        isFetching = false
    }

    // MARK: - Joinability (single source of truth)

    /// Whether the user can join this contest.
    var canJoinContest: Bool {
        guard !isJoined else { return false }
        let statusOpen = contest.status.lowercased() == "open"
        let notFull = !contest.isFull
        return statusOpen && notFull
    }

    var canSelectLineup: Bool {
        isJoined && contest.status.lowercased() != "completed"
    }

    var canViewRules: Bool {
        true
    }

    var canViewLeaderboard: Bool {
        true
    }

    var joinButtonTitle: String {
        if isJoined {
            return "Joined"
        }
        if contest.isFull {
            return "Contest Full"
        }
        if contest.status.lowercased() == "locked" {
            return "Contest Locked"
        }
        return "Join Contest"
    }

    var statusMessage: String? {
        if !isJoined && contest.status.lowercased() == "open" && !contest.isFull {
            return "Join this contest to select your lineup"
        }
        if !isJoined && contest.isFull {
            return "This contest is full"
        }
        if !isJoined && contest.status.lowercased() == "locked" {
            return "This contest is locked"
        }
        return nil
    }

    // MARK: - Actions

    /// Refresh contest data from the server
    func refresh() async {
        isLoading = true
        errorMessage = nil

        // Re-fetch from backend
        hasFetched = false
        await fetchContestDetail()

        isLoading = false
    }

    /// Increment participant count (called after another user joins)
    func incrementParticipantCount() {
        contest = MockContest(
            id: contest.id,
            name: contest.name,
            entryCount: contest.entryCount + 1,
            maxEntries: contest.maxEntries,
            status: contest.status,
            creatorName: contest.creatorName,
            entryFee: contest.entryFee,
            joinToken: contest.joinToken,
            isJoined: contest.isJoined,
            lockTime: contest.lockTime
        )
        CreatedContestsStore.shared.update(contest)
    }

    /// Attempt to join the contest. This is the sole join entry point in the app.
    func joinContest() async {
        guard let userId = currentUserId else {
            errorMessage = "Please sign in to join this contest."
            return
        }

        guard let token = contest.joinToken else {
            errorMessage = "This contest cannot be joined (no join token)."
            return
        }

        isJoining = true
        errorMessage = nil

        do {
            _ = try await contestJoiner.joinContest(contestId: contest.id, token: token, userId: userId)
            isJoined = true
            updateContestWithJoinedState()
        } catch let error as JoinLinkError {
            handleJoinError(error)
        } catch {
            errorMessage = error.localizedDescription
        }

        isJoining = false
    }

    // MARK: - Private Helpers

    private func handleJoinError(_ error: JoinLinkError) {
        switch error {
        case .alreadyJoined:
            // Idempotent — treat as success
            isJoined = true
            updateContestWithJoinedState()
            errorMessage = nil
        case .contestFull:
            errorMessage = "This contest is now full."
        case .contestLocked:
            errorMessage = "This contest is locked and no longer accepting entries."
        case .notAuthenticated:
            errorMessage = "Please sign in to join this contest."
        default:
            errorMessage = error.errorDescription
        }
    }

    private func updateContestWithJoinedState() {
        let updatedContest = MockContest(
            id: contest.id,
            name: contest.name,
            entryCount: isJoined ? contest.entryCount + 1 : contest.entryCount,
            maxEntries: contest.maxEntries,
            status: contest.status,
            creatorName: contest.creatorName,
            entryFee: contest.entryFee,
            joinToken: contest.joinToken,
            isJoined: isJoined,
            lockTime: contest.lockTime
        )
        contest = updatedContest

        if isJoined {
            joinedStore.markJoined(updatedContest)
        }
    }

    func clearError() {
        errorMessage = nil
    }

    func formattedLockTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
