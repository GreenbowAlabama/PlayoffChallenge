import XCTest
@testable import PlayoffChallenge

/// Tests for ScoringStrategy protocol and implementations.
/// Scoring strategies are pure functions: deterministic outputs from inputs.
final class ScoringStrategyTests: XCTestCase {

    // MARK: - ScoringInput Tests

    func test_scoringInput_creation() {
        let pick = ScoringPick(playerId: "player_123", position: "QB")
        let event = ScoringEvent(
            playerId: "player_123",
            eventType: "passing_td",
            value: 1
        )
        let input = ScoringInput(picks: [pick], events: [event])

        XCTAssertEqual(input.picks.count, 1)
        XCTAssertEqual(input.events.count, 1)
        XCTAssertEqual(input.picks[0].playerId, "player_123")
    }

    func test_scoringInput_emptyEventsAllowed() {
        let pick = ScoringPick(playerId: "player_123", position: "QB")
        let input = ScoringInput(picks: [pick], events: [])

        XCTAssertEqual(input.picks.count, 1)
        XCTAssertTrue(input.events.isEmpty)
    }

    // MARK: - ScoringResult Tests

    func test_scoringResult_creation() {
        let breakdown = ScoreBreakdownItem(
            playerId: "player_123",
            playerName: "Test Player",
            points: 25.5,
            details: ["passing_td": 6.0, "passing_yds": 19.5]
        )
        let result = ScoringResult(totalScore: 25.5, breakdown: [breakdown])

        XCTAssertEqual(result.totalScore, 25.5, accuracy: 0.001)
        XCTAssertEqual(result.breakdown.count, 1)
        XCTAssertEqual(result.breakdown[0].playerId, "player_123")
    }

    func test_scoringResult_zeroScore() {
        let result = ScoringResult(totalScore: 0, breakdown: [])

        XCTAssertEqual(result.totalScore, 0)
        XCTAssertTrue(result.breakdown.isEmpty)
    }

    // MARK: - StandardScoringStrategy Tests

    func test_standardStrategy_hasCorrectKey() {
        let strategy = StandardScoringStrategy()

        XCTAssertEqual(strategy.key, "standard")
    }

    func test_standardStrategy_calculateScore_withNoEvents_returnsZero() {
        let strategy = StandardScoringStrategy()
        let pick = ScoringPick(playerId: "player_123", position: "QB")
        let input = ScoringInput(picks: [pick], events: [])

        let result = strategy.calculateScore(for: input)

        XCTAssertEqual(result.totalScore, 0)
    }

    func test_standardStrategy_calculateScore_withSingleEvent() {
        let strategy = StandardScoringStrategy()
        let pick = ScoringPick(playerId: "player_123", position: "QB")
        let event = ScoringEvent(
            playerId: "player_123",
            eventType: "passing_td",
            value: 2
        )
        let input = ScoringInput(picks: [pick], events: [event])

        let result = strategy.calculateScore(for: input)

        // Standard scoring: passing_td = 6 points per
        XCTAssertEqual(result.totalScore, 12.0, accuracy: 0.001)
    }

    func test_standardStrategy_calculateScore_withMultipleEvents() {
        let strategy = StandardScoringStrategy()
        let pick = ScoringPick(playerId: "player_123", position: "QB")
        let events = [
            ScoringEvent(playerId: "player_123", eventType: "passing_td", value: 2),
            ScoringEvent(playerId: "player_123", eventType: "passing_yds", value: 300),
            ScoringEvent(playerId: "player_123", eventType: "interception", value: 1)
        ]
        let input = ScoringInput(picks: [pick], events: events)

        let result = strategy.calculateScore(for: input)

        // 2 passing_td * 6 = 12
        // 300 passing_yds * 0.04 = 12
        // 1 interception * -2 = -2
        // Total = 22
        XCTAssertEqual(result.totalScore, 22.0, accuracy: 0.001)
    }

    func test_standardStrategy_calculateScore_ignoresEventsForNonPickedPlayers() {
        let strategy = StandardScoringStrategy()
        let pick = ScoringPick(playerId: "player_123", position: "QB")
        let events = [
            ScoringEvent(playerId: "player_123", eventType: "passing_td", value: 1),
            ScoringEvent(playerId: "other_player", eventType: "passing_td", value: 5) // Not picked
        ]
        let input = ScoringInput(picks: [pick], events: events)

        let result = strategy.calculateScore(for: input)

        // Only counts player_123's TD, not other_player
        XCTAssertEqual(result.totalScore, 6.0, accuracy: 0.001)
    }

