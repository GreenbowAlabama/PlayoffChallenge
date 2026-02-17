//
//  Models.swift
//  PlayoffChallenge
//
//  Unified + crash-safe decoding for all API models
//

import Foundation

// MARK: - Flexible Double Decoder
struct FlexibleDouble: Codable {
    let value: Double

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let d = try? container.decode(Double.self) {
            value = d
        } else if let s = try? container.decode(String.self),
                  let d = Double(s.replacingOccurrences(of: ",", with: "")) {
            value = d
        } else {
            throw DecodingError.typeMismatch(
                Double.self,
                .init(codingPath: decoder.codingPath,
                      debugDescription: "Expected Double or String convertible to Double")
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(value)
    }
}

// MARK: - User
struct User: Codable, Identifiable {
    let id: UUID
    let appleId: String?
    let username: String?
    let email: String?
    let name: String?
    let teamName: String?
    let phone: String?
    let paid: Bool
    let paymentMethod: String?
    let paymentDate: String?
    let isAdmin: Bool
    let createdAt: String?

    // Compliance fields
    let state: String?
    let ipStateVerified: String?
    let stateCertificationDate: String?
    let eligibilityConfirmedAt: String?
    let tosVersion: String?
    let tosAcceptedAt: String?
    let ageVerified: Bool?

    enum CodingKeys: String, CodingKey {
        case id
        case appleId = "apple_id"
        case username
        case email
        case name
        case teamName = "team_name"
        case phone
        case paid
        case paymentMethod = "payment_method"
        case paymentDate = "payment_date"
        case isAdmin = "is_admin"
        case createdAt = "created_at"

        // Compliance fields
        case state
        case ipStateVerified = "ip_state_verified"
        case stateCertificationDate = "state_certification_date"
        case eligibilityConfirmedAt = "eligibility_confirmed_at"
        case tosVersion = "tos_version"
        case tosAcceptedAt = "tos_accepted_at"
        case ageVerified = "age_verified"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        appleId = try c.decodeIfPresent(String.self, forKey: .appleId)
        username = try c.decodeIfPresent(String.self, forKey: .username)
        email = try c.decodeIfPresent(String.self, forKey: .email)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        teamName = try c.decodeIfPresent(String.self, forKey: .teamName)
        phone = try c.decodeIfPresent(String.self, forKey: .phone)
        paid = (try? c.decode(Bool.self, forKey: .paid)) ?? false
        paymentMethod = try c.decodeIfPresent(String.self, forKey: .paymentMethod)
        paymentDate = try c.decodeIfPresent(String.self, forKey: .paymentDate)
        isAdmin = (try? c.decode(Bool.self, forKey: .isAdmin)) ?? false
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)

        // Compliance fields
        state = try c.decodeIfPresent(String.self, forKey: .state)
        ipStateVerified = try c.decodeIfPresent(String.self, forKey: .ipStateVerified)
        stateCertificationDate = try c.decodeIfPresent(String.self, forKey: .stateCertificationDate)
        eligibilityConfirmedAt = try c.decodeIfPresent(String.self, forKey: .eligibilityConfirmedAt)
        tosVersion = try c.decodeIfPresent(String.self, forKey: .tosVersion)
        tosAcceptedAt = try c.decodeIfPresent(String.self, forKey: .tosAcceptedAt)
        ageVerified = try c.decodeIfPresent(Bool.self, forKey: .ageVerified)
    }

    var hasPaid: Bool { paid }
    var hasAcceptedTOS: Bool { tosAcceptedAt != nil }
    var hasConfirmedEligibility: Bool { eligibilityConfirmedAt != nil }
}

// MARK: - Player
struct Player: Codable, Identifiable {
    let id: String
    let sleeperId: String?
    let fullName: String
    let position: String
    let team: String?
    let isActive: Bool
    let gameTime: String?
    let imageUrl: String?

    enum CodingKeys: String, CodingKey {
        case id
        case sleeperId = "sleeper_id"
        case fullName = "full_name"
        case position
        case team
        case isActive = "is_active"
        case gameTime = "game_time"
        case imageUrl = "image_url"
    }
}

