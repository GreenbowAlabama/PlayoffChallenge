import Foundation

/// UI-only form state for contest creation.
/// Never decodes JSON.
/// Local-only state managed by ViewModel.
struct ContestCreationFormState: Equatable {
    var contestName: String = ""
    var entryFeeCents: Int = 0
    var maxEntries: Int = 10
    var lockTime: Date? = nil

    /// Check if form is valid for submission.
    var isValid: Bool {
        !contestName.trimmingCharacters(in: .whitespaces).isEmpty
            && entryFeeCents >= 0
            && maxEntries > 0
    }
}
