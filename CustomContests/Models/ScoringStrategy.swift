import Foundation

// MARK: - Scoring Strategy Protocol

/// Protocol for calculating scores from picks and events.
/// Implementations must be pure functions: same input always produces same output.
protocol ScoringStrategy {
    /// Unique key identifying this strategy.
    var key: String { get }

    /// Calculates the score for given picks and events.
    /// - Parameter input: The picks and events to score.
    /// - Returns: The scoring result with total and breakdown.
    func calculateScore(for input: ScoringInput) -> ScoringResult
}

// MARK: - Scoring Input/Output Models

/// Input for scoring calculation.
struct ScoringInput: Equatable {
    let picks: [ScoringPick]
    let events: [ScoringEvent]
}

/// A player pick for scoring purposes.
struct ScoringPick: Codable, Equatable {
    let playerId: String
    let position: String
    let playerName: String?

    enum CodingKeys: String, CodingKey {
        case playerId = "player_id"
        case position
        case playerName = "player_name"
    }

    init(playerId: String, position: String, playerName: String? = nil) {
        self.playerId = playerId
        self.position = position
        self.playerName = playerName
    }
}

/// A scoring event from the data source.
struct ScoringEvent: Codable, Equatable {
    let playerId: String
    let eventType: String
    let value: Int

    enum CodingKeys: String, CodingKey {
        case playerId = "player_id"
        case eventType = "event_type"
        case value
    }
}

/// Result of scoring calculation.
struct ScoringResult: Equatable {
    let totalScore: Double
    let breakdown: [ScoreBreakdownItem]
}

/// Breakdown of score for a single player.
struct ScoreBreakdownItem: Equatable {
    let playerId: String
    let playerName: String?
    let points: Double
    let details: [String: Double]

    init(playerId: String, playerName: String? = nil, points: Double, details: [String: Double] = [:]) {
        self.playerId = playerId
        self.playerName = playerName
        self.points = points
        self.details = details
    }
}

// MARK: - Standard Scoring Strategy

/// Standard fantasy football scoring strategy.
/// Sport-agnostic implementation that uses configurable point values.
struct StandardScoringStrategy: ScoringStrategy {
    let key = "standard"

    /// Point values per event type.
    private let pointValues: [String: Double] = [
        "passing_td": 6.0,
        "passing_yds": 0.04,
        "interception": -2.0,
        "rushing_td": 6.0,
        "rushing_yds": 0.1,
        "receiving_td": 6.0,
        "receiving_yds": 0.1,
        "reception": 1.0,
        "fumble_lost": -2.0
    ]

    func calculateScore(for input: ScoringInput) -> ScoringResult {
        let pickedPlayerIds = Set(input.picks.map { $0.playerId })
        let playerNameMap = Dictionary(
            input.picks.map { ($0.playerId, $0.playerName) },
            uniquingKeysWith: { first, _ in first }
        )

        // Group events by player
        var playerEvents: [String: [ScoringEvent]] = [:]
        for event in input.events where pickedPlayerIds.contains(event.playerId) {
            playerEvents[event.playerId, default: []].append(event)
        }

        // Calculate score for each picked player
        var breakdown: [ScoreBreakdownItem] = []
        var totalScore: Double = 0

        for playerId in pickedPlayerIds {
            let events = playerEvents[playerId] ?? []
            var playerPoints: Double = 0
            var details: [String: Double] = [:]

            for event in events {
                let pointValue = pointValues[event.eventType] ?? 0
                let points = pointValue * Double(event.value)
                playerPoints += points
                details[event.eventType] = (details[event.eventType] ?? 0) + points
            }

            breakdown.append(ScoreBreakdownItem(
                playerId: playerId,
                playerName: playerNameMap[playerId] ?? nil,
                points: playerPoints,
                details: details
            ))
            totalScore += playerPoints
        }

        return ScoringResult(totalScore: totalScore, breakdown: breakdown)
    }
}

// MARK: - Scoring Strategy Registry

/// Registry for looking up scoring strategies by key.
/// Uses a shared instance pattern for simplicity; not a true singleton.
final class ScoringStrategyRegistry {
    static let shared = ScoringStrategyRegistry()

    private var strategies: [String: ScoringStrategy]

    init() {
        let standard = StandardScoringStrategy()
        strategies = [
            standard.key: standard
        ]
    }

    /// Returns the strategy for a given key, or nil if not found.
    func strategy(for key: String) -> ScoringStrategy? {
        strategies[key]
    }

    /// Returns all available strategy keys.
    var availableKeys: [String] {
        Array(strategies.keys)
    }

    /// Registers a new strategy. Used for testing or dynamic configuration.
    func register(_ strategy: ScoringStrategy) {
        strategies[strategy.key] = strategy
    }
}
