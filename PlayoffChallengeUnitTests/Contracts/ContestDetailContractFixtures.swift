//
//  ContestDetailContractFixtures.swift
//  PlayoffChallengeTests
//
//  Immutable JSON fixtures for ContestDetailResponseContract.
//  Used to detect backend contract drift.
//

import Foundation
@testable import PlayoffChallenge

enum ContestDetailContractFixtures {

    /// Reference fixture (version 1.0).
    /// Update when backend intentionally changes contract.
    static let validContractJSON = """
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
        "can_manage_contest": false
      },
      "payout_table": [
        {
          "rank_min": 1,
          "rank_max": 1,
          "amount": "500.00"
        },
        {
          "rank_min": 2,
          "rank_max": 2,
          "amount": "300.00"
        }
      ],
      "roster_config": {
        "max_entries": 10,
        "entry_fee": 25.00
      }
    }
    """

    /// Missing required field: actions.
    static let missingActionsJSON = """
    {
      "contest_id": "550e8400-e29b-41d4-a716-446655440000",
      "type": "playoff",
      "leaderboard_state": "computed",
      "payout_table": [],
      "roster_config": {}
    }
    """

    /// Missing required field: payout_table.
    static let missingPayoutTableJSON = """
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
        "can_manage_contest": false
      },
      "roster_config": {}
    }
    """

    /// Missing required field: roster_config.
    static let missingRosterConfigJSON = """
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
        "can_manage_contest": false
      },
      "payout_table": []
    }
    """

    /// Missing required field: can_share_invite in actions.
    static let missingCanShareInviteJSON = """
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
        "can_manage_contest": false
      },
      "payout_table": [],
      "roster_config": {}
    }
    """

    /// Missing required field: can_manage_contest in actions.
    static let missingCanManageContestJSON = """
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
        "can_share_invite": true
      },
      "payout_table": [],
      "roster_config": {}
    }
    """
}
