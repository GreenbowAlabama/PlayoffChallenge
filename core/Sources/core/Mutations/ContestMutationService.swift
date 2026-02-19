//
//  ContestMutationService.swift
//  core
//
//  Pure Swift service for contest mutation operations.
//  Contains all mutation logic: list replacement, order preservation, error handling.
//  No UI, no SwiftUI, no iOS dependencies.
//  Testable in isolation via /core SwiftPM tests.
//

import Foundation

// MARK: - API Client Dependency (Protocol)

/// Minimal protocol for API operations.
/// iOS ViewModel will inject APIService conforming to this.
public protocol ContestAPIClient {
    func delete<T: Decodable>(
        path: String,
        headers: [String: String]?
    ) async throws -> T
}

// MARK: - Error Enum

public enum ContestMutationError: Error, Equatable {
    case notFound
    case forbidden
    case conflict(String)
    case network(String)
    case decoding(String)
    case unknown(String)

    public var localizedDescription: String {
        switch self {
        case .notFound:
            return "Contest not found"
        case .forbidden:
            return "You do not have permission to perform this action"
        case .conflict(let msg):
            return "Conflict: \(msg)"
        case .network(let msg):
            return "Network error: \(msg)"
        case .decoding(let msg):
            return "Failed to decode response: \(msg)"
        case .unknown(let msg):
            return msg
        }
    }
}

// MARK: - Mutation Service

/// Pure service for contest list mutations.
/// Owns all mutation logic: replacement, order preservation, error handling.
/// Returns updated list as source of truth.
public final class ContestMutationService {
    private let apiClient: ContestAPIClient

    public init(apiClient: ContestAPIClient) {
        self.apiClient = apiClient
    }

    // MARK: - Public Mutation Methods

    /// Delete a contest from the user's list.
    /// - Parameters:
    ///   - contests: Current list of contests
    ///   - id: Contest ID to delete
    ///   - userId: Authenticated user ID
    /// - Returns: Updated list with deleted contest replaced by server response
    /// - Throws: ContestMutationError on failure (permission, not found, network)
    /// - Note: 404 is treated as idempotent success (contest already deleted)
    public func deleteContest(
        contests: [ContestListItemDTO],
        id: String,
        userId: String
    ) async throws -> [ContestListItemDTO] {
        let path = "/api/custom-contests/\(id)"
        let headers = ["X-User-Id": userId]

        do {
            let updated: ContestListItemDTO = try await apiClient.delete(
                path: path,
                headers: headers
            )

            // Replace contest in list, preserving order
            return replaceContest(in: contests, with: updated)
        } catch {
            let classified = classifyError(error)

            // Idempotency: 404 means contest already deleted, treat as success
            if case .notFound = classified {
                return contests.filter { $0.id != id }
            }

            throw classified
        }
    }

    /// Unjoin a contest (remove user participation).
    /// - Parameters:
    ///   - contests: Current list of contests
    ///   - id: Contest ID to unjoin
    ///   - userId: Authenticated user ID
    /// - Returns: Updated list with unjoined contest replaced by server response
    /// - Throws: ContestMutationError on failure (permission, not found, network)
    /// - Note: 404 is treated as idempotent success (already unjoined)
    public func unjoinContest(
        contests: [ContestListItemDTO],
        id: String,
        userId: String
    ) async throws -> [ContestListItemDTO] {
        let path = "/api/custom-contests/\(id)/entry"
        let headers = ["X-User-Id": userId]

        do {
            let updated: ContestListItemDTO = try await apiClient.delete(
                path: path,
                headers: headers
            )

            // Replace contest in list, preserving order
            return replaceContest(in: contests, with: updated)
        } catch {
            let classified = classifyError(error)

            // Idempotency: 404 means entry already unjoined, treat as success
            if case .notFound = classified {
                return contests.filter { $0.id != id }
            }

            throw classified
        }
    }

    // MARK: - Private Helpers

    /// Replace contest in list while preserving order.
    /// If contest not found in list, append it.
    private func replaceContest(
        in contests: [ContestListItemDTO],
        with updated: ContestListItemDTO
    ) -> [ContestListItemDTO] {
        var result = contests
        if let index = result.firstIndex(where: { $0.id == updated.id }) {
            result[index] = updated
        } else {
            // Idempotent: if not in list, append
            result.append(updated)
        }
        return result
    }

    /// Classify network/API errors into typed ContestMutationError.
    /// Handles LocalizedError explicitly and uses expanded keyword matching.
    private func classifyError(_ error: Error) -> ContestMutationError {
        if let mutationError = error as? ContestMutationError {
            return mutationError
        }

        let description: String

        if let localized = error as? LocalizedError,
           let errorDescription = localized.errorDescription {
            description = errorDescription
        } else {
            description = error.localizedDescription
        }

        let normalized = description.lowercased()

        if normalized.contains("404") || normalized.contains("not found") || normalized.contains("not available") {
            return .notFound
        }

        if normalized.contains("403") || normalized.contains("forbidden") || normalized.contains("permission") {
            return .forbidden
        }

        if normalized.contains("409") || normalized.contains("conflict") || normalized.contains("locked") {
            return .conflict(description)
        }

        if normalized.contains("decode")
            || normalized.contains("decoding")
            || normalized.contains("json")
            || normalized.contains("deserialize")
            || normalized.contains("parse") {
            return .decoding(description)
        }

        return .unknown(description)
    }
}
