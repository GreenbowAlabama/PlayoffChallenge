import XCTest
@testable import PlayoffChallenge

/// Tests for CustomContestValidation rules.
final class CustomContestValidationTests: XCTestCase {

    // MARK: - Name Validation Tests

    func test_validateName_withValidName_returnsNil() {
        let result = CustomContestValidation.validateName("My Contest")
        XCTAssertNil(result)
    }

    func test_validateName_withEmptyString_returnsNameRequired() {
        let result = CustomContestValidation.validateName("")
        XCTAssertEqual(result, .nameRequired)
    }

    func test_validateName_withWhitespaceOnly_returnsNameRequired() {
        let result = CustomContestValidation.validateName("   ")
        XCTAssertEqual(result, .nameRequired)
    }

    func test_validateName_atMaxLength_returnsNil() {
        let name = String(repeating: "a", count: CustomContestValidation.nameMaxLength)
        let result = CustomContestValidation.validateName(name)
        XCTAssertNil(result)
    }

    func test_validateName_exceedingMaxLength_returnsNameTooLong() {
        let name = String(repeating: "a", count: CustomContestValidation.nameMaxLength + 1)
        let result = CustomContestValidation.validateName(name)
        XCTAssertEqual(result, .nameTooLong(maxLength: CustomContestValidation.nameMaxLength))
    }

    // MARK: - Max Entries Validation Tests

    func test_validateMaxEntries_withValidValue_returnsNil() {
        let result = CustomContestValidation.validateMaxEntries(10)
        XCTAssertNil(result)
    }

    func test_validateMaxEntries_withZero_returnsInvalid() {
        let result = CustomContestValidation.validateMaxEntries(0)
        XCTAssertEqual(result, .maxEntriesInvalid)
    }

    func test_validateMaxEntries_withNegative_returnsInvalid() {
        let result = CustomContestValidation.validateMaxEntries(-5)
        XCTAssertEqual(result, .maxEntriesInvalid)
    }

    func test_validateMaxEntries_belowMinimum_returnsTooLow() {
        let result = CustomContestValidation.validateMaxEntries(1)
        XCTAssertEqual(result, .maxEntriesTooLow(minimum: CustomContestValidation.maxEntriesMinimum))
    }

    func test_validateMaxEntries_atMinimum_returnsNil() {
        let result = CustomContestValidation.validateMaxEntries(CustomContestValidation.maxEntriesMinimum)
        XCTAssertNil(result)
    }

    func test_validateMaxEntries_atMaximum_returnsNil() {
        let result = CustomContestValidation.validateMaxEntries(CustomContestValidation.maxEntriesMaximum)
        XCTAssertNil(result)
    }

    func test_validateMaxEntries_exceedingMaximum_returnsTooHigh() {
        let result = CustomContestValidation.validateMaxEntries(CustomContestValidation.maxEntriesMaximum + 1)
        XCTAssertEqual(result, .maxEntriesTooHigh(maximum: CustomContestValidation.maxEntriesMaximum))
    }

    // MARK: - Publish Eligibility Tests

    func test_validatePublishEligibility_withValidDraft_returnsNil() {
        let draft = CustomContestDraft(
            name: "Valid Contest",
            settings: CustomContestSettings(maxEntries: 10)
        )
        let result = CustomContestValidation.validatePublishEligibility(draft)
        XCTAssertNil(result)
    }

    func test_validatePublishEligibility_withOpenStatus_returnsNotInDraftState() {
        let draft = CustomContestDraft(
            name: "Open Contest",
            settings: CustomContestSettings(maxEntries: 10),
            status: .open
        )
        let result = CustomContestValidation.validatePublishEligibility(draft)
        XCTAssertEqual(result, .notInDraftState)
    }

    func test_validatePublishEligibility_withLockedStatus_returnsNotInDraftState() {
        let draft = CustomContestDraft(
            name: "Locked Contest",
            settings: CustomContestSettings(maxEntries: 10),
            status: .locked
        )
        let result = CustomContestValidation.validatePublishEligibility(draft)
        XCTAssertEqual(result, .notInDraftState)
    }

    func test_validatePublishEligibility_withCompletedStatus_returnsNotInDraftState() {
        let draft = CustomContestDraft(
            name: "Completed Contest",
            settings: CustomContestSettings(maxEntries: 10),
            status: .completed
        )
        let result = CustomContestValidation.validatePublishEligibility(draft)
        XCTAssertEqual(result, .notInDraftState)
    }

    func test_validatePublishEligibility_withCancelledStatus_returnsNotInDraftState() {
        let draft = CustomContestDraft(
            name: "Cancelled Contest",
            settings: CustomContestSettings(maxEntries: 10),
            status: .cancelled
        )
        let result = CustomContestValidation.validatePublishEligibility(draft)
        XCTAssertEqual(result, .notInDraftState)
    }

    func test_validatePublishEligibility_withEmptyName_returnsNameRequired() {
        let draft = CustomContestDraft(
            name: "",
            settings: CustomContestSettings(maxEntries: 10)
        )
        let result = CustomContestValidation.validatePublishEligibility(draft)
        XCTAssertEqual(result, .nameRequired)
    }

    func test_validatePublishEligibility_withInvalidMaxEntries_returnsEntriesError() {
        let draft = CustomContestDraft(
            name: "Valid Name",
            settings: CustomContestSettings(maxEntries: 0)
        )
        let result = CustomContestValidation.validatePublishEligibility(draft)
        XCTAssertEqual(result, .maxEntriesInvalid)
    }

    // MARK: - Draft Creation Validation Tests

    func test_validateDraftCreation_withValidInputs_returnsEmptyArray() {
        let errors = CustomContestValidation.validateDraftCreation(
            name: "My Contest",
            maxEntries: 10
        )
        XCTAssertTrue(errors.isEmpty)
    }

    func test_validateDraftCreation_withMultipleErrors_returnsAllErrors() {
        let errors = CustomContestValidation.validateDraftCreation(
            name: "",
            maxEntries: 0
        )
        XCTAssertEqual(errors.count, 2)
        XCTAssertTrue(errors.contains(.nameRequired))
        XCTAssertTrue(errors.contains(.maxEntriesInvalid))
    }
}
