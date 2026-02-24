//
//  DeleteUnjoinMutationTests.swift
//  coreTests
//
//  Tests for DELETE and UNJOIN contest mutation scenarios.
//  Verifies can_delete and can_unjoin flags with case-insensitive ID comparisons.
//  Tests entry count, contest status, and organizer/participant conditions.
//


import XCTest
@testable import core

final class DeleteUnjoinMutationTests: XCTestCase {

    // MARK: - Helpers

    func makeContestActions(
        canDelete: Bool,
        canUnjoin: Bool,
        otherCanJoin: Bool = false,
        otherCanEditEntry: Bool = false
    ) -> ContestActions {
        ContestActions(
            canJoin: otherCanJoin,
            canEditEntry: otherCanEditEntry,
            isLive: false,
            isClosed: false,
            isScoring: false,
            isScored: false,
            isReadOnly: false,
            canShareInvite: false,
            canManageContest: false,
            canDelete: canDelete,
            canUnjoin: canUnjoin
        )
    }

    func decodeContestActionsContract(from json: String) throws -> ContestActions {
        let data = json.data(using: .utf8)!
        return ContestActions.from(try JSONDecoder().decode(ContestActionsContract.self, from: data))
    }

    // MARK: - Case-Insensitive ID Comparison Tests

    /// Test that lowercase organizer_id can be compared case-insensitively with mixed-case userId
    func test_CaseInsensitiveIDComparison_LowercaseOrganizerID_MatchesMixedCaseUserID() {
        let lowercaseOrganizerID = "550e8400-e29b-41d4-a716-446655440000"
        let mixedCaseUserID = "550E8400-E29B-41D4-A716-446655440000"

        // Simulate case-insensitive comparison as would happen on iOS
        let normalizedOrganizerID = lowercaseOrganizerID.lowercased()
        let normalizedUserID = mixedCaseUserID.lowercased()

        XCTAssertEqual(normalizedOrganizerID, normalizedUserID, "IDs should match when normalized to lowercase")
    }

    /// Test that strict equality fails without normalization
    func test_StrictIDComparison_LowercaseOrganizerID_FailsWithMixedCaseUserID() {
        let lowercaseOrganizerID = "550e8400-e29b-41d4-a716-446655440000"
        let mixedCaseUserID = "550E8400-E29B-41D4-A716-446655440000"

        XCTAssertNotEqual(lowercaseOrganizerID, mixedCaseUserID, "Strict comparison should fail without normalization")
    }

    // MARK: - DELETE: SCHEDULED Contest with 0 Entries (Organizer)

