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
    func fundWallet(amountCents: Int, idempotencyKey: String) async throws -> WalletFundResponseDTO
    func withdrawFunds(amountCents: Int, method: String, idempotencyKey: String) async throws -> WalletWithdrawResponseDTO
    func fetchTransactions(limit: Int, offset: Int) async throws -> WalletTransactionsResponseDTO
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

        // Add X-User-Id header
        if let userId = authService.currentUser?.id {
            request.setValue(userId.uuidString, forHTTPHeaderField: "X-User-Id")
            print("[WalletService] Added X-User-Id header for userId: \(userId.uuidString)")
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

    /// Create wallet top-up PaymentIntent (idempotent).
    /// - Parameters:
    ///   - amountCents: Amount to deposit in cents
    ///   - idempotencyKey: Unique request identifier
    /// - Returns: WalletFundResponseDTO with client_secret for payment sheet
    /// - Throws: APIError on network, validation, or server error
    func fundWallet(amountCents: Int, idempotencyKey: String) async throws -> WalletFundResponseDTO {
        let url = URL(string: "\(baseURL)/api/wallet/fund")!

        print("[WalletService:Fund] ========== STARTING FUND WALLET ==========")
        print("[WalletService:Fund] Target URL: \(url)")
        print("[WalletService:Fund] Amount: \(amountCents) cents ($\(Double(amountCents) / 100.0))")
        print("[WalletService:Fund] Idempotency Key: \(idempotencyKey)")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")

        print("[WalletService:Fund] Headers added: Content-Type=application/json, Idempotency-Key=\(idempotencyKey)")

        // Add X-User-Id header
        if let userId = authService.currentUser?.id {
            request.setValue(userId.uuidString, forHTTPHeaderField: "X-User-Id")
            print("[WalletService:Fund] X-User-Id header added: \(userId.uuidString)")
        } else {
            print("[WalletService:Fund] ERROR: No authenticated user available")
            throw APIError.unauthorized
        }

        // Build request body
        let requestBody = WalletFundRequestDTO(amount_cents: amountCents)
        let encoder = JSONEncoder()
        request.httpBody = try encoder.encode(requestBody)
        print("[WalletService:Fund] Request body encoded: amount_cents=\(amountCents)")

        print("[WalletService:Fund] Sending request...")
        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            print("[WalletService:Fund] ERROR: Invalid response type (not HTTPURLResponse)")
            throw APIError.invalidResponse
        }

        print("[WalletService:Fund] Response received: HTTP \(http.statusCode)")
        print("[WalletService:Fund] Response headers: \(http.allHeaderFields)")
        print("[WalletService:Fund] Response body size: \(data.count) bytes")

        switch http.statusCode {
        case 200:
            print("[WalletService:Fund] Status 200: Success")
        case 400:
            let errorMsg = String(data: data, encoding: .utf8) ?? "Unknown error"
            print("[WalletService:Fund] Status 400: \(errorMsg)")
            throw APIError.validationError("Invalid request")
        case 401:
            print("[WalletService:Fund] Status 401: Unauthorized")
            throw APIError.unauthorized
        default:
            let errorMsg = String(data: data, encoding: .utf8) ?? "Unknown error"
            print("[WalletService:Fund] Status \(http.statusCode): \(errorMsg)")
            throw APIError.serverError("Server returned \(http.statusCode): \(errorMsg)")
        }

        let decoder = JSONDecoder()
        do {
            let fundResponse = try decoder.decode(WalletFundResponseDTO.self, from: data)
            print("[WalletService:Fund] Decoded response: client_secret=\(fundResponse.client_secret.prefix(20))..., amount=\(fundResponse.amount_cents)")
            print("[WalletService:Fund] ========== FUND WALLET SUCCESS ==========")
            return fundResponse
        } catch {
            print("[WalletService:Fund] ERROR: Failed to decode response: \(error)")
            print("[WalletService:Fund] Raw response data: \(String(data: data, encoding: .utf8) ?? "Unable to convert to string")")
            throw APIError.decodingError
        }
    }

    /// Create wallet withdrawal request (idempotent).
    /// - Parameters:
    ///   - amountCents: Amount to withdraw in cents
    ///   - method: Withdrawal method ("standard" or "instant")
    ///   - idempotencyKey: Unique request identifier
    /// - Returns: WalletWithdrawResponseDTO with withdrawal_id and status
    /// - Throws: APIError on network, validation, insufficient funds, or server error
    func withdrawFunds(amountCents: Int, method: String, idempotencyKey: String) async throws -> WalletWithdrawResponseDTO {
        let url = URL(string: "\(baseURL)/api/wallet/withdraw")!

        print("[WalletService:Withdraw] ========== STARTING WITHDRAWAL ==========")
        print("[WalletService:Withdraw] Target URL: \(url)")
        print("[WalletService:Withdraw] Amount: \(amountCents) cents ($\(Double(amountCents) / 100.0))")
        print("[WalletService:Withdraw] Method: \(method)")
        print("[WalletService:Withdraw] Idempotency Key: \(idempotencyKey)")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")

        print("[WalletService:Withdraw] Headers added: Content-Type=application/json, Idempotency-Key=\(idempotencyKey)")

        // Add X-User-Id header
        if let userId = authService.currentUser?.id {
            request.setValue(userId.uuidString, forHTTPHeaderField: "X-User-Id")
            print("[WalletService:Withdraw] X-User-Id header added: \(userId.uuidString)")
        } else {
            print("[WalletService:Withdraw] ERROR: No authenticated user available")
            throw APIError.unauthorized
        }

        // Build request body
        let requestBody = WalletWithdrawRequestDTO(amount_cents: amountCents, method: method)
        let encoder = JSONEncoder()
        request.httpBody = try encoder.encode(requestBody)
        print("[WalletService:Withdraw] Request body encoded: amount_cents=\(amountCents), method=\(method)")

        print("[WalletService:Withdraw] Sending request...")
        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            print("[WalletService:Withdraw] ERROR: Invalid response type (not HTTPURLResponse)")
            throw APIError.invalidResponse
        }

        print("[WalletService:Withdraw] Response received: HTTP \(http.statusCode)")
        print("[WalletService:Withdraw] Response body size: \(data.count) bytes")

        switch http.statusCode {
        case 200:
            print("[WalletService:Withdraw] Status 200: Success")
        case 400:
            // Try to decode structured error response with error_code
            struct ErrorResponseDTO: Codable {
                let error_code: String?
                let message: String?
            }

            if let errorResponse = try? JSONDecoder().decode(ErrorResponseDTO.self, from: data) {
                print("[WalletService:Withdraw] Status 400: error_code=\(errorResponse.error_code ?? "unknown")")

                switch errorResponse.error_code {
                case "STRIPE_ACCOUNT_REQUIRED":
                    throw APIError.stripeAccountRequired
                case "STRIPE_ACCOUNT_INCOMPLETE":
                    throw APIError.stripeAccountIncomplete
                default:
                    throw APIError.validationError(errorResponse.message ?? "Invalid request")
                }
            } else {
                // Fallback if JSON decoding fails
                let errorMsg = String(data: data, encoding: .utf8) ?? "Unknown error"
                print("[WalletService:Withdraw] Status 400: \(errorMsg)")
                throw APIError.validationError("Invalid request")
            }
        case 401:
            print("[WalletService:Withdraw] Status 401: Unauthorized")
            throw APIError.unauthorized
        case 422:
            print("[WalletService:Withdraw] Status 422: Insufficient funds")
            throw APIError.insufficientFunds
        default:
            let errorMsg = String(data: data, encoding: .utf8) ?? "Unknown error"
            print("[WalletService:Withdraw] Status \(http.statusCode): \(errorMsg)")
            throw APIError.serverError("Server returned \(http.statusCode): \(errorMsg)")
        }

        let decoder = JSONDecoder()
        do {
            let withdrawResponse = try decoder.decode(WalletWithdrawResponseDTO.self, from: data)
            print("[WalletService:Withdraw] Decoded response: withdrawal_id=\(withdrawResponse.withdrawal_id), status=\(withdrawResponse.status), amount=\(withdrawResponse.amount_cents)")
            print("[WalletService:Withdraw] ========== WITHDRAWAL SUCCESS ==========")
            return withdrawResponse
        } catch {
            print("[WalletService:Withdraw] ERROR: Failed to decode response: \(error)")
            print("[WalletService:Withdraw] Raw response data: \(String(data: data, encoding: .utf8) ?? "Unable to convert to string")")
            throw APIError.decodingError
        }
    }

    /// Fetch wallet transaction history.
    /// - Parameters:
    ///   - limit: Maximum number of transactions to return (1-100, default: 50)
    ///   - offset: Number of transactions to skip (default: 0)
    /// - Returns: WalletTransactionsResponseDTO with transactions array and total count
    /// - Throws: APIError on network, decoding, or server error
    func fetchTransactions(limit: Int = 50, offset: Int = 0) async throws -> WalletTransactionsResponseDTO {
        let url = URL(string: "\(baseURL)/api/wallet/transactions?limit=\(limit)&offset=\(offset)")!

        print("[WalletService] Fetching transactions from: \(url)")

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Add X-User-Id header
        if let userId = authService.currentUser?.id {
            request.setValue(userId.uuidString, forHTTPHeaderField: "X-User-Id")
            print("[WalletService] Added X-User-Id header for userId: \(userId.uuidString)")
        } else {
            print("[WalletService] No authenticated user available - request will likely fail with 401")
            throw APIError.unauthorized
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            print("[WalletService] Invalid response type")
            throw APIError.invalidResponse
        }

        print("[WalletService] Response status: \(http.statusCode)")

        switch http.statusCode {
        case 200:
            // Success — decode transactions
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
            let transactionsDTO = try decoder.decode(WalletTransactionsResponseDTO.self, from: data)
            print("[WalletService] Decoded transactions: count=\(transactionsDTO.transactions.count), total=\(transactionsDTO.total_count)")
            return transactionsDTO
        } catch {
            print("[WalletService] Failed to decode response: \(error)")
            throw APIError.decodingError
        }
    }
}
