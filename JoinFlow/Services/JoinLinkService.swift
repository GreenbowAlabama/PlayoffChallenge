//
//  JoinLinkService.swift
//  PlayoffChallenge
//
//  Production implementation of JoinLinkResolving.
//  Adapter wrapping APIService.shared for GET /api/join/:token
//

import Foundation

/// Production implementation of JoinLinkResolving.
/// Wraps the /api/join/:token endpoint via APIService.
final class JoinLinkService: JoinLinkResolving {
    private let baseURL: String
    private let currentEnvironment: String

    init(baseURL: String? = nil, environment: String? = nil) {
        if let baseURL = baseURL {
            self.baseURL = baseURL
        } else {
            guard let url = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String else {
                fatalError("API_BASE_URL not configured in Info.plist")
            }
            self.baseURL = url
        }

        self.currentEnvironment = environment ?? (self.baseURL.contains("staging") ? "staging" : "production")
    }

    func resolve(token: String) async throws -> ResolvedJoinLink {
        guard !token.isEmpty else {
            throw JoinLinkError.invalidToken
        }

        guard let url = URL(string: "\(baseURL)/api/join/\(token)") else {
            throw JoinLinkError.invalidToken
        }

        do {
            let (data, response) = try await URLSession.shared.data(from: url)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw JoinLinkError.networkError(underlying: "Invalid response")
            }

            switch httpResponse.statusCode {
            case 200:
                let decoded = try JSONDecoder().decode(JoinLinkAPIResponse.self, from: data)
                return try mapToResolvedJoinLink(decoded, token: token)

            case 404:
                throw JoinLinkError.contestNotFound

            case 400:
                if let errorResponse = try? JSONDecoder().decode(APIErrorResponse.self, from: data) {
                    throw mapAPIError(errorResponse)
                }
                throw JoinLinkError.invalidToken

            case 410:
                throw JoinLinkError.tokenExpired

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
                case "INVALID_TOKEN":
                    throw JoinLinkError.invalidToken
                case "EXPIRED_TOKEN":
                    throw JoinLinkError.tokenExpired
                case "NOT_FOUND":
                    throw JoinLinkError.contestNotFound
                case "CONTEST_LOCKED":
                    throw JoinLinkError.contestLocked
                case "CONTEST_FULL":
                    throw JoinLinkError.contestFull
                case "ENVIRONMENT_MISMATCH":
                    let tokenEnv = response.tokenEnvironment ?? "unknown"
                    let currentEnv = response.currentEnvironment ?? currentEnvironment
                    throw JoinLinkError.environmentMismatch(expected: tokenEnv, actual: currentEnv)
                default:
                    throw JoinLinkError.serverError(message: response.reason ?? "Unknown error")
                }
            }

            throw JoinLinkError.serverError(message: response.reason ?? "Invalid join link")
        }

        // Valid response must have contest info
        guard let contestInfo = response.contest else {
            throw JoinLinkError.serverError(message: "Server returned valid response without contest data")
        }

        // Convert entry fee from cents to dollars (default to free if not provided)
        let entryFeeInDollars = Double(contestInfo.entryFeeCents ?? 0) / 100.0

        // Prefer custom contest name over template name
        let contestName = contestInfo.name ?? contestInfo.templateName ?? "Contest"

        // Use actual slot counts from backend when available
        let totalSlots = contestInfo.maxEntries ?? 0
        let filledSlots = contestInfo.currentEntries ?? 0

        // Parse lock_time from ISO-8601 string
        var lockTime: Date?
        if let lockTimeString = contestInfo.lockTime {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            lockTime = formatter.date(from: lockTimeString)
            if lockTime == nil {
                // Retry without fractional seconds
                formatter.formatOptions = [.withInternetDateTime]
                lockTime = formatter.date(from: lockTimeString)
            }
        }

        let contest = ContestSummary(
            id: contestInfo.id,
            name: contestName,
            entryFee: entryFeeInDollars,
            totalSlots: totalSlots,
            filledSlots: filledSlots,
            status: ContestStatus(rawValue: contestInfo.status) ?? .open,
            lockTime: lockTime
        )

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

        return ResolvedJoinLink(
            token: token,
            contest: contest,
            isValidForEnvironment: mismatch == nil,
            environmentMismatch: mismatch
        )
    }

    private func mapAPIError(_ response: APIErrorResponse) -> JoinLinkError {
        switch response.code {
        case "INVALID_TOKEN":
            return .invalidToken
        case "TOKEN_EXPIRED":
            return .tokenExpired
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

/// Matches the actual backend `/api/join/:token` response structure
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
        let startTime: String?
        let lockTime: String?

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
