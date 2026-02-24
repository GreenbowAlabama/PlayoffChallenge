//
//  AdversarialFixtureTests.swift
//  coreTests
//
//  Tests that core contracts decode adversarial fixtures without modification.
//  Proves architectural resilience under contract variation.
//

import XCTest
@testable import Core

final class AdversarialFixtureTests: XCTestCase {

    // MARK: - Fixture Helpers

    func loadFixture(_ filename: String) -> Data {
        let bundle = Bundle.module
        guard let url = bundle.url(forResource: filename, withExtension: "json", subdirectory: "Fixtures") else {
            XCTFail("Fixture \(filename) not found")
            return Data()
        }
        guard let data = try? Data(contentsOf: url) else {
            XCTFail("Could not load fixture \(filename)")
            return Data()
        }
        return data
    }

    // MARK: - Generic Minimal Contest

    func test_GenericMinimalContest_Decodes() throws {
        let data = loadFixture("generic_minimal_contest")
        let decoder = JSONDecoder()

        let contract = try decoder.decode(ContestDetailResponseContract.self, from: data)

        XCTAssertEqual(contract.contest_id, "550e8400-e29b-41d4-a716-446655440000")
        XCTAssertEqual(contract.type, "generic_minimal")
        XCTAssertEqual(contract.leaderboard_state, .pending)
        XCTAssertEqual(contract.payout_table.count, 0)
        XCTAssertTrue(contract.roster_config.isEmpty)
    }

    // MARK: - Weird Schema Contest (Adversarial)

    func test_WeirdSchemaContest_FutureUnknownType_Decodes() throws {
        let data = loadFixture("weird_schema_contest")
        let decoder = JSONDecoder()

        let contract = try decoder.decode(ContestDetailResponseContract.self, from: data)

        // Must NOT restrict to known types
        XCTAssertEqual(contract.type, "future_sport_we_dont_know_yet")
        XCTAssertEqual(contract.contest_id, "550e8401-e29b-41d4-a716-446655440001")
    }

    func test_WeirdSchemaContest_UnknownStrategyKeys_Preserved() throws {
        let data = loadFixture("weird_schema_contest")
        let decoder = JSONDecoder()

        let contract = try decoder.decode(ContestDetailResponseContract.self, from: data)

        // roster_config must preserve unknown keys as AnyCodable
        guard let configDict = contract.roster_config as? [String: Any] else {
            XCTFail("roster_config should be dictionary-like")
            return
        }

        let scoringKey = contract.roster_config["scoring_strategy_key"]
        let settlementKey = contract.roster_config["settlement_strategy_key"]

        // Both should exist and be opaque strings
        XCTAssertNotNil(scoringKey)
        XCTAssertNotNil(settlementKey)
    }

    func test_WeirdSchemaContest_DeeplyNestedConfig_Decodes() throws {
        let data = loadFixture("weird_schema_contest")
        let decoder = JSONDecoder()

        let contract = try decoder.decode(ContestDetailResponseContract.self, from: data)

        // Deep nesting in roster_config must not break
        let nestedStructure = contract.roster_config["nested_structure"]
        XCTAssertNotNil(nestedStructure)

        // Must handle mixed types
        let mixedTypes = contract.roster_config["mixed_types"]
        XCTAssertNotNil(mixedTypes)
    }

    func test_WeirdSchemaContest_NullsAndEmpty_Preserved() throws {
        let data = loadFixture("weird_schema_contest")
        let decoder = JSONDecoder()

        let contract = try decoder.decode(ContestDetailResponseContract.self, from: data)

        // Null values should decode
        let nullValue = contract.roster_config["nulls_present"]
        XCTAssertNotNil(nullValue)

        // Empty structures should decode
        let emptyObject = contract.roster_config["empty_object"]
        XCTAssertNotNil(emptyObject)

        let emptyArray = contract.roster_config["empty_array"]
        XCTAssertNotNil(emptyArray)
    }

    // MARK: - NFL Contest (Happy Path Control)

    func test_NFLContest_StandardSchema_Decodes() throws {
        let data = loadFixture("nfl_contest")
        let decoder = JSONDecoder()

        let contract = try decoder.decode(ContestDetailResponseContract.self, from: data)

        XCTAssertEqual(contract.type, "nfl")
        XCTAssertEqual(contract.payout_table.count, 4)
        XCTAssertEqual(contract.payout_table[0].amount, Decimal(1000))
    }

    func test_NFLContest_PositionLimits_StoredAsAnyCodable() throws {
        let data = loadFixture("nfl_contest")
        let decoder = JSONDecoder()

        let contract = try decoder.decode(ContestDetailResponseContract.self, from: data)

        // Position limits (QB, RB, WR, etc.) are just data in roster_config
        // Core must NOT restrict or validate position names
        let positionLimits = contract.roster_config["position_limits"]
        XCTAssertNotNil(positionLimits)
    }

    // MARK: - PGA Contest (Different Schema Control)

    func test_PGAContest_DifferentStructure_Decodes() throws {
        let data = loadFixture("pga_contest")
        let decoder = JSONDecoder()

        let contract = try decoder.decode(ContestDetailResponseContract.self, from: data)

        XCTAssertEqual(contract.type, "pga")
        XCTAssertEqual(contract.payout_table.count, 5)
    }

