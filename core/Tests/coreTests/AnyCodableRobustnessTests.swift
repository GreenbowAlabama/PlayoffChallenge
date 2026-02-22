//
//  AnyCodableRobustnessTests.swift
//  coreTests
//
//  Tests AnyCodable against pathological inputs (medium-risk area).
//  Proves type-erased Codable handles deep nesting, nulls, mixed types, and edge cases.
//  Includes invariant test: unknown contest_type must decode without failure.
//

import XCTest
@testable import core

final class AnyCodableRobustnessTests: XCTestCase {

    // MARK: - Null Values

    func test_AnyCodable_DecodesNullValue() throws {
        let json = "null".data(using: .utf8)!
        let decoder = JSONDecoder()

        let result = try decoder.decode(AnyCodable.self, from: json)

        XCTAssertTrue(result.value is NSNull)
    }

    func test_LeaderboardRow_WithNullValues_Decodes() throws {
        let json = """
        {
          "rank": 1,
          "username": "Player",
          "optional_field": null,
          "other_field": "value"
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let row = try decoder.decode(
            [String: AnyCodable].self,
            from: json
        )

        XCTAssertEqual(row.count, 4)
        XCTAssertTrue(row["optional_field"]!.value is NSNull)
    }

    func test_RosterConfig_WithNulls_Decodes() throws {
        let json = """
        {
          "scoring_rules": null,
          "max_entries": 100,
          "empty_value": null
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let config = try decoder.decode(
            [String: AnyCodable].self,
            from: json
        )

        XCTAssertEqual(config.count, 3)
        XCTAssertTrue(config["scoring_rules"]!.value is NSNull)
        XCTAssertTrue(config["empty_value"]!.value is NSNull)
    }

    // MARK: - Deeply Nested Structures

    func test_AnyCodable_DecodingNestedObjects() throws {
        let json = """
        {
          "level1": {
            "level2": {
              "level3": {
                "level4": {
                  "value": "deeply_nested"
                }
              }
            }
          }
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let result = try decoder.decode(
            [String: AnyCodable].self,
            from: json
        )

        XCTAssertNotNil(result["level1"])
    }

    func test_AnyCodable_DecodingNestedArrays() throws {
        let json = """
        [
          [
            [
              [1, 2, 3]
            ]
          ]
        ]
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let result = try decoder.decode(
            [AnyCodable].self,
            from: json
        )

        XCTAssertEqual(result.count, 1)
    }

    func test_AnyCodable_MixedNestingWithNulls() throws {
        let json = """
        {
          "array_of_objects": [
            {"key": "value", "null_key": null},
            {"nested": {"deep": null}}
          ],
          "object_of_arrays": {
            "list": [1, null, "string", null]
          }
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let result = try decoder.decode(
            [String: AnyCodable].self,
            from: json
        )

        XCTAssertEqual(result.count, 2)
        XCTAssertNotNil(result["array_of_objects"])
        XCTAssertNotNil(result["object_of_arrays"])
    }

    // MARK: - Mixed Types

    func test_AnyCodable_MixedTypesInObject() throws {
        let json = """
        {
          "string": "value",
          "number": 42,
          "float": 3.14,
          "boolean": true,
          "null": null,
          "array": [1, "two", 3.0],
          "object": {"nested": "value"}
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let result = try decoder.decode(
            [String: AnyCodable].self,
            from: json
        )

        XCTAssertEqual(result.count, 7)
        XCTAssertNotNil(result["string"])
        XCTAssertNotNil(result["number"])
        XCTAssertNotNil(result["float"])
        XCTAssertNotNil(result["boolean"])
        XCTAssertNotNil(result["null"])
        XCTAssertNotNil(result["array"])
        XCTAssertNotNil(result["object"])
    }

    func test_AnyCodable_MixedTypesInArray() throws {
        let json = """
        [1, "string", 3.14, true, null, {"obj": "value"}, [1, 2]]
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let result = try decoder.decode(
            [AnyCodable].self,
            from: json
        )

        XCTAssertEqual(result.count, 7)
    }

    // MARK: - Empty Structures

    func test_AnyCodable_EmptyObject_Decodes() throws {
        let json = "{}".data(using: .utf8)!

        let decoder = JSONDecoder()
        let result = try decoder.decode(
            [String: AnyCodable].self,
            from: json
        )

        XCTAssertTrue(result.isEmpty)
    }

    func test_AnyCodable_EmptyArray_Decodes() throws {
        let json = "[]".data(using: .utf8)!

        let decoder = JSONDecoder()
        let result = try decoder.decode(
            [AnyCodable].self,
            from: json
        )

        XCTAssertTrue(result.isEmpty)
    }

    // MARK: - Large Structures

    func test_AnyCodable_LargeFlatObject() throws {
        var jsonDict = [String: String]()
        for i in 0..<100 {
            jsonDict["key_\(i)"] = "value_\(i)"
        }

        let encoder = JSONEncoder()
        let jsonData = try encoder.encode(
            jsonDict.mapValues { AnyCodable($0) }
        )

        let decoder = JSONDecoder()
        let result = try decoder.decode(
            [String: AnyCodable].self,
            from: jsonData
        )

        XCTAssertEqual(result.count, 100)
    }

    func test_AnyCodable_LargeNestedStructure() throws {
        var json = "{"
        for i in 0..<50 {
            json += "\"level_\(i)\": {\"value\": \(i)}"
            if i < 49 {
                json += ","
            }
        }
        json += "}"

        let data = json.data(using: .utf8)!
        let decoder = JSONDecoder()
        let result = try decoder.decode(
            [String: AnyCodable].self,
            from: data
        )

        XCTAssertEqual(result.count, 50)
    }

    // MARK: - Round-Trip Encoding

    func test_AnyCodable_RoundTrip_NullValue() throws {
        let original = AnyCodable(NSNull())

        let encoder = JSONEncoder()
        let encoded = try encoder.encode(original)

        let decoder = JSONDecoder()
        let decoded = try decoder.decode(AnyCodable.self, from: encoded)

        XCTAssertTrue(decoded.value is NSNull)
    }

    func test_AnyCodable_RoundTrip_ComplexStructure() throws {
        let json = """
        {
          "string": "value",
          "number": 42,
          "null": null,
          "nested": {"inner": "data"}
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let decoded = try decoder.decode(
            [String: AnyCodable].self,
            from: json
        )

        XCTAssertEqual(decoded.count, 4)
        XCTAssertTrue(decoded["null"]!.value is NSNull)

        // Re-encode and verify
        let encoder = JSONEncoder()
        let reencoded = try encoder.encode(decoded)

        let redecoded = try decoder.decode(
            [String: AnyCodable].self,
            from: reencoded
        )

        XCTAssertEqual(redecoded.count, 4)
        XCTAssertTrue(redecoded["null"]!.value is NSNull)
    }

    // MARK: - Invariant Test: Unknown Contest Type

    func test_UnknownContestType_DecodesWithoutRestriction() throws {
        let json = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
          "contest_type": "future_sport_we_dont_know_yet",
          "leaderboard_state": "computed",
          "column_schema": [],
          "rows": []
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let leaderboard = try decoder.decode(
            LeaderboardResponseContract.self,
            from: json
        )

        // LITMUS TEST: This must succeed
        XCTAssertEqual(leaderboard.contest_type, "future_sport_we_dont_know_yet")
        XCTAssertNotNil(leaderboard.contest_type)
    }

    func test_UnknownContestTypeWithUnknownColumns_Decodes() throws {
        let json = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
          "contest_type": "future_fantasy_esports_2030",
          "leaderboard_state": "computed",
          "column_schema": [
            {"key": "rank", "label": "Position"},
            {"key": "unknown_metric", "label": "Unknown", "type": "unknown_type"}
          ],
          "rows": [
            {"rank": 1, "unknown_metric": "future_value"}
          ]
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let leaderboard = try decoder.decode(
            LeaderboardResponseContract.self,
            from: json
        )

        XCTAssertEqual(leaderboard.contest_type, "future_fantasy_esports_2030")
        XCTAssertEqual(leaderboard.column_schema.count, 2)
        XCTAssertEqual(leaderboard.rows.count, 1)
    }

    func test_UnknownContestType_InContestDetail() throws {
        let json = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
          "type": "future_sport_2040",
          "leaderboard_state": "computed",
          "actions": {
            "can_join": true,
            "can_edit_entry": false,
            "is_live": true,
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
        let contest = try decoder.decode(
            ContestDetailResponseContract.self,
            from: json
        )

        // Contest type must not be restricted by core
        XCTAssertEqual(contest.type, "future_sport_2040")
    }

    func test_ArbitrarilyComplexContestType_StringValue() throws {
        let complexType = "sport_variant_with_modifiers_version_3_league_advanced_scoring_model"

        let json = """
        {
          "contest_id": "550e8400-e29b-41d4-a716-446655440000",
          "type": "\(complexType)",
          "leaderboard_state": "computed",
          "actions": {
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
          },
          "payout_table": [],
          "roster_config": {}
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let contest = try decoder.decode(
            ContestDetailResponseContract.self,
            from: json
        )

        XCTAssertEqual(contest.type, complexType)
    }
}
