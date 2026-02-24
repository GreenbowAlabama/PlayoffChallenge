//
//  LeaderboardContractFixtures.swift
//  PlayoffChallengeTests
//
//  Immutable JSON fixtures for LeaderboardResponseContract.
//  Used to detect backend contract drift.
//

import Foundation
@testable import PlayoffChallenge

enum LeaderboardContractFixtures {

    static let validComputedJSON = """
    {
      "contest_id": "550e8400-e29b-41d4-a716-446655440000",
      "contest_type": "playoff",
      "leaderboard_state": "computed",
      "generated_at": "2026-02-17T10:30:00Z",
      "column_schema": [
        {
          "key": "rank",
          "label": "Rank",
          "type": "number",
          "format": null
        },
        {
          "key": "name",
          "label": "Player",
          "type": "text",
          "format": null
        },
        {
          "key": "points",
          "label": "Points",
          "type": "currency",
          "format": "USD"
        }
      ],
      "rows": [
        {
          "rank": 1,
          "name": "Champion",
          "points": 250.50
        }
      ]
    }
    """

    static let validPendingJSON = """
    {
      "contest_id": "550e8400-e29b-41d4-a716-446655440000",
      "contest_type": "playoff",
      "leaderboard_state": "pending",
      "generated_at": null,
      "column_schema": [
        {
          "key": "rank",
          "label": "Rank",
          "type": "number",
          "format": null
        },
        {
          "key": "name",
          "label": "Player",
          "type": "text",
          "format": null
        }
      ],
      "rows": []
    }
    """

    static let validErrorJSON = """
    {
      "contest_id": "550e8400-e29b-41d4-a716-446655440000",
      "contest_type": "playoff",
      "leaderboard_state": "error",
      "generated_at": null,
      "column_schema": [],
      "rows": []
    }
    """

    static let missingLeaderboardStateJSON = """
    {
      "contest_id": "550e8400-e29b-41d4-a716-446655440000",
      "contest_type": "playoff",
      "generated_at": null,
      "column_schema": [
        {
          "key": "rank",
          "label": "Rank",
          "type": "number",
          "format": null
        }
      ],
      "rows": []
    }
    """

    static let missingColumnSchemaJSON = """
    {
      "contest_id": "550e8400-e29b-41d4-a716-446655440000",
      "contest_type": "playoff",
      "leaderboard_state": "computed",
      "generated_at": null,
      "rows": [
        {
          "rank": 1,
          "name": "Player1"
        }
      ]
    }
    """

    static let missingRowsJSON = """
    {
      "contest_id": "550e8400-e29b-41d4-a716-446655440000",
      "contest_type": "playoff",
      "leaderboard_state": "computed",
      "generated_at": null,
      "column_schema": [
        {
          "key": "rank",
          "label": "Rank",
          "type": "number",
          "format": null
        }
      ]
    }
    """
}
