//
//  JoinedContestsStoring.swift
//  PlayoffChallenge
//
//  Protocol seam for joined contests tracking (enables testing)
//

import Foundation

/// Protocol for tracking which contests the user has joined
protocol JoinedContestsStoring: Sendable {
    func markJoined(_ contest: MockContest)
    func isJoined(contestId: UUID) -> Bool
    func getJoinedIds() -> [UUID]
    func getJoinedContests() -> [MockContest]
    func getContest(by id: UUID) -> MockContest?
    func updateContest(_ contest: MockContest)
    func clear()
}