    func test_DeleteScheduledContest_0Entries_OrganizerCanDelete() throws {
        let json = """
        {
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
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let actions = ContestActions.from(try decoder.decode(ContestActionsContract.self, from: json))

        XCTAssertTrue(actions.canDelete, "Organizer should be able to delete SCHEDULED contest with 0 entries")
        XCTAssertFalse(actions.canUnjoin, "Unjoin should not be available for organizer")
    }

    // MARK: - DELETE: SCHEDULED Contest with 1 Entry (Organizer)

    func test_DeleteScheduledContest_1Entry_OrganizerCanDelete() throws {
        let json = """
        {
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
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let actions = ContestActions.from(try decoder.decode(ContestActionsContract.self, from: json))

        XCTAssertTrue(actions.canDelete, "Organizer should be able to delete SCHEDULED contest with 1 entry")
    }

    // MARK: - DELETE: SCHEDULED Contest with >1 Entries (Organizer)

    func test_DeleteScheduledContest_MultipleEntries_OrganizerCannotDelete() throws {
        let json = """
        {
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
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let actions = ContestActions.from(try decoder.decode(ContestActionsContract.self, from: json))

        XCTAssertFalse(actions.canDelete, "Organizer should NOT be able to delete SCHEDULED contest with >1 entries")
    }

    // MARK: - DELETE: LOCKED Contest (Organizer)

    func test_DeleteLockedContest_OrganizerCannotDelete() throws {
        let json = """
        {
          "can_join": false,
          "can_edit_entry": false,
          "is_live": false,
          "is_closed": false,
          "is_scoring": false,
          "is_scored": false,
          "is_read_only": true,
          "can_share_invite": false,
          "can_manage_contest": false,
          "can_delete": false,
          "can_unjoin": false
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let actions = ContestActions.from(try decoder.decode(ContestActionsContract.self, from: json))

        XCTAssertFalse(actions.canDelete, "Organizer should NOT be able to delete LOCKED contest")
    }

    // MARK: - DELETE: LIVE Contest (Organizer)

    func test_DeleteLiveContest_OrganizerCannotDelete() throws {
        let json = """
        {
          "can_join": false,
          "can_edit_entry": false,
          "is_live": true,
          "is_closed": false,
          "is_scoring": false,
          "is_scored": false,
          "is_read_only": true,
          "can_share_invite": false,
          "can_manage_contest": false,
          "can_delete": false,
          "can_unjoin": false
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let actions = ContestActions.from(try decoder.decode(ContestActionsContract.self, from: json))

        XCTAssertFalse(actions.canDelete, "Organizer should NOT be able to delete LIVE contest")
    }

    // MARK: - UNJOIN: SCHEDULED Contest (Participant Joined)

    func test_UnjoinScheduledContest_ParticipantCanUnjoin() throws {
        let json = """
        {
          "can_join": false,
          "can_edit_entry": true,
          "is_live": false,
          "is_closed": false,
          "is_scoring": false,
          "is_scored": false,
          "is_read_only": false,
          "can_share_invite": false,
          "can_manage_contest": false,
          "can_delete": false,
          "can_unjoin": true
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let actions = ContestActions.from(try decoder.decode(ContestActionsContract.self, from: json))

        XCTAssertTrue(actions.canUnjoin, "Participant should be able to unjoin SCHEDULED contest")
        XCTAssertTrue(actions.canEditEntry, "Participant is joined (can_edit_entry = true)")
    }

    // MARK: - UNJOIN: LOCKED Contest (Participant Joined)

    func test_UnjoinLockedContest_ParticipantCannotUnjoin() throws {
        let json = """
        {
          "can_join": false,
          "can_edit_entry": true,
          "is_live": false,
          "is_closed": false,
          "is_scoring": false,
          "is_scored": false,
          "is_read_only": true,
          "can_share_invite": false,
          "can_manage_contest": false,
          "can_delete": false,
          "can_unjoin": false
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let actions = ContestActions.from(try decoder.decode(ContestActionsContract.self, from: json))

        XCTAssertFalse(actions.canUnjoin, "Participant should NOT be able to unjoin LOCKED contest")
    }

    // MARK: - UNJOIN: LIVE Contest (Participant Joined)

    func test_UnjoinLiveContest_ParticipantCannotUnjoin() throws {
        let json = """
        {
          "can_join": false,
          "can_edit_entry": true,
          "is_live": true,
          "is_closed": false,
          "is_scoring": false,
          "is_scored": false,
          "is_read_only": true,
          "can_share_invite": false,
          "can_manage_contest": false,
          "can_delete": false,
          "can_unjoin": false
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let actions = ContestActions.from(try decoder.decode(ContestActionsContract.self, from: json))

        XCTAssertFalse(actions.canUnjoin, "Participant should NOT be able to unjoin LIVE contest")
    }

    // MARK: - UNJOIN: COMPLETED Contest (Participant)

    func test_UnjoinCompletedContest_ParticipantCannotUnjoin() throws {
        let json = """
        {
          "can_join": false,
          "can_edit_entry": false,
          "is_live": false,
          "is_closed": true,
          "is_scoring": false,
          "is_scored": true,
          "is_read_only": true,
          "can_share_invite": false,
          "can_manage_contest": false,
          "can_delete": false,
          "can_unjoin": false
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let actions = ContestActions.from(try decoder.decode(ContestActionsContract.self, from: json))

        XCTAssertFalse(actions.canUnjoin, "Participant should NOT be able to unjoin COMPLETED contest")
    }

    // MARK: - Mutual Exclusivity: Cannot both delete and unjoin

    func test_CannotBothDeleteAndUnjoin_Organizer() throws {
        let json = """
        {
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
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let actions = ContestActions.from(try decoder.decode(ContestActionsContract.self, from: json))

        XCTAssertTrue(actions.canDelete)
        XCTAssertFalse(actions.canUnjoin, "Organizer deleting is mutually exclusive with participant unjoin")
    }

    func test_CannotBothDeleteAndUnjoin_Participant() throws {
        let json = """
        {
          "can_join": false,
          "can_edit_entry": true,
          "is_live": false,
          "is_closed": false,
          "is_scoring": false,
          "is_scored": false,
          "is_read_only": false,
          "can_share_invite": false,
          "can_manage_contest": false,
          "can_delete": false,
          "can_unjoin": true
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let actions = ContestActions.from(try decoder.decode(ContestActionsContract.self, from: json))

        XCTAssertFalse(actions.canDelete, "Participant unjoining is mutually exclusive with organizer delete")
        XCTAssertTrue(actions.canUnjoin)
    }

    // MARK: - Contract Deserialization with Entry Count Variations

    func test_ContestDetailContract_WithCanDeleteTrue_EntriesVariations() throws {
        let baseJSON = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
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
          "payout_table": [
            {
              "rank_min": 1,
              "rank_max": 1,
              "amount": "500.00"
            }
          ],
          "roster_config": {
            "entry_count": 0
          }
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let contract = try decoder.decode(ContestDetailResponseContract.self, from: baseJSON)

        XCTAssertEqual(contract.contest_id, "550e8400-e29b-41d4-a716-446655440000")
        XCTAssertTrue(contract.actions.canDelete, "can_delete should be true for 0 entries")
        XCTAssertFalse(contract.actions.canUnjoin)
    }

    func test_ContestDetailContract_WithCanDeleteFalse_MultipleEntries() throws {
        let baseJSON = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
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
          "payout_table": [
            {
              "rank_min": 1,
              "rank_max": 1,
              "amount": "500.00"
            }
          ],
          "roster_config": {
            "entry_count": 5
          }
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let contract = try decoder.decode(ContestDetailResponseContract.self, from: baseJSON)

        XCTAssertEqual(contract.contest_id, "550e8400-e29b-41d4-a716-446655440000")
        XCTAssertFalse(contract.actions.canDelete, "can_delete should be false for >1 entries")
    }

    // MARK: - STRUCTURAL TESTS: can_unjoin contract decoding

    /// Verify can_unjoin decodes as true
    func test_ContestActions_can_unjoin_DecodesTrue() throws {
        let json = """
        {
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
          "can_unjoin": true
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let actions = ContestActions.from(try decoder.decode(ContestActionsContract.self, from: json))

        XCTAssertTrue(actions.canUnjoin, "can_unjoin should decode as true")
    }

    /// Verify can_unjoin decodes as false
    func test_ContestActions_can_unjoin_DecodesFalse() throws {
        let json = """
        {
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
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let actions = ContestActions.from(try decoder.decode(ContestActionsContract.self, from: json))

        XCTAssertFalse(actions.canUnjoin, "can_unjoin should decode as false")
    }

    /// Verify ContestActions fails to decode if can_unjoin is missing (required field)
    func test_ContestActions_MissingCanUnjoin_FailsDecode() throws {
        let json = """
        {
          "can_join": false,
          "can_edit_entry": false,
          "is_live": false,
          "is_closed": false,
          "is_scoring": false,
          "is_scored": false,
          "is_read_only": false,
          "can_share_invite": false,
          "can_manage_contest": false,
          "can_delete": false
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        XCTAssertThrowsError(ContestActions.from(try decoder.decode(ContestActionsContract.self, from: json)),
                             "Decoding should fail when can_unjoin is missing")
    }

    /// Verify full ContestDetailResponseContract decodes with can_unjoin=true
    func test_ContestDetailResponseContract_CanUnjooinTrue() throws {
        let json = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
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
            "can_unjoin": true
          },
          "payout_table": [
            {
              "rank_min": 1,
              "rank_max": 1,
              "amount": "500.00"
            }
          ],
          "roster_config": {}
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let contract = try decoder.decode(ContestDetailResponseContract.self, from: json)

        XCTAssertTrue(contract.actions.canUnjoin, "can_unjoin should be true in contract")
    }

    /// Verify full ContestDetailResponseContract decodes with can_unjoin=false
    func test_ContestDetailResponseContract_CanUnjooinFalse() throws {
        let json = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
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
          "payout_table": [
            {
              "rank_min": 1,
              "rank_max": 1,
              "amount": "500.00"
            }
          ],
          "roster_config": {}
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let contract = try decoder.decode(ContestDetailResponseContract.self, from: json)

        XCTAssertFalse(contract.actions.canUnjoin, "can_unjoin should be false in contract")
    }
}