// MARK: - Pick
struct Pick: Codable, Identifiable {
    let id: UUID
    let userId: UUID
    let playerId: String
    let position: String
    let weekNumber: Int
    let locked: Bool
    let fullName: String?
    let team: String?
    let playerPosition: String?
    let sleeperId: String?
    let consecutiveWeeks: Int?
    let multiplier: Double?
    let isByeWeek: Bool?
    let imageUrl: String?

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case playerId = "player_id"
        case position
        case weekNumber = "week_number"
        case locked
        case fullName = "full_name"
        case team
        case playerPosition = "player_position"
        case sleeperId = "sleeper_id"
        case consecutiveWeeks = "consecutive_weeks"
        case multiplier
        case isByeWeek = "is_bye_week"
        case imageUrl = "image_url"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        userId = try c.decode(UUID.self, forKey: .userId)
        playerId = try c.decode(String.self, forKey: .playerId)
        position = try c.decode(String.self, forKey: .position)
        weekNumber = try c.decode(Int.self, forKey: .weekNumber)
        locked = (try? c.decode(Bool.self, forKey: .locked)) ?? false
        fullName = try c.decodeIfPresent(String.self, forKey: .fullName)
        team = try c.decodeIfPresent(String.self, forKey: .team)
        playerPosition = try c.decodeIfPresent(String.self, forKey: .playerPosition)
        sleeperId = try c.decodeIfPresent(String.self, forKey: .sleeperId)
        consecutiveWeeks = try c.decodeIfPresent(Int.self, forKey: .consecutiveWeeks)
        if let s = try? c.decode(String.self, forKey: .multiplier) {
            multiplier = Double(s)
        } else {
            multiplier = try c.decodeIfPresent(Double.self, forKey: .multiplier)
        }
        isByeWeek = try c.decodeIfPresent(Bool.self, forKey: .isByeWeek)
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
    }
}

// MARK: - Leaderboard

/// DEPRECATED for custom contests: Use LeaderboardResponseContract instead.
/// LeaderboardEntry is legacy-only, kept for weekly leaderboard (LeaderboardView) only.
/// Custom contest leaderboards MUST use LeaderboardResponseContract + schema-driven rendering.
@available(*, deprecated: 1.0, renamed: "LeaderboardResponseContract", message: "Custom contests must use LeaderboardResponseContract. LeaderboardEntry is legacy-only.")
struct LeaderboardEntry: Codable, Identifiable {
    let id: UUID
    let username: String?
    let name: String?
    let email: String?
    let teamName: String?
    let totalPoints: Double
    let hasPaid: Bool
    let picks: [LeaderboardPick]?

    var displayName: String {
        // Leaderboards always show username, never the user's real name
        username ?? email ?? "Unknown"
    }

    enum CodingKeys: String, CodingKey {
        case id
        case username
        case name
        case email
        case teamName = "team_name"
        case totalPoints = "total_points"
        case hasPaid = "has_paid"
        case picks
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        username = try c.decodeIfPresent(String.self, forKey: .username)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        email = try c.decodeIfPresent(String.self, forKey: .email)
        teamName = try c.decodeIfPresent(String.self, forKey: .teamName)
        hasPaid = try c.decode(Bool.self, forKey: .hasPaid)
        picks = try c.decodeIfPresent([LeaderboardPick].self, forKey: .picks)
        if let s = try? c.decode(String.self, forKey: .totalPoints) {
            totalPoints = Double(s) ?? 0
        } else {
            totalPoints = try c.decode(Double.self, forKey: .totalPoints)
        }
    }
}

// MARK: - Leaderboard Pick (embedded in leaderboard response)
struct LeaderboardPick: Codable, Identifiable {
    let pickId: String
    let locked: Bool
    let position: String
    let fullName: String
    let team: String
    let opponent: String?
    let isHome: Bool?
    let sleeperId: String?
    let imageUrl: String?
    let basePoints: Double
    let multiplier: Double
    let points: Double

    var id: String { pickId }

