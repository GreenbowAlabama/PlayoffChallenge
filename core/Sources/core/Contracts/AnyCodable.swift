//
//  AnyCodable.swift
//  core
//
//  Type-erased Codable wrapper for heterogeneous JSON structures.
//  Used for contest-type-agnostic roster_config and leaderboard rows.
//

import Foundation

/// AnyCodable: Type-erased Codable for contest-agnostic data structures.
/// Decodes JSON values to Any without type loss.
public struct AnyCodable: Codable, @unchecked Sendable {
    public let value: Any

    public init(_ value: Any) { self.value = value }

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { value = NSNull() }
        else if let b = try? c.decode(Bool.self) { value = b }
        else if let i = try? c.decode(Int.self) { value = i }
        else if let d = try? c.decode(Double.self) { value = d }
        else if let s = try? c.decode(String.self) { value = s }
        else if let arr = try? c.decode([AnyCodable].self) { value = arr.map { $0.value } }
        else if let dict = try? c.decode([String: AnyCodable].self) { value = dict.mapValues { $0.value } }
        else {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Cannot decode AnyCodable")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case is NSNull: try c.encodeNil()
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

    // MARK: - Equatable

    public static func == (lhs: AnyCodable, rhs: AnyCodable) -> Bool {
        switch (lhs.value, rhs.value) {
        case (is NSNull, is NSNull): return true
        case let (l as Bool, r as Bool): return l == r
        case let (l as Int, r as Int): return l == r
        case let (l as Double, r as Double): return l == r
        case let (l as String, r as String): return l == r
        case let (l as [Any], r as [Any]):
            guard l.count == r.count else { return false }
            for (i, leftElement) in l.enumerated() {
                if !AnyCodable(leftElement).isEqual(to: r[i]) { return false }
            }
            return true
        case let (l as [String: Any], r as [String: Any]):
            guard l.count == r.count else { return false }
            for (key, leftValue) in l {
                guard let rightValue = r[key] else { return false }
                if !AnyCodable(leftValue).isEqual(to: rightValue) { return false }
            }
            return true
        default: return false
        }
    }

    private func isEqual(to other: Any) -> Bool {
        return AnyCodable(self.value) == AnyCodable(other)
    }
}

extension AnyCodable: Equatable {}