    func test_standardStrategy_calculateScore_withMultiplePicks() {
        let strategy = StandardScoringStrategy()
        let picks = [
            ScoringPick(playerId: "qb_1", position: "QB"),
            ScoringPick(playerId: "rb_1", position: "RB")
        ]
        let events = [
            ScoringEvent(playerId: "qb_1", eventType: "passing_td", value: 2),
            ScoringEvent(playerId: "rb_1", eventType: "rushing_td", value: 1),
            ScoringEvent(playerId: "rb_1", eventType: "rushing_yds", value: 100)
        ]
        let input = ScoringInput(picks: picks, events: events)

        let result = strategy.calculateScore(for: input)

        // 2 passing_td * 6 = 12
        // 1 rushing_td * 6 = 6
        // 100 rushing_yds * 0.1 = 10
        // Total = 28
        XCTAssertEqual(result.totalScore, 28.0, accuracy: 0.001)
    }

    func test_standardStrategy_calculateScore_breakdown() {
        let strategy = StandardScoringStrategy()
        let pick = ScoringPick(playerId: "player_123", position: "QB", playerName: "Test QB")
        let events = [
            ScoringEvent(playerId: "player_123", eventType: "passing_td", value: 1),
            ScoringEvent(playerId: "player_123", eventType: "passing_yds", value: 250)
        ]
        let input = ScoringInput(picks: [pick], events: events)

        let result = strategy.calculateScore(for: input)

        XCTAssertEqual(result.breakdown.count, 1)
        XCTAssertEqual(result.breakdown[0].playerId, "player_123")
        XCTAssertEqual(result.breakdown[0].playerName, "Test QB")
        // 1 * 6 + 250 * 0.04 = 6 + 10 = 16
        XCTAssertEqual(result.breakdown[0].points, 16.0, accuracy: 0.001)
    }

    // MARK: - Strategy Determinism Tests

    func test_standardStrategy_isDeterministic() {
        let strategy = StandardScoringStrategy()
        let pick = ScoringPick(playerId: "player_123", position: "QB")
        let events = [
            ScoringEvent(playerId: "player_123", eventType: "passing_td", value: 3),
            ScoringEvent(playerId: "player_123", eventType: "passing_yds", value: 400)
        ]
        let input = ScoringInput(picks: [pick], events: events)

        let result1 = strategy.calculateScore(for: input)
        let result2 = strategy.calculateScore(for: input)
        let result3 = strategy.calculateScore(for: input)

        XCTAssertEqual(result1.totalScore, result2.totalScore)
        XCTAssertEqual(result2.totalScore, result3.totalScore)
    }

    // MARK: - ScoringEvent Encoding Tests

    func test_scoringEvent_encodesToSnakeCaseJSON() throws {
        let event = ScoringEvent(
            playerId: "player_123",
            eventType: "passing_td",
            value: 2
        )

        let encoder = JSONEncoder()
        let data = try encoder.encode(event)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(json["player_id"] as? String, "player_123")
        XCTAssertEqual(json["event_type"] as? String, "passing_td")
        XCTAssertEqual(json["value"] as? Int, 2)
    }

    func test_scoringEvent_decodesFromSnakeCaseJSON() throws {
        let json = """
        {
            "player_id": "player_456",
            "event_type": "rushing_td",
            "value": 3
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let event = try decoder.decode(ScoringEvent.self, from: json)

        XCTAssertEqual(event.playerId, "player_456")
        XCTAssertEqual(event.eventType, "rushing_td")
        XCTAssertEqual(event.value, 3)
    }

    // MARK: - ScoringStrategyRegistry Tests

    func test_registry_retrievesStandardStrategy() {
        let registry = ScoringStrategyRegistry.shared

        let strategy = registry.strategy(for: "standard")

        XCTAssertNotNil(strategy)
        XCTAssertEqual(strategy?.key, "standard")
    }

    func test_registry_returnsNilForUnknownKey() {
        let registry = ScoringStrategyRegistry.shared

        let strategy = registry.strategy(for: "unknown_strategy")

        XCTAssertNil(strategy)
    }

    func test_registry_listsAvailableKeys() {
        let registry = ScoringStrategyRegistry.shared

        let keys = registry.availableKeys

        XCTAssertTrue(keys.contains("standard"))
    }
}
