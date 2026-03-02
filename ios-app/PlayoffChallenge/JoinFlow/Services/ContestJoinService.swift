//
//  ContestJoinService.swift
//  PlayoffChallenge
//
//  Production implementation of ContestJoining.
//  Adapter wrapping APIService.shared for authenticated contest joins.
//

import Foundation

/// Production implementation of ContestJoining.
/// Wraps the authenticated join endpoint via APIService.
final class ContestJoinService: ContestJoining {
    private let baseURL: String

    init(baseURL: String? = nil) {
        self.baseURL = baseURL ?? AppEnvironment.shared.baseURL.absoluteString
    }

    func joinContest(contestId: UUID, token: String, userId: UUID) async throws -> ContestJoinResult {
        return try await performJoin(contestId: contestId, token: token, userId: userId)
    }

    func joinSystemContest(contestId: UUID, userId: UUID) async throws -> ContestJoinResult {
        return try await performJoin(contestId: contestId, token: nil, userId: userId)
    }

    private func performJoin(
        contestId: UUID,
        token: String?,
        userId: UUID
    ) async throws -> ContestJoinResult {
        // For private contests: token is required
        if let token = token, token.isEmpty {
            throw JoinLinkError.contestNotFound
        }

        guard let url = URL(string: "\(baseURL)/api/custom-contests/\(contestId.uuidString)/join") else {
            throw JoinLinkError.contestNotFound
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userId.uuidString, forHTTPHeaderField: "X-User-Id")

        let body: [String: Any] = token.map { ["token": $0] } ?? [:]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw JoinLinkError.networkError(underlying: "Invalid response")
            }

            switch httpResponse.statusCode {
            case 200...299:
                var decoded: JoinContestAPIResponse?
                if !data.isEmpty {
                    let decoder = JSONDecoder.iso8601Decoder
                    do {
                        decoded = try decoder.decode(JoinContestAPIResponse.self, from: data)
                    } catch {
                        print("❌ DECODE ERROR - POST /api/custom-contests/\(contestId.uuidString)/join")
                        print("Error: \(error)")
                        if let rawJSON = String(data: data, encoding: .utf8) {
                            print("Raw response: \(rawJSON)")
                        }
                    }
                }
                return ContestJoinResult(
                    contestId: decoded?.contestId ?? contestId,
                    userId: userId,
                    joinedAt: decoded?.joinedAt ?? Date(),
                    message: decoded?.message ?? "Successfully joined contest"
                )

            case 409:
                throw JoinLinkError.alreadyJoined

            case 400:
                if let errorResponse = try? JSONDecoder().decode(JoinAPIErrorResponse.self, from: data) {
                    throw mapAPIError(errorResponse)
                }
                throw JoinLinkError.contestNotFound

            case 401:
                throw JoinLinkError.notAuthenticated

            case 403:
                throw JoinLinkError.contestLocked

            case 404:
                throw JoinLinkError.contestNotFound

            default:
                throw JoinLinkError.serverError(message: "Server returned \(httpResponse.statusCode)")
            }

        } catch let error as JoinLinkError {
            throw error
        } catch {
            throw JoinLinkError.networkError(underlying: error.localizedDescription)
        }
    }


    private func mapAPIError(_ response: JoinAPIErrorResponse) -> JoinLinkError {
        switch response.code {
        case "ALREADY_JOINED":
            return .alreadyJoined
        case "CONTEST_FULL":
            return .contestFull
        case "CONTEST_LOCKED":
            return .contestLocked
        case "CONTEST_UNAVAILABLE":
            return .contestUnavailable
        case "CONTEST_COMPLETED":
            return .contestCompleted
        case "CONTEST_NOT_FOUND":
            return .contestNotFound
        default:
            return .serverError(message: response.message)
        }
    }
}

// MARK: - API Response Types (internal)

private struct JoinContestAPIResponse: Codable {
    let contestId: UUID?
    let message: String?
    let joinedAt: Date?

    enum CodingKeys: String, CodingKey {
        case contestId = "contest_id"
        case message
        case joinedAt = "joined_at"
    }
}

private struct JoinAPIErrorResponse: Codable {
    let code: String
    let message: String
}
