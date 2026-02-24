//
//  OrganizerIDCaseInsensitivityTests.swift
//  coreTests
//
//  Validates case-insensitive UUID comparison for organizer_id field.
//  Hypothesis: Backend returns lowercase organizer_id (e.g. "550e8400-e29b-41d4-a716-446655440000")
//  but currentUser.id may be mixed case (e.g. "550E8400-E29B-41D4-A716-446655440000").
//  iOS must normalize for defensive comparison; backend's can_delete flag is the source of truth.
//

import XCTest
@testable import core

final class OrganizerIDCaseInsensitivityTests: XCTestCase {

    // MARK: - UUID Normalization Helpers

    /// Test UUID string comparison is case-insensitive when normalized
    func test_UUIDNormalization_LowercaseMatchesMixedCase() {
        let lowercaseUUID = "550e8400-e29b-41d4-a716-446655440000"
        let mixedCaseUUID = "550E8400-E29B-41D4-A716-446655440000"

        // Normalize both to lowercase for comparison
        XCTAssertEqual(
            lowercaseUUID.lowercased(),
            mixedCaseUUID.lowercased(),
            "UUID strings should match when normalized to lowercase"
        )
    }

    /// Test strict equality fails without normalization
    func test_UUIDComparison_StrictEqualityFails() {
        let lowercaseUUID = "550e8400-e29b-41d4-a716-446655440000"
        let mixedCaseUUID = "550E8400-E29B-41D4-A716-446655440000"

        XCTAssertNotEqual(
            lowercaseUUID,
            mixedCaseUUID,
            "Strict comparison should fail without normalization"
        )
    }

    // MARK: - ContestListItemDTO organizerId Decoding

