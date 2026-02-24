//
//  PublishResult.swift
//  core
//
//  Domain model for publish operation result.
//

import Foundation

/// Domain model for publish operation result.
/// Mapped from PublishResponseDTO.
public struct PublishResult: Codable, Hashable, Equatable, Sendable {
    public let contestId: UUID
    public let joinToken: String
    public let joinURL: URL
    
    public init(contestId: UUID, joinToken: String, joinURL: URL) {
        self.contestId = contestId
        self.joinToken = joinToken
        self.joinURL = joinURL
    }
    
    enum CodingKeys: String, CodingKey {
        case contestId = "contest_id"
        case joinToken = "join_token"
        case joinURL = "join_url"
    }
    
    // MARK: - Mapping
    // Note: This would typically be mapped from a PublishResponseDTO if one exists in Contracts.
    // Since I don't see one yet, I'll provide a stub and mapping if it's ever added.
    
    // MARK: - Testing Factory
    /// Stub factory for testing.
    public static func stub(
        contestId: UUID = UUID(),
        joinToken: String = "token-123",
        joinURL: URL = URL(string: "https://playoff.example.com/join/token-123")!
    ) -> PublishResult {
        return PublishResult(contestId: contestId, joinToken: joinToken, joinURL: joinURL)
    }
}
