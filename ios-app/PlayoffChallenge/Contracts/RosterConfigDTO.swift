import Foundation

/// DTO for roster configuration.
/// Maps to OpenAPI RosterConfig schema.
struct RosterConfigDTO: Decodable {
    let entry_fields: [JSONValue]
    let validation_rules: JSONValue
}
