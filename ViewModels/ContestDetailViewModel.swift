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
    @Published private(set) var contractContest: ContestDetailResponseContract?
    @Published private(set) var isJoined: Bool
    @Published private(set) var isLoading = false
    @Published private(set) var isFetching = false
    @Published private(set) var isJoining = false
    @Published private(set) var errorMessage: String?

    // MARK: - Dependencies

    let contestId: UUID
    private let contestJoiner: ContestJoining
    private let detailFetcher: ContestDetailFetching
    private let joinedStore: JoinedContestsStoring
    private var currentUserId: UUID?
    private var hasFetched = false

    // MARK: - Initialization

    init(
        contestId: UUID,
        placeholder: MockContest? = nil,
        contestJoiner: ContestJoining,
        detailFetcher: ContestDetailFetching? = nil,
        joinedStore: JoinedContestsStoring,
        getCurrentUserId: @escaping () -> UUID? = {
            guard let s = UserDefaults.standard.string(forKey: "userId") else { return nil }
            return UUID(uuidString: s)
        }
    ) {
        self.contestId = contestId
        self.contestJoiner = contestJoiner
        self.detailFetcher = detailFetcher ?? ContestDetailService(getCurrentUserId: getCurrentUserId)
        self.joinedStore = joinedStore

        // Use placeholder if provided, otherwise create a minimal loading state
        let initial = placeholder ?? MockContest(
            id: contestId,
            name: "Loading…",
            entryCount: 0,
            maxEntries: 0,
            status: .scheduled,
            creatorName: "—"
        )
        self.contest = initial

        // Backend DTO is source of truth for joined state
        self.isJoined = initial.isJoined
    }

    /// Convenience initializer for production use — provides a default joinedStore.
    @MainActor
    convenience init(
        contestId: UUID,
        placeholder: MockContest? = nil,
        contestJoiner: ContestJoining,
        detailFetcher: ContestDetailFetching? = nil,
        getCurrentUserId: @escaping () -> UUID? = {
            guard let s = UserDefaults.standard.string(forKey: "userId") else { return nil }
            return UUID(uuidString: s)
        }
    ) {
        self.init(
            contestId: contestId,
            placeholder: placeholder,
            contestJoiner: contestJoiner,
            detailFetcher: detailFetcher,
            joinedStore: JoinedContestsStore.makeForTesting(),
            getCurrentUserId: getCurrentUserId
        )
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

    /// Fetches contest detail from the backend.
    /// Overwrites all placeholder data with the authoritative backend response.
    /// Always fetches on explicit refresh, skips duplicate fetch only on initial load.
    func fetchContestDetail() async {
        guard !hasFetched || isFetching else { return }
        isFetching = true
        print("JOIN PREVIEW FETCHING CONTEST DETAIL \(contestId)")

        do {
            // Fetch the authoritative contract from backend
            let fetchedContract = try await detailFetcher.fetchContestDetailContract(contestId: contestId)
            contractContest = fetchedContract

            // Also fetch legacy data for backward compatibility
            let fetched = try await detailFetcher.fetchDetail(contestId: contestId)

            // Backend response is the single source of truth — no merging with placeholder
            contest = fetched
            hasFetched = true
            print("ContestDetailViewModel: contest set → \(fetched.id)")
            isJoined = fetched.isJoined
        } catch {
            // On fetch failure, keep placeholder data — don't blank the screen
            print("ContestDetailViewModel: fetch failed — \(error.localizedDescription)")
        }

        isFetching = false
    }

    /// Internal fetch that bypasses guard, used for refresh operations
    private func fetchContestDetailForRefresh() async {
        isFetching = true

        do {
            // Fetch the authoritative contract from backend
            let fetchedContract = try await detailFetcher.fetchContestDetailContract(contestId: contestId)
            contractContest = fetchedContract

            // Also fetch legacy data for backward compatibility
            let fetched = try await detailFetcher.fetchDetail(contestId: contestId)
            contest = fetched
            isJoined = fetched.isJoined
            print("ContestDetailViewModel: refreshed → \(fetched.id)")
        } catch {
            print("ContestDetailViewModel: refresh failed — \(error.localizedDescription)")
        }

        isFetching = false
    }

    // MARK: - Joinability (actions-driven)

    /// Whether the user can join this contest.
    /// Gated by backend-provided actions only.
    var canJoinContest: Bool {
        guard let contract = contractContest else { return false }
        return contract.actions.can_join && !isJoined
    }

    var canSelectLineup: Bool {
        guard let contract = contractContest else { return false }
        return contract.actions.can_edit_entry && isJoined
    }

    var canViewRules: Bool {
        true
    }

    var canViewLeaderboard: Bool {
        true
    }

    var joinButtonTitle: String {
        guard let contract = contractContest else { return "Join Contest" }
        if isJoined {
            return "Joined"
        }
        if !contract.actions.can_join {
            return "Cannot Join"
        }
        return "Join Contest"
    }

    var statusMessage: String? {
        guard let contract = contractContest else { return nil }
        if isJoined {
            return nil
        }
        if contract.actions.can_join {
            return "Join this contest to select your lineup"
        }
        if contract.actions.is_closed {
            return "This contest is closed"
        }
        return nil
    }

    var displayStatusMessage: String {
        contest.displayStatus
    }

    // MARK: - Actions

    /// Refresh contest data from the server
    func refresh() async {
        isLoading = true
        errorMessage = nil

        // Re-fetch from backend, bypassing the hasFetched guard
        await fetchContestDetailForRefresh()

        isLoading = false
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

            // Refetch contest detail from backend to get accurate joined state and other fields
            await fetchContestDetailForRefresh()
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


    func clearError() {
        errorMessage = nil
    }

    func formattedLockTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// Internal method for testing to update joined state directly
    func updateIsJoinedState(_ value: Bool) {
        isJoined = value
        if value {
            joinedStore.markJoined(contest)
        }
    }
}
