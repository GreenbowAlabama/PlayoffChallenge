//
//  ContestStatus.swift
//  core
//
//  Domain model for contest status.
//

import Foundation

/// Domain contest status enum.
/// Maps from string wire representation.
public enum ContestStatus: String, Codable, Hashable, Equatable, Sendable {
    case scheduled = "SCHEDULED"
    case locked = "LOCKED"
    case live = "LIVE"
    case complete = "COMPLETE"
    case cancelled = "CANCELLED"
    case error = "ERROR"
    
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        
        if let status = ContestStatus(rawValue: rawValue.uppercased()) {
            self = status
        } else {
            // Fallback for cases like "Live" or "Scheduled"
            switch rawValue.lowercased() {
            case "scheduled": self = .scheduled
            case "locked": self = .locked
            case "live": self = .live
            case "complete": self = .complete
            case "cancelled": self = .cancelled
            case "error": self = .error
            default:
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Invalid contest status: \(rawValue)"
                )
            }
        }
    }
}
