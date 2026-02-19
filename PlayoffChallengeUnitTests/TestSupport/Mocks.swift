import Foundation
@testable import PlayoffChallenge

// MARK: - Test Error

enum TestError: Error, Equatable {
    case boom
}

// MARK: - Mock Contest Service

final class MockContestService: ContestServiceing, @unchecked Sendable {
    var fetchCallCount = 0
    var result: Result<[AvailableContestDTO], Error>

    init(result: Result<[AvailableContestDTO], Error>) {
        self.result = result
    }

    func fetchAvailableContests() async throws -> [AvailableContestDTO] {
        fetchCallCount += 1
        return try result.get()
    }
}

// MARK: - Mock Contest Joiner

extension MockContestJoiner {
    static func success() -> MockContestJoiner {
        let joiner = MockContestJoiner()
        joiner.joinResult = .success(
            ContestJoinResult(contestId: UUID(), userId: UUID(), joinedAt: Date(), message: "Joined")
        )
        return joiner
    }
}

// MARK: - Mock Contest Detail Fetcher

@MainActor
final class MockContestDetailFetcher: ContestDetailFetching, @unchecked Sendable {
    var fetchDetailCallCount = 0
    var fetchContractCallCount = 0
    var fetchLeaderboardCallCount = 0

    var lastDetailContestId: UUID?
    var lastContractContestId: UUID?
    var lastLeaderboardContestId: UUID?

    var detailResult: Result<MockContest, Error>
    var contractResult: Result<ContestDetailResponseContract, Error>
    var leaderboardResult: Result<LeaderboardResponseContract, Error>

    init(
        detailResult: Result<MockContest, Error>? = nil,
        contractResult: Result<ContestDetailResponseContract, Error>? = nil,
        leaderboardResult: Result<LeaderboardResponseContract, Error>? = nil
    ) {
        self.detailResult = detailResult ?? .success(.fixture())
        self.contractResult = contractResult ?? .success(.fixture())
        self.leaderboardResult = leaderboardResult ?? .success(.fixture())
    }

    func fetchDetail(contestId: UUID) async throws -> MockContest {
        fetchDetailCallCount += 1
        lastDetailContestId = contestId
        return try detailResult.get()
    }

    func fetchContestDetailContract(contestId: UUID) async throws -> ContestDetailResponseContract {
        fetchContractCallCount += 1
        lastContractContestId = contestId
        return try contractResult.get()
    }

    func fetchLeaderboard(contestId: UUID) async throws -> LeaderboardResponseContract {
        fetchLeaderboardCallCount += 1
        lastLeaderboardContestId = contestId
        return try leaderboardResult.get()
    }

    func reset() {
        fetchDetailCallCount = 0
        fetchContractCallCount = 0
        fetchLeaderboardCallCount = 0
        lastDetailContestId = nil
        lastContractContestId = nil
        lastLeaderboardContestId = nil
        detailResult = .success(.fixture())
        contractResult = .success(.fixture())
        leaderboardResult = .success(.fixture())
    }
}

// MARK: - Test Fixtures

extension AvailableContestDTO {
    static func fixture(
        id: UUID = UUID(),
        contest_name: String = "Test Contest",
        status: String = "SCHEDULED",
        entry_count: Int = 5,
        max_entries: Int? = 20,
        user_has_entered: Bool = false,
        is_platform_owned: Bool? = nil,
        join_token: String? = "testtoken",
        lock_time: Date? = nil,
        created_at: Date? = nil,
        start_time: Date? = nil,
        end_time: Date? = nil,
        entry_fee_cents: Int? = 2500,
        organizer_name: String? = "Organizer"
    ) -> AvailableContestDTO {
        AvailableContestDTO(
            id: id,
            contest_name: contest_name,
            status: status,
            entry_count: entry_count,
            max_entries: max_entries,
            user_has_entered: user_has_entered,
            is_platform_owned: is_platform_owned,
            join_token: join_token,
            lock_time: lock_time,
            created_at: created_at,
            start_time: start_time,
            end_time: end_time,
            entry_fee_cents: entry_fee_cents,
            organizer_name: organizer_name
        )
    }
}

