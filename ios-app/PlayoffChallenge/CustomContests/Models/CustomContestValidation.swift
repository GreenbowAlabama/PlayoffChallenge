import Foundation
import Core

/// Validation rules and limits for custom contests.
enum CustomContestValidation {
    static let nameMaxLength = 50
    static let maxEntriesMinimum = 2
    static let maxEntriesMaximum = 1000

    /// Validates a contest name.
    /// - Returns: nil if valid, or the appropriate error if invalid.
    static func validateName(_ name: String) -> CustomContestError? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return .nameRequired
        }
        if trimmed.count > nameMaxLength {
            return .nameTooLong(maxLength: nameMaxLength)
        }
        return nil
    }

    /// Validates the max entries value.
    /// - Returns: nil if valid, or the appropriate error if invalid.
    static func validateMaxEntries(_ maxEntries: Int) -> CustomContestError? {
        if maxEntries <= 0 {
            return .maxEntriesInvalid
        }
        if maxEntries < maxEntriesMinimum {
            return .maxEntriesTooLow(minimum: maxEntriesMinimum)
        }
        if maxEntries > maxEntriesMaximum {
            return .maxEntriesTooHigh(maximum: maxEntriesMaximum)
        }
        return nil
    }

    /// Validates whether a draft can be published.
    /// - Returns: nil if eligible, or the appropriate error if not.
    static func validatePublishEligibility(_ draft: CustomContestDraft) -> CustomContestError? {
        // Validate contained data
        if let nameError = validateName(draft.name) {
            return nameError
        }
        if let entriesError = validateMaxEntries(draft.settings.maxEntries) {
            return entriesError
        }
        return nil
    }

    /// Validates a lock time, if provided.
    /// - Returns: nil if valid or not set, or the appropriate error if invalid.
    static func validateLockTime(_ lockTime: Date?) -> CustomContestError? {
        guard let lockTime else { return nil }
        if lockTime <= Date() {
            return .lockTimeInPast
        }
        return nil
    }

    /// Validates all fields for draft creation.
    /// - Returns: Array of validation errors, empty if all valid.
    static func validateDraftCreation(name: String, maxEntries: Int, lockTime: Date? = nil) -> [CustomContestError] {
        var errors: [CustomContestError] = []
        if let nameError = validateName(name) {
            errors.append(nameError)
        }
        if let entriesError = validateMaxEntries(maxEntries) {
            errors.append(entriesError)
        }
        if let lockTimeError = validateLockTime(lockTime) {
            errors.append(lockTimeError)
        }
        return errors
    }
}