    enum CodingKeys: String, CodingKey {
        case pickId = "pick_id"
        case locked
        case position
        case fullName = "full_name"
        case team
        case opponent
        case isHome = "is_home"
        case sleeperId = "sleeper_id"
        case imageUrl = "image_url"
        case basePoints = "base_points"
        case multiplier
        case points
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pickId = try c.decode(String.self, forKey: .pickId)
        locked = (try? c.decode(Bool.self, forKey: .locked)) ?? false
        position = try c.decode(String.self, forKey: .position)
        fullName = try c.decode(String.self, forKey: .fullName)
        team = try c.decode(String.self, forKey: .team)
        opponent = try c.decodeIfPresent(String.self, forKey: .opponent)
        isHome = try c.decodeIfPresent(Bool.self, forKey: .isHome)
        sleeperId = try c.decodeIfPresent(String.self, forKey: .sleeperId)
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)

        // Handle flexible number decoding
        if let s = try? c.decode(String.self, forKey: .basePoints) {
            basePoints = Double(s) ?? 0
        } else {
            basePoints = (try? c.decode(Double.self, forKey: .basePoints)) ?? 0
        }

        if let s = try? c.decode(String.self, forKey: .multiplier) {
            multiplier = Double(s) ?? 1
        } else {
            multiplier = (try? c.decode(Double.self, forKey: .multiplier)) ?? 1
        }

        if let s = try? c.decode(String.self, forKey: .points) {
            points = Double(s) ?? 0
        } else {
            points = (try? c.decode(Double.self, forKey: .points)) ?? 0
        }
    }
}

// MARK: - Game Settings
struct GameSettings: Codable {
    let id: UUID?
    let entryAmount: Double
    let venmoHandle: String?
    let cashappHandle: String?
    let zelleHandle: String?
    let qbLimit: Int?
    let rbLimit: Int?
    let wrLimit: Int?
    let teLimit: Int?
    let kLimit: Int?
    let defLimit: Int?
    let currentPlayoffWeek: Int
    let playoffStartWeek: Int
    let isWeekActive: Bool?

    enum CodingKeys: String, CodingKey {
        case id
        case entryAmount = "entry_amount"
        case venmoHandle = "venmo_handle"
        case cashappHandle = "cashapp_handle"
        case zelleHandle = "zelle_handle"
        case qbLimit = "qb_limit"
        case rbLimit = "rb_limit"
        case wrLimit = "wr_limit"
        case teLimit = "te_limit"
        case kLimit = "k_limit"
        case defLimit = "def_limit"
        case currentPlayoffWeek = "current_playoff_week"
        case playoffStartWeek = "playoff_start_week"
        case isWeekActive = "is_week_active"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(UUID.self, forKey: .id)
        if let s = try? c.decode(String.self, forKey: .entryAmount) {
            entryAmount = Double(s) ?? 50.0
        } else {
            entryAmount = try c.decode(Double.self, forKey: .entryAmount)
        }
        venmoHandle = try c.decodeIfPresent(String.self, forKey: .venmoHandle)
        cashappHandle = try c.decodeIfPresent(String.self, forKey: .cashappHandle)
        zelleHandle = try c.decodeIfPresent(String.self, forKey: .zelleHandle)
        qbLimit = try c.decodeIfPresent(Int.self, forKey: .qbLimit)
        rbLimit = try c.decodeIfPresent(Int.self, forKey: .rbLimit)
        wrLimit = try c.decodeIfPresent(Int.self, forKey: .wrLimit)
        teLimit = try c.decodeIfPresent(Int.self, forKey: .teLimit)
        kLimit = try c.decodeIfPresent(Int.self, forKey: .kLimit)
        defLimit = try c.decodeIfPresent(Int.self, forKey: .defLimit)
        currentPlayoffWeek = (try? c.decode(Int.self, forKey: .currentPlayoffWeek)) ?? 10
        playoffStartWeek = (try? c.decode(Int.self, forKey: .playoffStartWeek)) ?? 0
        isWeekActive = try c.decodeIfPresent(Bool.self, forKey: .isWeekActive)
    }
}