    func test_PGAContest_TournamentInfo_StoredAsAnyCodable() throws {
        let data = loadFixture("pga_contest")
        let decoder = JSONDecoder()

        let contract = try decoder.decode(ContestDetailResponseContract.self, from: data)

        // Tournament-specific data must be stored, not rejected
        let tournamentInfo = contract.roster_config["tournament_info"]
        XCTAssertNotNil(tournamentInfo)
    }

    // MARK: - Leaderboard Fixtures

    func test_FutureSportLeaderboard_UnknownContestType_Decodes() throws {
        let data = loadFixture("future_sport_leaderboard")
        let decoder = JSONDecoder()

        let contract = try decoder.decode(LeaderboardResponseContract.self, from: data)

        // LITMUS TEST: Unknown contest_type must decode as opaque string
        XCTAssertEqual(contract.contest_type, "future_sport_we_dont_know_yet")
        XCTAssertNotNil(contract.contest_type)
    }

    func test_FutureSportLeaderboard_DynamicColumns_Decodes() throws {
        let data = loadFixture("future_sport_leaderboard")
        let decoder = JSONDecoder()

        let contract = try decoder.decode(LeaderboardResponseContract.self, from: data)

        // Must handle columns with unknown types and formats
        XCTAssertEqual(contract.column_schema.count, 5)

        let unknownTypeColumn = contract.column_schema[3]
        XCTAssertEqual(unknownTypeColumn.type, "unknown")
    }

    func test_FutureSportLeaderboard_RowsWithNullsAndUnknownFields_Decode() throws {
        let data = loadFixture("future_sport_leaderboard")
        let decoder = JSONDecoder()

        let contract = try decoder.decode(LeaderboardResponseContract.self, from: data)

        // Rows may have null values and unknown fields
        XCTAssertEqual(contract.rows.count, 3)

        // First row has mixed types
        let firstRow = contract.rows[0]
        let nullField = firstRow["unknown_metric_2"]
        XCTAssertNotNil(nullField)

        // Rows can have extra fields not in schema
        let extraField = firstRow["custom_field"]
        XCTAssertNotNil(extraField)
    }

    func test_NFLLeaderboard_SportSpecificColumns_Decoded() throws {
        let data = loadFixture("nfl_leaderboard")
        let decoder = JSONDecoder()

        let contract = try decoder.decode(LeaderboardResponseContract.self, from: data)

        // Column keys like "qb_points", "rb_points" are just strings
        XCTAssertEqual(contract.column_schema.count, 6)
        XCTAssertEqual(contract.column_schema[3].key, "qb_points")

        // Core must not validate or restrict column names
        XCTAssertTrue(contract.column_schema.allSatisfy { $0.key.isEmpty == false })
    }

    func test_PGALeaderboard_ScoreFormat_Decodes() throws {
        let data = loadFixture("pga_leaderboard")
        let decoder = JSONDecoder()

        let contract = try decoder.decode(LeaderboardResponseContract.self, from: data)

        // PGA scores can be negative (below par)
        let firstRow = contract.rows[0]
        // Scores are AnyCodable, not restricted by core
        XCTAssertNotNil(firstRow["total_score"])
    }

    // MARK: - Settlement Fixtures

    func test_SettlementInputSimple_Decodes() throws {
        let data = loadFixture("settlement_input_simple")
        let decoder = JSONDecoder()

        let input = try JSONDecoder().decode([String: AnyCodable].self, from: data)

        // Should contain ranked_entries and prize_pool
        XCTAssertNotNil(input["ranked_entries"])
        XCTAssertNotNil(input["prize_pool"])
    }

    // MARK: - Cross-Fixture Invariants

    func test_AllContestFixtures_DecodeToDifferentSchemas() throws {
        let genericData = loadFixture("generic_minimal_contest")
        let weirdData = loadFixture("weird_schema_contest")
        let nflData = loadFixture("nfl_contest")
        let pgaData = loadFixture("pga_contest")

        let decoder = JSONDecoder()

        // All must decode using THE SAME CONTRACT
        let generic = try decoder.decode(ContestDetailResponseContract.self, from: genericData)
        let weird = try decoder.decode(ContestDetailResponseContract.self, from: weirdData)
        let nfl = try decoder.decode(ContestDetailResponseContract.self, from: nflData)
        let pga = try decoder.decode(ContestDetailResponseContract.self, from: pgaData)

        // All are valid but different
        XCTAssertNotEqual(generic.type, nfl.type)
        XCTAssertNotEqual(nfl.type, pga.type)
        XCTAssertNotEqual(generic.roster_config.count, weird.roster_config.count)
    }

    func test_AllLeaderboardFixtures_DecodeToDifferentSchemas() throws {
        let futureData = loadFixture("future_sport_leaderboard")
        let nflData = loadFixture("nfl_leaderboard")
        let pgaData = loadFixture("pga_leaderboard")

        let decoder = JSONDecoder()

        let future = try decoder.decode(LeaderboardResponseContract.self, from: futureData)
        let nfl = try decoder.decode(LeaderboardResponseContract.self, from: nflData)
        let pga = try decoder.decode(LeaderboardResponseContract.self, from: pgaData)

        // All decode successfully to same contract despite different schemas
        XCTAssertEqual(future.contest_type, "future_sport_we_dont_know_yet")
        XCTAssertEqual(nfl.contest_type, "nfl")
        XCTAssertEqual(pga.contest_type, "pga")

        // Column counts differ (proves schema is dynamic)
        XCTAssertNotEqual(nfl.column_schema.count, pga.column_schema.count)
    }
}
