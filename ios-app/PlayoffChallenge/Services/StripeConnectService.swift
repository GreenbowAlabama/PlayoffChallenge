//
//  StripeConnectService.swift
//  PlayoffChallenge
//
//  Service for Stripe Connect onboarding and account status.
//  Handles account linking and status checks.
//

import Foundation
import Core

/// Protocol for Stripe Connect operations.
protocol StripeConnectServicing: Sendable {
    func getOnboardingLink() async throws -> String
    func getAccountStatus() async throws -> StripeAccountStatus
}

/// Production implementation for Stripe Connect operations.
final class StripeConnectService: StripeConnectServicing, @unchecked Sendable {

    private let baseURL: String
    private let authService: AuthService

    init(authService: AuthService = .shared) {
        self.baseURL = AppEnvironment.shared.baseURL.absoluteString
        self.authService = authService
    }

    init(baseURL: String, authService: AuthService = .shared) {
        self.baseURL = baseURL
        self.authService = authService
    }

    /// Get Stripe Connect onboarding link.
    /// - Returns: URL string for onboarding
    /// - Throws: APIError on network, validation, or server error
    func getOnboardingLink() async throws -> String {
        let url = URL(string: "\(baseURL)/api/stripe/connect/onboard")!

        print("[StripeConnectService] Requesting onboarding link from: \(url)")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Add X-User-Id header
        if let userId = authService.currentUser?.id {
            request.setValue(userId.uuidString, forHTTPHeaderField: "X-User-Id")
            print("[StripeConnectService] X-User-Id header added: \(userId.uuidString)")
        } else {
            print("[StripeConnectService] ERROR: No authenticated user available")
            throw APIError.unauthorized
        }

        // Empty body for POST
        request.httpBody = try JSONSerialization.data(withJSONObject: [:])

        print("[StripeConnectService] Sending request...")
        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            print("[StripeConnectService] ERROR: Invalid response type (not HTTPURLResponse)")
            throw APIError.invalidResponse
        }

        print("[StripeConnectService] Response received: HTTP \(http.statusCode)")

        switch http.statusCode {
        case 200:
            print("[StripeConnectService] Status 200: Success")
        case 401:
            print("[StripeConnectService] Status 401: Unauthorized")
            throw APIError.unauthorized
        case 500:
            let errorMsg = String(data: data, encoding: .utf8) ?? "Unknown error"
            print("[StripeConnectService] Status 500: \(errorMsg)")
            throw APIError.serverError("Failed to generate onboarding link")
        default:
            let errorMsg = String(data: data, encoding: .utf8) ?? "Unknown error"
            print("[StripeConnectService] Status \(http.statusCode): \(errorMsg)")
            throw APIError.serverError("Server returned \(http.statusCode)")
        }

        struct OnboardingResponse: Codable {
            let url: String
        }

        let decoder = JSONDecoder()
        do {
            let response = try decoder.decode(OnboardingResponse.self, from: data)
            print("[StripeConnectService] Onboarding link generated: \(response.url.prefix(50))...")
            return response.url
        } catch {
            print("[StripeConnectService] ERROR: Failed to decode response: \(error)")
            throw APIError.decodingError
        }
    }

    /// Get current Stripe Connect account status.
    /// - Returns: StripeAccountStatus with connection and readiness flags
    /// - Throws: APIError on network, validation, or server error
    func getAccountStatus() async throws -> StripeAccountStatus {
        let url = URL(string: "\(baseURL)/api/stripe/connect/status")!

        print("[StripeConnectService] Fetching account status from: \(url)")

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Add X-User-Id header
        if let userId = authService.currentUser?.id {
            request.setValue(userId.uuidString, forHTTPHeaderField: "X-User-Id")
            print("[StripeConnectService] X-User-Id header added: \(userId.uuidString)")
        } else {
            print("[StripeConnectService] ERROR: No authenticated user available")
            throw APIError.unauthorized
        }

        print("[StripeConnectService] Sending request...")
        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            print("[StripeConnectService] ERROR: Invalid response type (not HTTPURLResponse)")
            throw APIError.invalidResponse
        }

        print("[StripeConnectService] Response received: HTTP \(http.statusCode)")

        switch http.statusCode {
        case 200:
            print("[StripeConnectService] Status 200: Success")
        case 401:
            print("[StripeConnectService] Status 401: Unauthorized")
            throw APIError.unauthorized
        case 500:
            let errorMsg = String(data: data, encoding: .utf8) ?? "Unknown error"
            print("[StripeConnectService] Status 500: \(errorMsg)")
            throw APIError.serverError("Failed to fetch account status")
        default:
            let errorMsg = String(data: data, encoding: .utf8) ?? "Unknown error"
            print("[StripeConnectService] Status \(http.statusCode): \(errorMsg)")
            throw APIError.serverError("Server returned \(http.statusCode)")
        }

        let decoder = JSONDecoder()
        do {
            let statusDTO = try decoder.decode(StripeAccountStatusDTO.self, from: data)
            let status = StripeAccountStatus.from(statusDTO)
            print("[StripeConnectService] Status fetched: connected=\(status.connected), payoutsEnabled=\(status.payoutsEnabled)")
            return status
        } catch {
            print("[StripeConnectService] ERROR: Failed to decode response: \(error)")
            throw APIError.decodingError
        }
    }
}

// MARK: - Data Transfer Objects (DTOs)

/// DTO: Stripe Account Status response from backend
struct StripeAccountStatusDTO: Codable {
    let connected: Bool
    let payouts_enabled: Bool?
    let details_submitted: Bool?
    let charges_enabled: Bool?
}

// MARK: - Domain Models

/// Domain model: Stripe Account Status
/// Internal representation (not DTO).
struct StripeAccountStatus: Identifiable, Equatable {
    let id = UUID()
    let connected: Bool
    let payoutsEnabled: Bool
    let detailsSubmitted: Bool
    let chargesEnabled: Bool

    /// Map from DTO to Domain model
    static func from(_ dto: StripeAccountStatusDTO) -> StripeAccountStatus {
        return StripeAccountStatus(
            connected: dto.connected,
            payoutsEnabled: dto.payouts_enabled ?? false,
            detailsSubmitted: dto.details_submitted ?? false,
            chargesEnabled: dto.charges_enabled ?? false
        )
    }
}