// MARK: - Scoring Rule
struct ScoringRule: Codable, Identifiable {
    let id: Int
    let category: String
    let statName: String
    let points: Double
    let description: String?
    let isActive: Bool?  // Optional since API filters to active rules only
    let displayOrder: Int

    enum CodingKeys: String, CodingKey {
        case id
        case category
        case statName = "stat_name"
        case points
        case description
        case isActive = "is_active"
        case displayOrder = "display_order"
    }
}

struct ScoringRulesResponse: Codable {
    let passing: [ScoringRule]?
    let rushing: [ScoringRule]?
    let receiving: [ScoringRule]?
    let special: [ScoringRule]?
    let kicking: [ScoringRule]?
    let defense: [ScoringRule]?
}

// MARK: - Rules Content
struct RulesContent: Codable, Identifiable {
    let id: Int
    let section: String
    let content: String
    let displayOrder: Int

    enum CodingKeys: String, CodingKey {
        case id
        case section
        case content
        case displayOrder = "display_order"
    }
}

// MARK: - Position Requirement
struct PositionRequirement: Codable, Identifiable {
    let id: Int
    let position: String
    let requiredCount: Int
    let displayName: String
    let displayOrder: Int
    let isActive: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case position
        case requiredCount = "required_count"
        case displayName = "display_name"
        case displayOrder = "display_order"
        case isActive = "is_active"
    }
}

// MARK: - PlayerSwap
struct PlayerSwap: Codable, Identifiable {
    let id: Int
    let userId: UUID
    let oldPlayerId: String
    let newPlayerId: String
    let position: String
    let weekNumber: Int
    let swappedAt: String
}

// MARK: - API Request/Response
struct PickSubmission: Codable {
    let playerId: String
    let position: String

    enum CodingKeys: String, CodingKey {
        case playerId = "player_id"
        case position
    }
}

struct APIResponse: Codable {
    let success: Bool
    let message: String?
    let error: String?
}

// MARK: - Payouts
struct PayoutResponse: Codable {
    let entryAmount: Double
    let paidUsers: Int
    let totalPot: Double
    let payouts: [Payout]

    enum CodingKeys: String, CodingKey {
        case entryAmount = "entry_amount"
        case paidUsers = "paid_users"
        case totalPot = "total_pot"
        case payouts
    }
    
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        
        // Handle entry_amount as string or double
        if let s = try? c.decode(String.self, forKey: .entryAmount) {
            entryAmount = Double(s) ?? 50.0
        } else {
            entryAmount = try c.decode(Double.self, forKey: .entryAmount)
        }
        
        paidUsers = try c.decode(Int.self, forKey: .paidUsers)
        
        // Handle total_pot as string or double
        if let s = try? c.decode(String.self, forKey: .totalPot) {
            totalPot = Double(s) ?? 0.0
        } else {
            totalPot = try c.decode(Double.self, forKey: .totalPot)
        }
        
        payouts = try c.decode([Payout].self, forKey: .payouts)
    }
}

struct Payout: Codable, Identifiable {
    let id: Int
    let place: Int
    let percentage: Double
    let description: String?
    let amount: Double
    
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        place = try c.decode(Int.self, forKey: .place)
        
        // Handle percentage as string or double
        if let s = try? c.decode(String.self, forKey: .percentage) {
            percentage = Double(s) ?? 0.0
        } else {
            percentage = try c.decode(Double.self, forKey: .percentage)
        }
        
        description = try c.decodeIfPresent(String.self, forKey: .description)
        
        // Handle amount as string or double
        if let s = try? c.decode(String.self, forKey: .amount) {
            amount = Double(s) ?? 0.0
        } else {
            amount = try c.decode(Double.self, forKey: .amount)
        }
    }
}

// MARK: - Scores
struct PlayerScore: Codable, Identifiable {
    let id: UUID
    let userId: UUID
    let playerId: String
    let weekNumber: Int
    let basePoints: Double
    let multiplier: Double
    let finalPoints: Double
    let fullName: String?
    let position: String?
    let team: String?
}

struct WeekScore: Codable, Identifiable {
    let id: UUID
    let username: String
    let teamName: String?
    let paid: Bool
    let weekPoints: Double
}

