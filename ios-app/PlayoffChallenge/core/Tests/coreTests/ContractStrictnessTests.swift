//
//  ContractStrictnessTests.swift
//  coreTests
//
//  CLIENT LOCK V1: Strict contract decoding enforcement.
//  Verifies that all required contract fields MUST be present.
//  Missing any required field = immediate decode failure (no fallback).
//

import XCTest
@testable import core

final class ContractStrictnessTests: XCTestCase {

    // MARK: - ContestActions Strict Field Enforcement

    func test_ContestActions_ValidFixture_Decodes() throws {
        let json = """
        {
          "can_join": false,
          "can_edit_entry": true,
          "is_live": true,
          "is_closed": false,
          "is_scoring": false,
          "is_scored": true,
          "is_read_only": false,
          "can_share_invite": true,
          "can_manage_contest": false,
          "can_delete": true,
          "can_unjoin": false
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let actions = try decoder.decode(ContestActions.self, from: json)

        XCTAssertEqual(actions.can_join, false)
        XCTAssertEqual(actions.can_edit_entry, true)
        XCTAssertEqual(actions.can_share_invite, true)
        XCTAssertEqual(actions.can_manage_contest, false)
        XCTAssertEqual(actions.can_delete, true)
        XCTAssertEqual(actions.can_unjoin, false)
    }

    func test_ContestActions_MissingCanShareInvite_FailsDecode() {
        let json = """
        {
          "can_join": false,
          "can_edit_entry": true,
          "is_live": true,
          "is_closed": false,
          "is_scoring": false,
          "is_scored": true,
          "is_read_only": false,
          "can_manage_contest": false,
          "can_delete": true,
          "can_unjoin": false
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        XCTAssertThrowsError(
            try decoder.decode(ContestActions.self, from: json),
            "Missing can_share_invite must fail decode"
        )
    }

    func test_ContestActions_MissingCanManageContest_FailsDecode() {
        let json = """
        {
          "can_join": false,
          "can_edit_entry": true,
          "is_live": true,
          "is_closed": false,
          "is_scoring": false,
          "is_scored": true,
          "is_read_only": false,
          "can_share_invite": true,
          "can_delete": true,
          "can_unjoin": false
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        XCTAssertThrowsError(
            try decoder.decode(ContestActions.self, from: json),
            "Missing can_manage_contest must fail decode"
        )
    }

    func test_ContestActions_MissingCanDelete_FailsDecode() {
        let json = """
        {
          "can_join": false,
          "can_edit_entry": true,
          "is_live": true,
          "is_closed": false,
          "is_scoring": false,
          "is_scored": true,
          "is_read_only": false,
          "can_share_invite": true,
          "can_manage_contest": false,
          "can_unjoin": false
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        XCTAssertThrowsError(
            try decoder.decode(ContestActions.self, from: json),
            "Missing can_delete must fail decode"
        )
    }

    func test_ContestActions_MissingCanUnjoin_FailsDecode() {
        let json = """
        {
          "can_join": false,
          "can_edit_entry": true,
          "is_live": true,
          "is_closed": false,
          "is_scoring": false,
          "is_scored": true,
          "is_read_only": false,
          "can_share_invite": true,
          "can_manage_contest": false,
          "can_delete": true
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        XCTAssertThrowsError(
            try decoder.decode(ContestActions.self, from: json),
            "Missing can_unjoin must fail decode"
        )
    }

    // MARK: - ContestDetailResponseContract Strict Field Enforcement

    func test_ContestDetailResponseContract_ValidFixture_Decodes() throws {
        let json = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
          "type": "playoff",
          "leaderboard_state": "computed",
          "actions": {
            "can_join": false,
            "can_edit_entry": true,
            "is_live": true,
            "is_closed": false,
            "is_scoring": false,
            "is_scored": true,
            "is_read_only": false,
            "can_share_invite": true,
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
            "max_entries": 10
          }
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let contract = try decoder.decode(ContestDetailResponseContract.self, from: json)

        XCTAssertEqual(contract.contest_id, "550e8400-e29b-41d4-a716-446655440000")
        XCTAssertEqual(contract.type, "playoff")
        XCTAssertEqual(contract.actions.can_share_invite, true)
        XCTAssertEqual(contract.actions.can_manage_contest, false)
        XCTAssertEqual(contract.actions.can_delete, true)
        XCTAssertEqual(contract.actions.can_unjoin, false)
        XCTAssertEqual(contract.payout_table.count, 1)
    }

    func test_ContestDetailResponseContract_MissingActions_FailsDecode() {
        let json = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
          "type": "playoff",
          "leaderboard_state": "computed",
          "payout_table": [],
          "roster_config": {}
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        XCTAssertThrowsError(
            try decoder.decode(ContestDetailResponseContract.self, from: json),
            "Missing actions must fail decode"
        )
    }

    func test_ContestDetailResponseContract_MissingCanDeleteInActions_FailsDecode() {
        let json = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
          "type": "playoff",
          "leaderboard_state": "computed",
          "actions": {
            "can_join": false,
            "can_edit_entry": true,
            "is_live": true,
            "is_closed": false,
            "is_scoring": false,
            "is_scored": true,
            "is_read_only": false,
            "can_share_invite": true,
            "can_manage_contest": false,
            "can_unjoin": false
          },
          "payout_table": [],
          "roster_config": {}
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        XCTAssertThrowsError(
            try decoder.decode(ContestDetailResponseContract.self, from: json),
            "Missing can_delete in actions must fail decode"
        )
    }

    func test_ContestDetailResponseContract_MissingCanUnjoinInActions_FailsDecode() {
        let json = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
          "type": "playoff",
          "leaderboard_state": "computed",
          "actions": {
            "can_join": false,
            "can_edit_entry": true,
            "is_live": true,
            "is_closed": false,
            "is_scoring": false,
            "is_scored": true,
            "is_read_only": false,
            "can_share_invite": true,
            "can_manage_contest": false,
            "can_delete": true
          },
          "payout_table": [],
          "roster_config": {}
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        XCTAssertThrowsError(
            try decoder.decode(ContestDetailResponseContract.self, from: json),
            "Missing can_unjoin in actions must fail decode"
        )
    }

    func test_ContestDetailResponseContract_MissingPayoutTable_FailsDecode() {
        let json = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
          "type": "playoff",
          "leaderboard_state": "computed",
          "actions": {
            "can_join": false,
            "can_edit_entry": true,
            "is_live": true,
            "is_closed": false,
            "is_scoring": false,
            "is_scored": true,
            "is_read_only": false,
            "can_share_invite": true,
            "can_manage_contest": false,
            "can_delete": true,
            "can_unjoin": false
          },
          "roster_config": {}
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        XCTAssertThrowsError(
            try decoder.decode(ContestDetailResponseContract.self, from: json),
            "Missing payout_table must fail decode"
        )
    }

    func test_ContestDetailResponseContract_MissingRosterConfig_FailsDecode() {
        let json = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
          "type": "playoff",
          "leaderboard_state": "computed",
          "actions": {
            "can_join": false,
            "can_edit_entry": true,
            "is_live": true,
            "is_closed": false,
            "is_scoring": false,
            "is_scored": true,
            "is_read_only": false,
            "can_share_invite": true,
            "can_manage_contest": false,
            "can_delete": true,
            "can_unjoin": false
          },
          "payout_table": []
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        XCTAssertThrowsError(
            try decoder.decode(ContestDetailResponseContract.self, from: json),
            "Missing roster_config must fail decode"
        )
    }

    // MARK: - LeaderboardResponseContract Strict Field Enforcement

    func test_LeaderboardResponseContract_ValidComputedFixture_Decodes() throws {
        let json = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
          "contest_type": "playoff",
          "leaderboard_state": "computed",
          "column_schema": [
            {
              "key": "rank",
              "label": "Rank",
              "type": "number"
            },
            {
              "key": "username",
              "label": "Player",
              "type": "string"
            }
          ],
          "rows": [
            {
              "rank": 1,
              "username": "Player1"
            }
          ]
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let contract = try decoder.decode(LeaderboardResponseContract.self, from: json)

        XCTAssertEqual(contract.leaderboard_state, .computed)
        XCTAssertEqual(contract.column_schema.count, 2)
        XCTAssertEqual(contract.rows.count, 1)
    }

    func test_LeaderboardResponseContract_ValidPendingFixture_Decodes() throws {
        let json = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
          "contest_type": "playoff",
          "leaderboard_state": "pending",
          "column_schema": [],
          "rows": []
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let contract = try decoder.decode(LeaderboardResponseContract.self, from: json)

        XCTAssertEqual(contract.leaderboard_state, .pending)
        XCTAssertTrue(contract.rows.isEmpty)
    }

    func test_LeaderboardResponseContract_MissingLeaderboardState_FailsDecode() {
        let json = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
          "contest_type": "playoff",
          "column_schema": [],
          "rows": []
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        XCTAssertThrowsError(
            try decoder.decode(LeaderboardResponseContract.self, from: json),
            "Missing leaderboard_state must fail decode"
        )
    }

    func test_LeaderboardResponseContract_MissingColumnSchema_FailsDecode() {
        let json = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
          "contest_type": "playoff",
          "leaderboard_state": "computed",
          "rows": []
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        XCTAssertThrowsError(
            try decoder.decode(LeaderboardResponseContract.self, from: json),
            "Missing column_schema must fail decode"
        )
    }

    func test_LeaderboardResponseContract_MissingRows_FailsDecode() {
        let json = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
          "contest_type": "playoff",
          "leaderboard_state": "computed",
          "column_schema": []
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        XCTAssertThrowsError(
            try decoder.decode(LeaderboardResponseContract.self, from: json),
            "Missing rows must fail decode"
        )
    }

    // MARK: - State Is Source of Truth

    func test_LeaderboardState_StateEnum_DrivesAllLogic() throws {
        let pendingJSON = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
          "contest_type": "playoff",
          "leaderboard_state": "pending",
          "column_schema": [],
          "rows": []
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let contract = try decoder.decode(LeaderboardResponseContract.self, from: pendingJSON)

        // State enum must drive UI, not row count
        XCTAssertEqual(contract.leaderboard_state, .pending)
        XCTAssertTrue(contract.rows.isEmpty)
        // Pending state overrides any data presence logic
    }

    // MARK: - PayoutTierContract Decimal Parsing

    func test_PayoutTierContract_StringAmount_ParsesAsDecimal() throws {
        let json = """
        {
          "rank_min": 1,
          "rank_max": 1,
          "amount": "500.50"
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let tier = try decoder.decode(PayoutTierContract.self, from: json)

        XCTAssertEqual(tier.amount, Decimal(string: "500.50"))
    }

    func test_PayoutTierContract_MalformedDecimal_FailsDecode() {
        let json = """
        {
          "rank_min": 1,
          "rank_max": 1,
          "amount": "not-a-number"
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        XCTAssertThrowsError(
            try decoder.decode(PayoutTierContract.self, from: json),
            "Malformed decimal must fail decode"
        )
    }
}
