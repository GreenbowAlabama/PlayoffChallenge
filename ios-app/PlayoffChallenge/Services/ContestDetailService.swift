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
/// User identity is EXPLICIT parameter, never resolved internally.
protocol ContestDetailFetching: Sendable {
    func fetchContestActionState(contestId: UUID, userId: UUID?) async throws -> ContestActionState
    func fetchLeaderboard(contestId: UUID, userId: UUID?) async throws -> Leaderboard
}

/// Production implementation that calls GET /api/custom-contests/:id
/// Stateless service — user identity is explicitly provided by caller.
final class ContestDetailService: ContestDetailFetching, @unchecked Sendable {

    private let baseURL: String

    init() {
        self.baseURL = AppEnvironment.shared.baseURL.absoluteString
    }

    init(baseURL: String) {
        self.baseURL = baseURL
    }

    func fetchContestActionState(contestId: UUID, userId: UUID?) async throws -> ContestActionState {
        let url = URL(string: "\(baseURL)/api/custom-contests/\(contestId.uuidString)")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let userId = userId {
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

    func fetchLeaderboard(contestId: UUID, userId: UUID?) async throws -> Leaderboard {
        let url = URL(string: "\(baseURL)/api/custom-contests/\(contestId.uuidString)/leaderboard")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let userId = userId {
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
            // Decode to LeaderboardAPIResponse (handles correct backend field names)
            let apiResponse = try decoder.decode(LeaderboardAPIResponse.self, from: data)

            // Map API response to Core.LeaderboardResponseContract
            let contract = mapLeaderboardAPIResponseToContract(apiResponse)

            // Convert contract to domain model
            return Core.Leaderboard.from(contract)
        } catch {
            print("❌ Failed to decode and map Leaderboard: \(error)")
            throw APIError.decodingError
        }
    }

    /// Maps LeaderboardAPIResponse to Core.LeaderboardResponseContract.
    /// Handles field name normalization (user_display_name → username) at iOS boundary.
    /// Converts JSONValue (iOS) to AnyCodable (Core) for values dict.
    private func mapLeaderboardAPIResponseToContract(_ apiResponse: LeaderboardAPIResponse) -> Core.LeaderboardResponseContract {
        // Map column schema
        let columns = apiResponse.column_schema.map { col in
            Core.LeaderboardColumnSchema(
                key: col.key,
                label: col.label,
                type: col.type,
                format: col.format
            )
        }

        // Map rows with field name normalization and JSONValue → AnyCodable conversion
        let rows = apiResponse.rows.map { row in
            // Convert JSONValue dict to AnyCodable dict
            let anyCodableValues = row.values.mapValues { jsonValue in
                convertJSONValueToAnyCodable(jsonValue)
            }

            // Add username field (normalized from user_display_name)
            var normalizedValues = anyCodableValues
            normalizedValues["username"] = Core.AnyCodable(row.user_display_name)

            // Create LeaderboardRowContract with normalized fields
            return Core.LeaderboardRowContract(
                id: row.id,
                userId: row.user_id,
                username: row.user_display_name,  // Normalize: user_display_name → username
                rank: row.rank,
                values: normalizedValues,
                tier: row.tier
            )
        }

        // Create LeaderboardStateContract from string
        let leaderboardState = Core.LeaderboardStateContract(rawValue: apiResponse.leaderboard_state) ?? Core.LeaderboardStateContract.unknown

        // Return contract with all fields
        return Core.LeaderboardResponseContract(
            contest_id: apiResponse.contest_id,
            contest_type: apiResponse.contest_type,
            leaderboard_state: leaderboardState,
            generated_at: apiResponse.generated_at,
            column_schema: columns,
            rows: rows
        )
    }

    /// Converts JSONValue (iOS contract type) to Core.AnyCodable.
    private func convertJSONValueToAnyCodable(_ value: JSONValue) -> Core.AnyCodable {
        switch value {
        case .null:
            return Core.AnyCodable(NSNull())
        case .bool(let b):
            return Core.AnyCodable(b)
        case .number(let n):
            return Core.AnyCodable(n)
        case .string(let s):
            return Core.AnyCodable(s)
        case .array(let arr):
            let converted = arr.map { convertJSONValueToAnyCodable($0) }
            return Core.AnyCodable(converted)
        case .object(let obj):
            let converted = obj.mapValues { convertJSONValueToAnyCodable($0) }
            return Core.AnyCodable(converted)
        }
    }
}
