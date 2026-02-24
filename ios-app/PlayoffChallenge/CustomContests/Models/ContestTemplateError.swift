import Foundation

/// Error types for contest template operations.
enum ContestTemplateError: Error, Equatable, LocalizedError {
    // Template validation errors
    case templateNameRequired
    case sportKeyRequired
    case scoringStrategyKeyRequired
    case settlementStrategyKeyRequired
    case templateNotFound
    case templateNotActive

    // Instance validation against template errors
    case maxEntriesBelowTemplateMinimum(minimum: Int)
    case maxEntriesAboveTemplateMaximum(maximum: Int)
    case entryFeeNotAllowed(allowed: [Decimal])

    // Strategy errors
    case scoringStrategyNotFound(key: String)
    case settlementStrategyNotFound(key: String)

    var errorDescription: String? {
        switch self {
        case .templateNameRequired:
            return "Template name is required."
        case .sportKeyRequired:
            return "Sport key is required."
        case .scoringStrategyKeyRequired:
            return "Scoring strategy key is required."
        case .settlementStrategyKeyRequired:
            return "Settlement strategy key is required."
        case .templateNotFound:
            return "Template not found."
        case .templateNotActive:
            return "This template is not currently active."
        case .maxEntriesBelowTemplateMinimum(let minimum):
            return "Maximum entries must be at least \(minimum) for this contest type."
        case .maxEntriesAboveTemplateMaximum(let maximum):
            return "Maximum entries cannot exceed \(maximum) for this contest type."
        case .entryFeeNotAllowed(let allowed):
            let feeStrings = allowed.map { "\($0)" }.joined(separator: ", ")
            return "Entry fee must be one of: \(feeStrings)."
        case .scoringStrategyNotFound(let key):
            return "Scoring strategy '\(key)' not found."
        case .settlementStrategyNotFound(let key):
            return "Settlement strategy '\(key)' not found."
        }
    }

    var title: String {
        switch self {
        case .templateNameRequired, .sportKeyRequired,
             .scoringStrategyKeyRequired, .settlementStrategyKeyRequired:
            return "Invalid Template"
        case .templateNotFound:
            return "Not Found"
        case .templateNotActive:
            return "Template Inactive"
        case .maxEntriesBelowTemplateMinimum, .maxEntriesAboveTemplateMaximum:
            return "Invalid Entry Limit"
        case .entryFeeNotAllowed:
            return "Invalid Entry Fee"
        case .scoringStrategyNotFound, .settlementStrategyNotFound:
            return "Strategy Not Found"
        }
    }
}
