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
        name ?? username ?? email ?? "Unknown"
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
