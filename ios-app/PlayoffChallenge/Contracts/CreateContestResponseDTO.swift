//
//  CreateContestResponseDTO.swift
//  PlayoffChallenge
//
//  Created by Ian Carter on 2/24/26.
//

import Foundation

/// DTO for contest creation response (POST /api/custom-contests).
/// Minimal draft representation returned by POST /api/custom-contests.
/// Separate from ContestDetailResponseDTO (GET response) — different shapes.
/// Only contains fields POST actually returns.
///
/// NOTE: This DTO uses camelCase property names with explicit CodingKeys mapping
/// from snake_case wire format. This is intentional — this DTO predates the
/// project-wide convention of using snake_case properties directly.
/// All other Contracts/ DTOs use snake_case property names. Do not extend
/// the camelCase pattern to new DTOs.
struct CreateContestResponseDTO: Decodable {
    let id: UUID
    let templateId: UUID
    let organizerId: UUID
    let entryFeeCents: Int
    let payoutStructure: [String: AnyCodable]?
    let status: String
    let contestName: String
    let maxEntries: Int?
    let lockTime: Date?
    let createdAt: Date
    let updatedAt: Date
    let joinToken: String?
    let isPlatformOwned: Bool?

    enum CodingKeys: String, CodingKey {
        case id
        case templateId = "template_id"
        case organizerId = "organizer_id"
        case entryFeeCents = "entry_fee_cents"
        case payoutStructure = "payout_structure"
        case status
        case contestName = "contest_name"
        case maxEntries = "max_entries"
        case lockTime = "lock_time"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case joinToken = "join_token"
        case isPlatformOwned = "is_platform_owned"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        templateId = try c.decode(UUID.self, forKey: .templateId)
        organizerId = try c.decode(UUID.self, forKey: .organizerId)
        entryFeeCents = try c.decode(Int.self, forKey: .entryFeeCents)
        payoutStructure = try c.decodeIfPresent([String: AnyCodable].self, forKey: .payoutStructure)
        status = try c.decode(String.self, forKey: .status)
        contestName = try c.decode(String.self, forKey: .contestName)
        maxEntries = try c.decodeIfPresent(Int.self, forKey: .maxEntries)
        lockTime = try c.decodeIfPresent(Date.self, forKey: .lockTime)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        updatedAt = try c.decode(Date.self, forKey: .updatedAt)
        joinToken = try c.decodeIfPresent(String.self, forKey: .joinToken)
        isPlatformOwned = try c.decodeIfPresent(Bool.self, forKey: .isPlatformOwned)
    }
}
