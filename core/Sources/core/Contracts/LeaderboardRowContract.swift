//
//  LeaderboardRowContract.swift
//  core
//
//  Contract for a dynamic leaderboard row.
//

import Foundation

/// LeaderboardRowContract: Represents a user's standing in a leaderboard.
/// Handles dynamic fields while providing access to known common fields.
public struct LeaderboardRowContract: Decodable, Sendable {
    public let id: String
    public let userId: String
    public let username: String
    public let rank: Int
    public let values: [String: AnyCodable]
    public let tier: Int?
    
    private struct DynamicCodingKeys: CodingKey {
        var stringValue: String
        init?(stringValue: String) { self.stringValue = stringValue }
        var intValue: Int?
        init?(intValue: Int) { return nil }
    }
    
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKeys.self)
        var dynamicValues: [String: AnyCodable] = [:]
        
        for key in container.allKeys {
            if let value = try? container.decode(AnyCodable.self, forKey: key) {
                dynamicValues[key.stringValue] = value
            }
        }
        
        self.values = dynamicValues
        
        // Extract known fields with fallbacks for adversarial fixtures
        self.id = (dynamicValues["id"]?.value as? String) ?? (dynamicValues["user_id"]?.value as? String) ?? ""
        self.userId = (dynamicValues["user_id"]?.value as? String) ?? (dynamicValues["id"]?.value as? String) ?? ""
        self.username = (dynamicValues["username"]?.value as? String) ?? ""
        
        if let rankVal = dynamicValues["rank"]?.value {
            if let intRank = rankVal as? Int {
                self.rank = intRank
            } else if let doubleRank = rankVal as? Double {
                self.rank = Int(doubleRank)
            } else if let stringRank = rankVal as? String {
                self.rank = Int(stringRank) ?? 0
            } else {
                self.rank = 0
            }
        } else {
            self.rank = 0
        }
        
        if let tierVal = dynamicValues["tier"]?.value {
            if let intTier = tierVal as? Int {
                self.tier = intTier
            } else if let doubleTier = tierVal as? Double {
                self.tier = Int(doubleTier)
            } else {
                self.tier = nil
            }
        } else {
            self.tier = nil
        }
    }

    public init(id: String, userId: String, username: String, rank: Int, values: [String: AnyCodable], tier: Int?) {
        self.id = id
        self.userId = userId
        self.username = username
        self.rank = rank
        self.values = values
        self.tier = tier
    }
    
    /// Provides subscript access to dynamic fields.
    public subscript(key: String) -> AnyCodable? {
        return values[key]
    }
}