extension MockContest {
    static func fixture(
        id: UUID = UUID(),
        name: String = "Test Contest",
        entryCount: Int = 5,
        maxEntries: Int = 20,
        status: ContestStatus = .scheduled,
        creatorName: String = "Organizer",
        entryFee: Double = 25.0,
        joinToken: String? = "testtoken",
        joinURL: URL? = nil,
        isJoined: Bool = false,
        lockTime: Date? = nil,
        startTime: Date? = nil,
        endTime: Date? = nil,
        actions: ContestActions? = nil
    ) -> MockContest {
        MockContest(
            id: id,
            name: name,
            entryCount: entryCount,
            maxEntries: maxEntries,
            status: status,
            creatorName: creatorName,
            entryFee: entryFee,
            joinToken: joinToken,
            joinURL: joinURL,
            isJoined: isJoined,
            lockTime: lockTime,
            startTime: startTime,
            endTime: endTime,
            actions: actions
        )
    }
}

@MainActor
extension ContestDetailResponseContract {
    static func fixture(
        contest_id: String = UUID().uuidString,
        type: String = "playoff",
        leaderboard_state: LeaderboardState = .computed,
        actions: ContestActions? = nil,
        payout_table: [PayoutTierContract] = [],
        roster_config: RosterConfigContract = [:]
    ) -> ContestDetailResponseContract {
        let defaultActions = ContestActions(
            can_join: true,
            can_edit_entry: true,
            is_live: false,
            is_closed: false,
            is_scoring: false,
            is_scored: false,
            is_read_only: false
        )

        let finalActions = actions ?? defaultActions
        let finalPayoutTable = payout_table.isEmpty ? [PayoutTierContract.fixture()] : payout_table
        let finalRosterConfig = roster_config.isEmpty ? [:] : roster_config

        // Direct initialization — no JSON bridging
        return ContestDetailResponseContract(
            contest_id: contest_id,
            type: type,
            leaderboard_state: leaderboard_state,
            actions: finalActions,
            payout_table: finalPayoutTable,
            roster_config: finalRosterConfig
        )
    }
}

extension ContestActions {
    static func fixture(
        can_join: Bool = true,
        can_edit_entry: Bool = true,
        is_live: Bool = false,
        is_closed: Bool = false,
        is_scoring: Bool = false,
        is_scored: Bool = false,
        is_read_only: Bool = false
    ) -> ContestActions {
        // Direct initialization — no JSON bridging
        ContestActions(
            can_join: can_join,
            can_edit_entry: can_edit_entry,
            is_live: is_live,
            is_closed: is_closed,
            is_scoring: is_scoring,
            is_scored: is_scored,
            is_read_only: is_read_only
        )
    }
}

extension PayoutTierContract {
    static func fixture(
        rank_min: Int = 1,
        rank_max: Int = 1,
        amount: Decimal? = Decimal(500)
    ) -> PayoutTierContract {
        PayoutTierContract(
            rank_min: rank_min,
            rank_max: rank_max,
            amount: amount
        )
    }
}

@MainActor
extension LeaderboardResponseContract {
    static func fixture(
        contest_id: String = UUID().uuidString,
        contest_type: String = "playoff",
        leaderboard_state: LeaderboardState = .computed,
        generated_at: String? = nil,
        column_schema: [LeaderboardColumnSchema]? = nil,
        rows: [LeaderboardRow]? = nil
    ) -> LeaderboardResponseContract {
        let defaultGeneratedAt = generated_at ?? ISO8601DateFormatter().string(from: Date())

        let defaultSchema = [
            LeaderboardColumnSchema(key: "rank", label: "Rank", type: "number", format: nil),
            LeaderboardColumnSchema(key: "name", label: "Player", type: "text", format: nil),
            LeaderboardColumnSchema(key: "points", label: "Points", type: "currency", format: "USD")
        ]

        let defaultRows: [LeaderboardRow] = [
            ["rank": AnyCodable(1), "name": AnyCodable("Player 1"), "points": AnyCodable(100.0)],
            ["rank": AnyCodable(2), "name": AnyCodable("Player 2"), "points": AnyCodable(90.0)]
        ]

        let finalSchema = column_schema ?? defaultSchema
        let finalRows = rows ?? defaultRows

        // Direct initialization — no JSON bridging
        return LeaderboardResponseContract(
            contest_id: contest_id,
            contest_type: contest_type,
            leaderboard_state: leaderboard_state,
            generated_at: defaultGeneratedAt,
            column_schema: finalSchema,
            rows: finalRows
        )
    }
}