struct ScoreBreakdown: Codable, Identifiable {
    let id: UUID
    let basePoints: Double
    let multiplier: Double
    let finalPoints: Double
    let fullName: String
    let position: String
    let team: String
}

struct WeekInfo: Codable {
    let weekNumber: Int
    let displayName: String

    enum CodingKeys: String, CodingKey {
        case weekNumber = "week_number"
        case displayName = "display_name"
    }
}

// MARK: - AnyCodable Helper
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) { self.value = value }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let b = try? c.decode(Bool.self) { value = b }
        else if let i = try? c.decode(Int.self) { value = i }
        else if let d = try? c.decode(Double.self) { value = d }
        else if let s = try? c.decode(String.self) { value = s }
        else if let arr = try? c.decode([AnyCodable].self) { value = arr.map { $0.value } }
        else if let dict = try? c.decode([String: AnyCodable].self) { value = dict.mapValues { $0.value } }
        else {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Cannot decode AnyCodable")
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case let b as Bool: try c.encode(b)
        case let i as Int: try c.encode(i)
        case let d as Double: try c.encode(d)
        case let s as String: try c.encode(s)
        case let arr as [Any]: try c.encode(arr.map { AnyCodable($0) })
        case let dict as [String: Any]: try c.encode(dict.mapValues { AnyCodable($0) })
        default:
            throw EncodingError.invalidValue(value, .init(codingPath: c.codingPath, debugDescription: "Cannot encode AnyCodable"))
        }
    }
}

// MARK: - Contract DTOs (Iteration 02 — iOS Contract Compliance)

/// Behavior flags driven by backend contest state.
/// These are the source of truth for UI gating.
struct ContestActions: Codable, Hashable, Equatable {
    let can_join: Bool
    let can_edit_entry: Bool
    let is_live: Bool
    let is_closed: Bool
    let is_scoring: Bool
    let is_scored: Bool
    let is_read_only: Bool

    enum CodingKeys: String, CodingKey {
        case can_join
        case can_edit_entry
        case is_live
        case is_closed
        case is_scoring
        case is_scored
        case is_read_only
    }

    init(can_join: Bool, can_edit_entry: Bool, is_live: Bool, is_closed: Bool, is_scoring: Bool, is_scored: Bool, is_read_only: Bool) {
        self.can_join = can_join
        self.can_edit_entry = can_edit_entry
        self.is_live = is_live
        self.is_closed = is_closed
        self.is_scoring = is_scoring
        self.is_scored = is_scored
        self.is_read_only = is_read_only
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        can_join = try c.decode(Bool.self, forKey: .can_join)
        can_edit_entry = try c.decode(Bool.self, forKey: .can_edit_entry)
        is_live = try c.decode(Bool.self, forKey: .is_live)
        is_closed = try c.decode(Bool.self, forKey: .is_closed)
        is_scoring = try c.decode(Bool.self, forKey: .is_scoring)
        is_scored = try c.decode(Bool.self, forKey: .is_scored)
        is_read_only = try c.decode(Bool.self, forKey: .is_read_only)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(can_join, forKey: .can_join)
        try c.encode(can_edit_entry, forKey: .can_edit_entry)
        try c.encode(is_live, forKey: .is_live)
        try c.encode(is_closed, forKey: .is_closed)
        try c.encode(is_scoring, forKey: .is_scoring)
        try c.encode(is_scored, forKey: .is_scored)
        try c.encode(is_read_only, forKey: .is_read_only)
    }
}

/// Leaderboard computation state (not UI state).
enum LeaderboardState: String, Decodable {
    case pending
    case computed
    case error
}

/// Schema definition for dynamic leaderboard columns.
struct LeaderboardColumnSchema: Decodable {
    let key: String
    let label: String
    let type: String?
    let format: String?

    enum CodingKeys: String, CodingKey {
        case key, label, type, format
    }

