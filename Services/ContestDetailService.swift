//
//  ContestDetailService.swift
//  PlayoffChallenge
//
//  Fetches contest detail from GET /api/custom-contests/:id.
//  Used by ContestDetailViewModel to replace placeholder data with backend truth.
//

import Foundation

/// Protocol for fetching contest detail by ID
protocol ContestDetailFetching: Sendable {
    func fetchDetail(contestId: UUID) async throws -> MockContest
    func fetchContestDetailContract(contestId: UUID) async throws -> ContestDetailResponseContract
    func fetchLeaderboard(contestId: UUID) async throws -> LeaderboardResponseContract
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

    func fetchDetail(contestId: UUID) async throws -> MockContest {
        let url = URL(string: "\(baseURL)/api/custom-contests/\(contestId.uuidString)")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let userId = getCurrentUserId() {
            request.setValue(userId.uuidString.lowercased(), forHTTPHeaderField: "X-User-Id")
            print("APIService AUTH HEADER: GET \(url.absoluteString) X-User-Id=\(userId.uuidString.lowercased())")
        } else {
            print("APIService AUTH HEADER: GET \(url.absoluteString) X-User-Id=MISSING (no authenticated user)")
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        print("APIService AUTH HEADER: Response \(http.statusCode) for GET /api/custom-contests/\(contestId.uuidString)")

        guard http.statusCode == 200 else {
            if http.statusCode == 404 { throw APIError.notFound }
            throw APIError.serverError("Server returned \(http.statusCode)")
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let dateString = try container.decode(String.self)
            if let date = ISO8601DateFormatter().date(from: dateString) {
                return date
            }
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: dateString) {
                return date
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Cannot decode date: \(dateString)")
        }

        let detail = try decoder.decode(ContestDetailResponse.self, from: data)
        return detail.toMockContest()
    }

    func fetchContestDetailContract(contestId: UUID) async throws -> ContestDetailResponseContract {
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
            let contract = try decoder.decode(ContestDetailResponseContract.self, from: data)
            return contract
        } catch {
            print("❌ Failed to decode ContestDetailResponseContract: \(error)")
            throw APIError.decodingError
        }
    }

    func fetchLeaderboard(contestId: UUID) async throws -> LeaderboardResponseContract {
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
            let contract = try decoder.decode(LeaderboardResponseContract.self, from: data)
            return contract
        } catch {
            print("❌ Failed to decode LeaderboardResponseContract: \(error)")
            throw APIError.decodingError
        }
    }
}

// MARK: - Response DTO (private to this file)

private struct ContestDetailResponse: Decodable {
    let id: UUID
    let name: String
    let status: String
    let entryFeeCents: Int?
    let entryFee: Double?
    let maxEntries: Int?
    let totalSlots: Int?
    let entriesCurrent: Int?
    let filledSlots: Int?
    let organizerName: String?
    let creatorName: String?
    let joinToken: String?
    let lockTime: Date?

    enum CodingKeys: String, CodingKey {
        case id, status
        case name = "contest_name"
        case entryFeeCents = "entry_fee_cents"
        case entryFee = "entry_fee"
        case maxEntries = "max_entries"
        case totalSlots = "total_slots"
        case entriesCurrent = "entry_count"
        case filledSlots = "filled_slots"
        case organizerName = "organizer_name"
        case creatorName = "creator_name"
        case joinToken = "join_token"
        case lockTime = "lock_time"
    }

    func toMockContest() -> MockContest {
        let fee: Double
        if let ef = entryFee {
            fee = ef
        } else if let cents = entryFeeCents {
            fee = Double(cents) / 100.0
        } else {
            fee = 0
        }

        let joinURL: URL? = joinToken.flatMap { URL(string: "https://app.67enterprises.com/join/\($0)") }

        return MockContest(
            id: id,
            name: name,
            entryCount: entriesCurrent ?? filledSlots ?? 0,
            maxEntries: maxEntries ?? totalSlots ?? 0,
            status: status,
            creatorName: organizerName ?? creatorName ?? "Unknown",
            entryFee: fee,
            joinToken: joinToken,
            joinURL: joinURL,
            isJoined: false,
            lockTime: lockTime
        )
    }
}
