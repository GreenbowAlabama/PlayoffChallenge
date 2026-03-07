//
//  ContestDetailServiceTests.swift
//  PlayoffChallengeTests
//
//  Tests for ContestDetailService - verifies correct decoding and mapping of contest details
//

import XCTest
@testable import PlayoffChallenge

final class ContestDetailServiceTests: XCTestCase {

    // MARK: - Test fetchContestDetail Decoding

    func testFetchContestDetailDecodesFullResponse() throws {
        // Mock DTO response with full contest details
        let json = """
        {
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "contest_id": "550e8400-e29b-41d4-a716-446655440000",
            "template_id": "660e8400-e29b-41d4-a716-446655440001",
            "type": "PGA_TOURNAMENT",
            "organizer_id": "770e8400-e29b-41d4-a716-446655440002",
            "organizer_name": "Test Organizer",
            "entry_fee_cents": 1000,
            "payout_structure": null,
            "contest_name": "THE PLAYERS Championship",
            "max_entries": 100,
            "status": "SCHEDULED",
            "is_locked": false,
            "is_live": false,
            "is_settled": false,
            "entry_count": 42,
            "user_has_entered": false,
            "time_until_lock": 3600,
            "leaderboard_state": "pending",
            "created_at": "2025-03-01T10:00:00Z",
            "updated_at": "2025-03-01T10:00:00Z",
            "start_time": "2025-03-06T14:00:00Z",
            "end_time": "2025-03-09T18:00:00Z",
            "tournament_start_time": "2025-03-06T14:00:00Z",
            "tournament_end_time": "2025-03-09T18:00:00Z",
            "lock_time": "2025-03-06T13:00:00Z",
            "join_token": "test-token-123",
            "is_platform_owned": false,
            "actions": {
                "can_join": true,
                "can_delete": false,
                "can_unjoin": false,
                "can_edit_entry": false,
                "can_share_invite": true
            },
            "payout_table": [
                {
                    "rank_min": 1,
                    "rank_max": 1,
                    "amount": "5000.00"
                }
            ],
            "roster_config": {
                "positions": ["G"]
            }
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder.iso8601Decoder
        let dto = try decoder.decode(ContestDetailResponseDTO.self, from: json)

        // Verify DTO decoding
        XCTAssertEqual(dto.id, UUID(uuidString: "550e8400-e29b-41d4-a716-446655440000"))
        XCTAssertEqual(dto.contest_name, "THE PLAYERS Championship")
        XCTAssertEqual(dto.entry_count, 42)
        XCTAssertEqual(dto.status, "SCHEDULED")
        XCTAssertEqual(dto.entry_fee_cents, 1000)
        XCTAssertEqual(dto.organizer_name, "Test Organizer")
    }

    func testFetchContestDetailMapsAllFields() throws {
        // Create a full contest from DTO fields
        let testId = UUID()
        let organizerId = UUID()
        let json = """
        {
            "id": "\(testId.uuidString)",
            "contest_id": "\(testId.uuidString)",
            "template_id": "660e8400-e29b-41d4-a716-446655440001",
            "type": "PGA_TOURNAMENT",
            "organizer_id": "\(organizerId.uuidString)",
            "organizer_name": "Test Organizer",
            "entry_fee_cents": 2500,
            "payout_structure": null,
            "contest_name": "Championship Contest",
            "max_entries": 200,
            "status": "LIVE",
            "is_locked": true,
            "is_live": true,
            "is_settled": false,
            "entry_count": 150,
            "user_has_entered": true,
            "time_until_lock": 0,
            "leaderboard_state": "computed",
            "created_at": "2025-02-01T10:00:00Z",
            "updated_at": "2025-03-06T10:00:00Z",
            "start_time": "2025-03-06T14:00:00Z",
            "end_time": "2025-03-09T18:00:00Z",
            "tournament_start_time": "2025-03-06T14:00:00Z",
            "tournament_end_time": "2025-03-09T18:00:00Z",
            "lock_time": "2025-03-06T13:00:00Z",
            "join_token": "share-token-456",
            "is_platform_owned": true,
            "actions": {
                "can_join": false,
                "can_delete": false,
                "can_unjoin": true,
                "can_edit_entry": true,
                "can_share_invite": false
            },
            "payout_table": [
                {"rank_min": 1, "rank_max": 1, "amount": "5000.00"},
                {"rank_min": 2, "rank_max": 2, "amount": "3000.00"}
            ],
            "roster_config": {"positions": ["G", "F"]}
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder.iso8601Decoder
        let dto = try decoder.decode(ContestDetailResponseDTO.self, from: json)

        // Verify all fields are present in DTO
        XCTAssertEqual(dto.contestName, "Championship Contest")
        XCTAssertEqual(dto.entry_count, 150)
        XCTAssertEqual(dto.max_entries, 200)
        XCTAssertEqual(dto.entry_fee_cents, 2500)
        XCTAssertEqual(dto.status, "LIVE")
        XCTAssertEqual(dto.organizer_name, "Test Organizer")
        XCTAssertEqual(dto.is_platform_owned, true)
        XCTAssertNotNil(dto.lock_time)
        XCTAssertNotNil(dto.start_time)
        XCTAssertNotNil(dto.join_token)
    }

    func testFetchContestDetailHandlesOptionalFields() throws {
        // Test with minimal required fields
        let json = """
        {
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "template_id": "660e8400-e29b-41d4-a716-446655440001",
            "type": "PICKEM",
            "organizer_id": "770e8400-e29b-41d4-a716-446655440002",
            "entry_fee_cents": 500,
            "payout_structure": null,
            "contest_name": "Simple Contest",
            "status": "SCHEDULED",
            "is_locked": false,
            "is_live": false,
            "is_settled": false,
            "entry_count": 10,
            "user_has_entered": false,
            "leaderboard_state": "pending",
            "created_at": "2025-03-01T10:00:00Z",
            "updated_at": "2025-03-01T10:00:00Z",
            "actions": {
                "can_join": true,
                "can_delete": false,
                "can_unjoin": false,
                "can_edit_entry": false,
                "can_share_invite": false
            },
            "payout_table": [],
            "roster_config": {}
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder.iso8601Decoder
        let dto = try decoder.decode(ContestDetailResponseDTO.self, from: json)

        // Verify optional fields are nil when missing
        XCTAssertNil(dto.max_entries)
        XCTAssertNil(dto.organizer_name)
        XCTAssertNil(dto.start_time)
        XCTAssertNil(dto.end_time)
        XCTAssertNil(dto.lock_time)
        XCTAssertNil(dto.join_token)
        XCTAssertNil(dto.is_platform_owned)

        // Verify required fields are always present
        XCTAssertEqual(dto.contestName, "Simple Contest")
        XCTAssertEqual(dto.entry_fee_cents, 500)
        XCTAssertEqual(dto.status, "SCHEDULED")
    }
}