    init(key: String, label: String, type: String? = nil, format: String? = nil) {
        self.key = key
        self.label = label
        self.type = type
        self.format = format
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        label = try c.decode(String.self, forKey: .label)
        type = try c.decodeIfPresent(String.self, forKey: .type)
        format = try c.decodeIfPresent(String.self, forKey: .format)
    }
}

/// Dynamic leaderboard row (contest-type-agnostic).
typealias LeaderboardRow = [String: AnyCodable]

/// Backend leaderboard contract response.
struct LeaderboardResponseContract: Decodable {
    let contest_id: String
    let contest_type: String
    let leaderboard_state: LeaderboardState
    let generated_at: String?
    let column_schema: [LeaderboardColumnSchema]
    let rows: [LeaderboardRow]

    enum CodingKeys: String, CodingKey {
        case contest_id
        case contest_type
        case leaderboard_state
        case generated_at
        case column_schema
        case rows
    }

    init(contest_id: String, contest_type: String, leaderboard_state: LeaderboardState, generated_at: String? = nil, column_schema: [LeaderboardColumnSchema], rows: [LeaderboardRow]) {
        self.contest_id = contest_id
        self.contest_type = contest_type
        self.leaderboard_state = leaderboard_state
        self.generated_at = generated_at
        self.column_schema = column_schema
        self.rows = rows
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        contest_id = try c.decode(String.self, forKey: .contest_id)
        contest_type = try c.decode(String.self, forKey: .contest_type)
        leaderboard_state = try c.decode(LeaderboardState.self, forKey: .leaderboard_state)
        generated_at = try c.decodeIfPresent(String.self, forKey: .generated_at)
        column_schema = try c.decode([LeaderboardColumnSchema].self, forKey: .column_schema)
        rows = try c.decode([LeaderboardRow].self, forKey: .rows)
    }
}

/// Payout tier in contest detail contract.
struct PayoutTierContract: Decodable {
    let rank_min: Int
    let rank_max: Int
    let amount: Decimal

    enum CodingKeys: String, CodingKey {
        case rank_min
        case rank_max
        case amount
    }

    init(rank_min: Int, rank_max: Int, amount: Decimal) {
        self.rank_min = rank_min
        self.rank_max = rank_max
        self.amount = amount
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rank_min = try c.decode(Int.self, forKey: .rank_min)
        rank_max = try c.decode(Int.self, forKey: .rank_max)

        // Handle amount as string or number — fail loudly on malformed value
        if let s = try? c.decode(String.self, forKey: .amount) {
            guard let parsed = Decimal(string: s) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .amount,
                    in: c,
                    debugDescription: "Invalid decimal string for amount: \(s)"
                )
            }
            amount = parsed
        } else {
            let d = try c.decode(Double.self, forKey: .amount)
            amount = Decimal(d)
        }
    }
}

/// Roster configuration (contest-type-agnostic).
typealias RosterConfigContract = [String: AnyCodable]

/// Contest detail contract response (source of truth for contest state).
struct ContestDetailResponseContract: Decodable {
    let contest_id: String
    let type: String
    let leaderboard_state: LeaderboardState
    let actions: ContestActions
    let payout_table: [PayoutTierContract]
    let roster_config: RosterConfigContract

    enum CodingKeys: String, CodingKey {
        case contest_id
        case type
        case leaderboard_state
        case actions
        case payout_table
        case roster_config
    }

    init(contest_id: String, type: String, leaderboard_state: LeaderboardState, actions: ContestActions, payout_table: [PayoutTierContract], roster_config: RosterConfigContract) {
        self.contest_id = contest_id
        self.type = type
        self.leaderboard_state = leaderboard_state
        self.actions = actions
        self.payout_table = payout_table
        self.roster_config = roster_config
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        contest_id = try c.decode(String.self, forKey: .contest_id)
        type = try c.decode(String.self, forKey: .type)
        leaderboard_state = try c.decode(LeaderboardState.self, forKey: .leaderboard_state)
        actions = try c.decode(ContestActions.self, forKey: .actions)
        // Required fields — no fallback
        payout_table = try c.decode([PayoutTierContract].self, forKey: .payout_table)
        roster_config = try c.decode(RosterConfigContract.self, forKey: .roster_config)
    }
}
