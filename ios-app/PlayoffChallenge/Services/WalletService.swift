//
//  WalletService.swift
//  PlayoffChallenge
//
//  Service for fetching wallet balance and ledger from backend.
//  Pure HTTP + JSON decode. No business logic.
//

import Foundation
import Core

/// Protocol for wallet operations.
/// BOUNDARY CONTRACT: Service performs HTTP only.
/// DTO→Domain conversion happens in ViewModel.
protocol WalletFetching: Sendable {
    func fetchWallet() async throws -> WalletResponseDTO
}

/// Production implementation for wallet fetching.
/// Depends on AuthService to get current user for authentication.
final class WalletService: WalletFetching, @unchecked Sendable {

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

    /// Fetch wallet balance and ledger from backend.
    /// - Returns: WalletResponseDTO with balance_cents (backend-authoritative)
    /// - Throws: APIError on network, decoding, or server error
    func fetchWallet() async throws -> WalletResponseDTO {
        let url = URL(string: "\(baseURL)/api/wallet")!

        print("[WalletService] Fetching wallet from: \(url)")

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Add Authorization header using current user's ID as bearer token
        if let userId = authService.currentUser?.id {
            let bearerToken = userId.uuidString
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
            print("[WalletService] Added Authorization header for userId: \(bearerToken)")
        } else {
            print("[WalletService] No authenticated user available - request will likely fail with 401")
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            print("[WalletService] Invalid response type")
            throw APIError.invalidResponse
        }

        print("[WalletService] Response status: \(http.statusCode)")

        switch http.statusCode {
        case 200:
            // Success — decode wallet
            break
        case 401:
            print("[WalletService] 401 Unauthorized")
            throw APIError.unauthorized
        case 404:
            print("[WalletService] 404 Not Found")
            throw APIError.notFound
        default:
            let errorMsg = String(data: data, encoding: .utf8) ?? "Unknown error"
            print("[WalletService] Server error: \(errorMsg)")
            throw APIError.serverError("Server returned \(http.statusCode)")
        }

        let decoder = JSONDecoder.iso8601Decoder
        do {
            let walletDTO = try decoder.decode(WalletResponseDTO.self, from: data)
            print("[WalletService] Decoded wallet: balance_cents=\(walletDTO.balance_cents), ledger_count=\(walletDTO.ledger?.count ?? 0)")
            return walletDTO
        } catch {
            print("[WalletService] Failed to decode response: \(error)")
            throw APIError.decodingError
        }
    }
}
