//
//  JoinLinkService.swift
//  PlayoffChallenge
//
//  Production implementation of JoinLinkResolving.
//  Adapter wrapping APIService.shared for GET /api/custom-contests/join/:token
//

import Foundation

/// Production implementation of JoinLinkResolving.
/// Wraps the /api/custom-contests/join/:token endpoint via APIService.
final class JoinLinkService: JoinLinkResolving {
    private let baseURL: String
    private let currentEnvironment: String

    init(baseURL: String? = nil, environment: String? = nil) {
        self.baseURL = baseURL ?? AppEnvironment.shared.baseURL.absoluteString
        self.currentEnvironment = environment ?? (self.baseURL.contains("staging") ? "staging" : "production")
    }

    func resolve(token: String) async throws -> ResolvedJoinLink {
        guard !token.isEmpty else {
            throw JoinLinkError.contestNotFound
        }

        guard let url = URL(string: "\(baseURL)/api/custom-contests/join/\(token)") else {
            throw JoinLinkError.contestNotFound
        }

        do {
            let (data, response) = try await URLSession.shared.data(from: url)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw JoinLinkError.networkError(underlying: "Invalid response")
            }

            switch httpResponse.statusCode {
            case 200:
                do {
                    let decoder = JSONDecoder.iso8601Decoder
                    let decoded = try decoder.decode(JoinLinkAPIResponse.self, from: data)
                    return try mapToResolvedJoinLink(decoded, token: token)
                } catch {
                    print("❌ DECODE ERROR - GET /api/custom-contests/join/\(token)")
                    print("Error: \(error)")
                    if let rawJSON = String(data: data, encoding: .utf8) {
                        print("Raw response: \(rawJSON)")
                    }
                    throw error
                }

            case 404:
                throw JoinLinkError.contestNotFound

            case 400:
                if let errorResponse = try? JSONDecoder().decode(APIErrorResponse.self, from: data) {
                    throw mapAPIError(errorResponse)
                }
                throw JoinLinkError.contestNotFound

            case 410:
                throw JoinLinkError.contestUnavailable

            default:
                throw JoinLinkError.serverError(message: "Server returned \(httpResponse.statusCode)")
            }

        } catch let error as JoinLinkError {
            throw error
        } catch {
            throw JoinLinkError.networkError(underlying: error.localizedDescription)
        }
    }

    private func mapToResolvedJoinLink(_ response: JoinLinkAPIResponse, token: String) throws -> ResolvedJoinLink {
        // Handle invalid responses (backend returns 200 with valid: false for various errors)
        guard response.valid else {
            // Check for environment mismatch first
            if response.environmentMismatch == true,
               let tokenEnv = response.tokenEnvironment,
               let currentEnv = response.currentEnvironment {
                throw JoinLinkError.environmentMismatch(expected: tokenEnv, actual: currentEnv)
            }

            // Map error codes to specific errors
            if let errorCode = response.errorCode {
                switch errorCode {
                case "CONTEST_NOT_FOUND":
                    throw JoinLinkError.contestNotFound
                case "CONTEST_UNAVAILABLE":
                    throw JoinLinkError.contestUnavailable
                case "CONTEST_COMPLETED":
                    throw JoinLinkError.contestCompleted
                case "CONTEST_LOCKED":
                    throw JoinLinkError.contestLocked
                case "CONTEST_FULL":
                    throw JoinLinkError.contestFull
                case "CONTEST_ENV_MISMATCH":
                    let tokenEnv = response.tokenEnvironment ?? "unknown"
                    let currentEnv = response.currentEnvironment ?? currentEnvironment
                    throw JoinLinkError.environmentMismatch(expected: tokenEnv, actual: currentEnv)
                default:
                    throw JoinLinkError.serverError(message: response.reason ?? "Unknown error")
                }
            }

            throw JoinLinkError.serverError(message: response.reason ?? "Invalid join link")
        }

        // Valid response must have contest info with an ID for routing
        guard let contestInfo = response.contest else {
            throw JoinLinkError.serverError(message: "Server returned valid response without contest data")
        }

        // Check for environment mismatch even on valid responses
        var mismatch: EnvironmentMismatch?
        if response.environmentMismatch == true,
           let tokenEnv = response.tokenEnvironment,
           let currentEnv = response.currentEnvironment {
            mismatch = EnvironmentMismatch(
                expectedEnvironment: tokenEnv,
                actualEnvironment: currentEnv,
                message: "This link is for \(tokenEnv), but you're using \(currentEnv)"
            )
        }

        // Only extract contestId — all metadata fetched via GET /api/custom-contests/:id
        return ResolvedJoinLink(
            token: token,
            contestId: contestInfo.id,
            isValidForEnvironment: mismatch == nil,
            environmentMismatch: mismatch
        )
    }

    // TODO: Add CONTEST_ENV_MISMATCH handling once APIErrorResponse carries
    // tokenEnvironment and currentEnvironment fields.
    private func mapAPIError(_ response: APIErrorResponse) -> JoinLinkError {
        switch response.code {
        case "CONTEST_NOT_FOUND":
            return .contestNotFound
        case "CONTEST_UNAVAILABLE":
            return .contestUnavailable
        case "CONTEST_COMPLETED":
            return .contestCompleted
        case "CONTEST_LOCKED":
            return .contestLocked
        case "CONTEST_FULL":
            return .contestFull
        default:
            return .serverError(message: response.message)
        }
    }
}

// MARK: - API Response Types (internal)

/// Matches the actual backend `/api/custom-contests/join/:token` response structure
private struct JoinLinkAPIResponse: Codable {
    let valid: Bool
    let contest: ContestInfo?
    let reason: String?
    let errorCode: String?
    let environmentMismatch: Bool?
    let tokenEnvironment: String?
    let currentEnvironment: String?

    struct ContestInfo: Codable {
        let id: UUID
        let name: String?          // Custom contest instance name
        let templateId: UUID?
        let templateName: String?  // Optional for locked/expired contests
        let templateSport: String?
        let entryFeeCents: Int?  // Optional for locked/expired contests
        let maxEntries: Int?     // Contest capacity (nil = unlimited)
        let currentEntries: Int? // Current participant count
        let payoutStructure: PayoutStructure?
        let status: String
        let startTime: Date?
        let lockTime: Date?
        let computedJoinState: String?
        let creatorName: String?

        enum CodingKeys: String, CodingKey {
            case id
            case name
            case templateId = "template_id"
            case templateName = "template_name"
            case templateSport = "template_sport"
            case entryFeeCents = "entry_fee_cents"
            case maxEntries = "max_entries"
            case currentEntries = "current_entries"
            case payoutStructure = "payout_structure"
            case status
            case startTime = "start_time"
            case lockTime = "lock_time"
            case computedJoinState = "computed_join_state"
            case creatorName = "creator_name"
        }
    }

    struct PayoutStructure: Codable {
        let type: String?
        let places: Int?
    }

    enum CodingKeys: String, CodingKey {
        case valid
        case contest
        case reason
        case errorCode = "error_code"
        case environmentMismatch = "environment_mismatch"
        case tokenEnvironment = "token_environment"
        case currentEnvironment = "current_environment"
    }
}

private struct APIErrorResponse: Codable {
    let code: String
    let message: String
}
