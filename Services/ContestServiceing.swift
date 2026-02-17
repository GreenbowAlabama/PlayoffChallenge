//
//  ContestServiceing.swift
//  PlayoffChallenge
//
//  Protocol seam for contest fetching (enables testing without final class constraint)
//

import Foundation

/// Protocol for fetching available contests
protocol ContestServiceing: Sendable {
    func fetchAvailableContests() async throws -> [AvailableContestDTO]
}
