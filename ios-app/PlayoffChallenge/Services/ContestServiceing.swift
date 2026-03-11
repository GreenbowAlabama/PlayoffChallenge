//
//  ContestServiceing.swift
//  PlayoffChallenge
//
//  Protocol seam for contest fetching (enables testing without final class constraint)
//

import Foundation
import Core

/// Protocol for fetching contests
protocol ContestServiceing: Sendable {
    func fetchAvailableContests() async throws -> [Contest]
    func fetchAvailableContestsWithPresentationMetadata() async throws -> (dtos: [Core.ContestListItemDTO], contests: [Contest])
    func fetchCreatedContests() async throws -> [Contest]
}
