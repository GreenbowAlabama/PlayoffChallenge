import Foundation

/// Validation rules for contest templates and instances against templates.
enum ContestTemplateValidation {

    // MARK: - Template Validation

    /// Validates that a template has all required fields.
    /// - Returns: nil if valid, or the appropriate error if invalid.
    static func validateTemplate(_ template: ContestTemplate) -> ContestTemplateError? {
        let trimmedName = template.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedName.isEmpty {
            return .templateNameRequired
        }

        let trimmedSportKey = template.sportKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedSportKey.isEmpty {
            return .sportKeyRequired
        }

        let trimmedScoringKey = template.scoringStrategyKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedScoringKey.isEmpty {
            return .scoringStrategyKeyRequired
        }

        let trimmedSettlementKey = template.settlementStrategyKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedSettlementKey.isEmpty {
            return .settlementStrategyKeyRequired
        }

        return nil
    }

    // MARK: - Instance Against Template Validation

    /// Validates that instance settings conform to template constraints.
    /// - Parameters:
    ///   - maxEntries: The max entries setting for the instance.
    ///   - entryFee: The entry fee for the instance.
    ///   - template: The template to validate against.
    /// - Returns: nil if valid, or the appropriate error if invalid.
    static func validateInstanceSettings(
        maxEntries: Int,
        entryFee: Decimal,
        against template: ContestTemplate
    ) -> ContestTemplateError? {
        // Check if template is active
        guard template.isActive else {
            return .templateNotActive
        }

        // Check max entries constraints
        if maxEntries < template.constraints.minEntries {
            return .maxEntriesBelowTemplateMinimum(minimum: template.constraints.minEntries)
        }
        if maxEntries > template.constraints.maxEntries {
            return .maxEntriesAboveTemplateMaximum(maximum: template.constraints.maxEntries)
        }

        // Check entry fee constraints
        if !template.constraints.isEntryFeeAllowed(entryFee) {
            return .entryFeeNotAllowed(allowed: template.constraints.allowedEntryFees)
        }

        return nil
    }
}
