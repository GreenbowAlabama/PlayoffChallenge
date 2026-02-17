//
//  JoinedContestsStore.swift
//  PlayoffChallenge
//
//  In-memory store for tracking joined contests.
//

import Foundation

@MainActor
final class JoinedContestsStore {
    private var contests: [UUID: MockContest] = [:]

    private init() {}

    static func makeForTesting() -> JoinedContestsStore {
        JoinedContestsStore()
    }

    func markJoined(_ contest: MockContest) {
        let updated = MockContest(
            id: contest.id,
            name: contest.name,
            entryCount: contest.entryCount,
            maxEntries: contest.maxEntries,
            status: contest.status,
            creatorName: contest.creatorName,
            entryFee: contest.entryFee,
            joinToken: contest.joinToken,
            joinURL: contest.joinURL,
            isJoined: true,
            lockTime: contest.lockTime,
            startTime: contest.startTime,
            endTime: contest.endTime,
            actions: contest.actions
        )
        contests[contest.id] = updated
    }

    func isJoined(contestId: UUID) -> Bool {
        guard let contest = contests[contestId] else { return false }
        return contest.isJoined
    }

    func getJoinedIds() -> [UUID] {
        Array(contests.keys)
    }

    func getJoinedContests() -> [MockContest] {
        Array(contests.values)
    }

    func getContest(by id: UUID) -> MockContest? {
        contests[id]
    }

    func updateContest(_ contest: MockContest) {
        guard contests[contest.id] != nil else { return }
        contests[contest.id] = contest
    }

    func clear() {
        contests.removeAll()
    }
}

// MARK: - Protocol Conformance

extension JoinedContestsStore: JoinedContestsStoring {}
