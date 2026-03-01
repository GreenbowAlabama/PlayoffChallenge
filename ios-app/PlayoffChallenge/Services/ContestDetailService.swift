//
//  ContestDetailService.swift
//  PlayoffChallenge
//
//  Fetches contest detail from GET /api/custom-contests/:id.
//  Used by ContestDetailViewModel to replace placeholder data with backend truth.
//

import Foundation
import Core

/// Protocol for fetching contest detail by ID.
/// BOUNDARY CONTRACT: Implementations must perform pure DTO→Domain mapping only.
/// Services must NOT embed business rules, conditional domain shaping,
/// or lock/capacity/payout logic. Transport hygiene (HTTP status checks)
/// is allowed. All domain decisions belong in ViewModels or Domain layer.
/// Returns Domain types only — no DTO exposure to callers.
protocol ContestDetailFetching: Sendable {
    func fetchContestActionState(contestId: UUID) async throws -> ContestActionState
    func fetchLeaderboard(contestId: UUID) async throws -> Leaderboard
}

/// Production implementation that calls GET /api/custom-contests/:id
final class ContestDetailService: ContestDetailFetching, @unchecked Sendable {

    private let baseURL: String
    private let getCurrentUserId: () -> UUID?

    init(getCurrentUserId: @escaping () -> UUID? = { nil }) {
        self.baseURL = AppEnvironment.shared.baseURL.absoluteString
        self.getCurrentUserId = getCurrentUserId
    }

    init(baseURL: String, getCurrentUserId: @escaping () -> UUID? = { nil }) {
        self.baseURL = baseURL
        self.getCurrentUserId = getCurrentUserId
    }

    func fetchContestActionState(contestId: UUID) async throws -> ContestActionState {
        let url = URL(string: "\(baseURL)/api/custom-contests/\(contestId.uuidString)")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let userId = getCurrentUserId() {
            request.setValue(userId.uuidString.lowercased(), forHTTPHeaderField: "X-User-Id")
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard http.statusCode == 200 else {
            if http.statusCode == 404 { throw APIError.notFound }
            throw APIError.serverError("Server returned \(http.statusCode)")
        }

        let decoder = JSONDecoder.iso8601Decoder
        do {
            let contract = try decoder.decode(Core.ContestDetailResponseContract.self, from: data)
            return ContestActionState.from(contract)
        } catch {
            print("❌ Failed to decode and map ContestActionState: \(error)")
            throw APIError.decodingError
        }
    }

    func fetchLeaderboard(contestId: UUID) async throws -> Leaderboard {
        let url = URL(string: "\(baseURL)/api/custom-contests/\(contestId.uuidString)/leaderboard")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let userId = getCurrentUserId() {
            request.setValue(userId.uuidString.lowercased(), forHTTPHeaderField: "X-User-Id")
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard http.statusCode == 200 else {
            if http.statusCode == 404 { throw APIError.notFound }
            throw APIError.serverError("Server returned \(http.statusCode)")
        }

        let decoder = JSONDecoder.iso8601Decoder
        do {
            let contract = try decoder.decode(Core.LeaderboardResponseContract.self, from: data)
            return Core.Leaderboard.from(contract)
        } catch {
            print("❌ Failed to decode and map Leaderboard: \(error)")
            throw APIError.decodingError
        }
    }
}
