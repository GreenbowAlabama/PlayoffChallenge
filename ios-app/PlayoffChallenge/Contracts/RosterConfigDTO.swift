import Foundation

/// DTO for roster configuration.
/// Maps to OpenAPI RosterConfig schema.
/// Supports both generic and sport-specific fields.
struct RosterConfigDTO: Decodable {
    // Generic fields
    let rosterSize: Int?
    let entryFields: [JSONValue]?
    let validationRules: JSONValue?

    // PGA-specific fields
    let lineupSize: Int?
    let scoringCount: Int?
    let dropLowest: Bool?

    enum CodingKeys: String, CodingKey {
        case rosterSize = "roster_size"
        case lineupSize = "lineup_size"
        case scoringCount = "scoring_count"
        case dropLowest = "drop_lowest"
        case entryFields = "entry_fields"
        case validationRules = "validation_rules"
    }
}
