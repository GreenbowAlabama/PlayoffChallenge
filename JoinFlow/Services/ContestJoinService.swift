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
        if let baseURL = baseURL {
            self.baseURL = baseURL
        } else {
            guard let url = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String else {
                fatalError("API_BASE_URL not configured in Info.plist")
            }
            self.baseURL = url
        }
    }

    func joinContest(token: String, userId: UUID) async throws -> ContestJoinResult {
        guard !token.isEmpty else {
            throw JoinLinkError.invalidToken
        }

        guard let url = URL(string: "\(baseURL)/api/contests/join") else {
            throw JoinLinkError.invalidToken
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "token": token,
            "user_id": userId.uuidString
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw JoinLinkError.networkError(underlying: "Invalid response")
            }

            switch httpResponse.statusCode {
            case 200, 201:
                let decoded = try JSONDecoder().decode(JoinContestAPIResponse.self, from: data)
                return ContestJoinResult(
                    contestId: decoded.contestId,
                    userId: userId,
                    joinedAt: decoded.joinedAt ?? Date(),
                    message: decoded.message ?? "Successfully joined contest"
                )

            case 409:
                throw JoinLinkError.alreadyJoined

            case 400:
                if let errorResponse = try? JSONDecoder().decode(JoinAPIErrorResponse.self, from: data) {
                    throw mapAPIError(errorResponse)
                }
                throw JoinLinkError.invalidToken

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
        case "INVALID_TOKEN":
            return .invalidToken
        default:
            return .serverError(message: response.message)
        }
    }
}

// MARK: - API Response Types (internal)

private struct JoinContestAPIResponse: Codable {
    let contestId: UUID
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