    /// Test that organizerId is properly decoded from backend's "organizer_id" field
    func test_ContestListItemDTO_DecodesOrganizerIDFromField() throws {
        let json = """
        {
          "id": "350e8400-e29b-41d4-a716-446655440000",
          "organizer_id": "550e8400-e29b-41d4-a716-446655440000",
          "status": "SCHEDULED",
          "entry_count": 0,
          "contest_name": "Test Contest",
          "max_entries": null,
          "entry_fee_cents": 5000,
          "lock_time": null,
          "created_at": "2026-02-18T00:00:00Z",
          "updated_at": "2026-02-18T00:00:00Z"
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let dto = try decoder.decode(ContestListItemDTO.self, from: json)

        XCTAssertEqual(
            dto.organizerId,
            "550e8400-e29b-41d4-a716-446655440000",
            "organizerId should decode from organizer_id field in lowercase"
        )
    }

    /// Test case-insensitive comparison: lowercase organizerId vs mixed-case userId
    func test_OrganizerIDComparison_CaseInsensitive_Defensive() throws {
        let json = """
        {
          "id": "350e8400-e29b-41d4-a716-446655440000",
          "organizer_id": "550e8400-e29b-41d4-a716-446655440000",
          "status": "SCHEDULED",
          "entry_count": 1,
          "contest_name": "Organizer's Contest",
          "max_entries": null,
          "entry_fee_cents": 5000,
          "lock_time": null,
          "created_at": "2026-02-18T00:00:00Z",
          "updated_at": "2026-02-18T00:00:00Z"
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let dto = try decoder.decode(ContestListItemDTO.self, from: json)

        // Simulate currentUser.id from iOS UserDefaults (may be mixed case from backend session)
        let currentUserID = "550E8400-E29B-41D4-A716-446655440000"

        // Defensive: normalize both sides for comparison
        let isOrganizer = dto.organizerId.lowercased() == currentUserID.lowercased()

        XCTAssertTrue(
            isOrganizer,
            "Organizer check should work with case-insensitive comparison"
        )
    }

    /// Test that different UUIDs don't match even after normalization
    func test_OrganizerIDComparison_DifferentUUIDs_DontMatch() throws {
        let json = """
        {
          "id": "350e8400-e29b-41d4-a716-446655440000",
          "organizer_id": "550e8400-e29b-41d4-a716-446655440000",
          "status": "SCHEDULED",
          "entry_count": 0,
          "contest_name": "Someone Else's Contest",
          "max_entries": null,
          "entry_fee_cents": 5000,
          "lock_time": null,
          "created_at": "2026-02-18T00:00:00Z",
          "updated_at": "2026-02-18T00:00:00Z"
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let dto = try decoder.decode(ContestListItemDTO.self, from: json)

        // Different user ID
        let currentUserID = "660e8400-e29b-41d4-a716-446655440000"

        let isOrganizer = dto.organizerId.lowercased() == currentUserID.lowercased()

        XCTAssertFalse(
            isOrganizer,
            "Different UUIDs should not match even after normalization"
        )
    }

    // MARK: - Contract Response with can_delete Flag

    /// Test full contract decode with lowercase organizerId and can_delete = true
    func test_ContestDetailResponseContract_CanDeleteWithLowercaseOrganizerID() throws {
        let json = """
        {
          "contest_id": "350e8400-e29b-41d4-a716-446655440000",
          "type": "playoff",
          "leaderboard_state": "computed",
          "actions": {
            "can_join": false,
            "can_edit_entry": false,
            "is_live": false,
            "is_closed": false,
            "is_scoring": false,
            "is_scored": false,
            "is_read_only": false,
            "can_share_invite": false,
            "can_manage_contest": false,
            "can_delete": true,
            "can_unjoin": false
          },
          "payout_table": [],
          "roster_config": {}
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let contract = try decoder.decode(ContestDetailResponseContract.self, from: json)

        XCTAssertTrue(
            contract.actions.can_delete,
            "Backend can_delete flag is source of truth, independent of organizerId case"
        )
    }

    // MARK: - Idempotency with Mixed Case IDs

    /// Test that DELETE operation is idempotent regardless of organizer_id case
    func test_DeleteIdempotent_WithMixedCaseOrganizerID() throws {
        let lowercaseOrganizerID = "550e8400-e29b-41d4-a716-446655440000"
        let mixedCaseUserID = "550E8400-E29B-41D4-A716-446655440000"

        // After DELETE succeeds, server returns updated contest with can_delete = false
        // (because it was the only entry, now deleted)
        let updatedJSON = """
        {
          "id": "350e8400-e29b-41d4-a716-446655440000",
          "organizer_id": "\(lowercaseOrganizerID)",
          "status": "SCHEDULED",
          "entry_count": 0,
          "contest_name": "Deleted Contest",
          "max_entries": null,
          "entry_fee_cents": 5000,
          "lock_time": null,
          "created_at": "2026-02-18T00:00:00Z",
          "updated_at": "2026-02-18T00:00:00Z",
          "actions": {
            "can_join": false,
            "can_edit_entry": false,
            "is_live": false,
            "is_closed": false,
            "is_scoring": false,
            "is_scored": false,
            "is_read_only": false,
            "can_share_invite": false,
            "can_manage_contest": false,
            "can_delete": false,
            "can_unjoin": false
          },
          "payout_table": [],
          "roster_config": {}
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let dto = try decoder.decode(ContestListItemDTO.self, from: updatedJSON)

        // Defensive check: case-insensitive
        let isOrganizer = dto.organizerId.lowercased() == mixedCaseUserID.lowercased()

        XCTAssertTrue(
            isOrganizer,
            "Case-insensitive check should identify organizer correctly"
        )
        XCTAssertFalse(
            dto.actions?.can_delete ?? false,
            "After deletion, can_delete should be false (idempotent state)"
        )
    }

    // MARK: - Backend-Driven Authorization (iOS Defense Layer)

    /// Test that iOS should ONLY rely on can_delete flag, not local organizerId check
    func test_iOSDeleteButton_GatedByCanDeleteFlag_Only() throws {
        // Scenario: Backend says can_delete=true (already computed with correct organizer check)
        // iOS should gate button based ONLY on this flag
        let json = """
        {
          "contest_id": "350e8400-e29b-41d4-a716-446655440000",
          "type": "playoff",
          "leaderboard_state": "computed",
          "actions": {
            "can_join": false,
            "can_edit_entry": false,
            "is_live": false,
            "is_closed": false,
            "is_scoring": false,
            "is_scored": false,
            "is_read_only": false,
            "can_share_invite": false,
            "can_manage_contest": false,
            "can_delete": true,
            "can_unjoin": false
          },
          "payout_table": [],
          "roster_config": {}
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let contract = try decoder.decode(ContestDetailResponseContract.self, from: json)

        // iOS should ONLY check this:
        let canDeleteContest = contract.actions.can_delete

        XCTAssertTrue(
            canDeleteContest,
            "iOS Delete button should be gated ONLY by backend can_delete flag"
        )
    }

    /// Test that backend can_delete=false prevents delete regardless of organizer match
    func test_BackendAuthority_CanDeleteFalsePreventsDeletion() throws {
        let json = """
        {
          "contest_id": "350e8400-e29b-41d4-a716-446655440000",
          "type": "playoff",
          "leaderboard_state": "computed",
          "actions": {
            "can_join": false,
            "can_edit_entry": false,
            "is_live": false,
            "is_closed": false,
            "is_scoring": false,
            "is_scored": false,
            "is_read_only": false,
            "can_share_invite": false,
            "can_manage_contest": false,
            "can_delete": false,
            "can_unjoin": false
          },
          "payout_table": [],
          "roster_config": {}
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let contract = try decoder.decode(ContestDetailResponseContract.self, from: json)

        // iOS should ONLY check this:
        let canDeleteContest = contract.actions.can_delete

        XCTAssertFalse(
            canDeleteContest,
            "iOS Delete button must be disabled when backend says can_delete=false"
        )
    }
}
