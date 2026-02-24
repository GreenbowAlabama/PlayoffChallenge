import XCTest
@testable import PlayoffChallenge

/// Tests for CustomContestError.
final class CustomContestErrorTests: XCTestCase {

    // MARK: - Error Description Tests

    func test_nameRequired_hasDescription() {
        let error = CustomContestError.nameRequired
        XCTAssertNotNil(error.errorDescription)
        XCTAssertFalse(error.errorDescription!.isEmpty)
    }

    func test_nameTooLong_includesMaxLength() {
        let error = CustomContestError.nameTooLong(maxLength: 50)
        XCTAssertTrue(error.errorDescription!.contains("50"))
    }

    func test_maxEntriesInvalid_hasDescription() {
        let error = CustomContestError.maxEntriesInvalid
        XCTAssertNotNil(error.errorDescription)
    }

    func test_maxEntriesTooLow_includesMinimum() {
        let error = CustomContestError.maxEntriesTooLow(minimum: 2)
        XCTAssertTrue(error.errorDescription!.contains("2"))
    }

    func test_maxEntriesTooHigh_includesMaximum() {
        let error = CustomContestError.maxEntriesTooHigh(maximum: 1000)
        XCTAssertTrue(error.errorDescription!.contains("1000"))
    }

    func test_notInDraftState_hasDescription() {
        let error = CustomContestError.notInDraftState
        XCTAssertTrue(error.errorDescription!.contains("draft"))
    }

    // MARK: - Title Tests

    func test_validationErrors_haveTitles() {
        let validationErrors: [CustomContestError] = [
            .nameRequired,
            .nameTooLong(maxLength: 50),
            .maxEntriesInvalid,
            .maxEntriesTooLow(minimum: 2),
            .maxEntriesTooHigh(maximum: 1000)
        ]

        for error in validationErrors {
            XCTAssertFalse(error.title.isEmpty, "Error \(error) should have a title")
        }
    }

    func test_stateErrors_haveTitles() {
        let stateErrors: [CustomContestError] = [
            .notInDraftState,
            .contestNotFound,
            .notAuthorized
        ]

        for error in stateErrors {
            XCTAssertFalse(error.title.isEmpty, "Error \(error) should have a title")
        }
    }

    func test_networkErrors_haveTitles() {
        let networkErrors: [CustomContestError] = [
            .networkError(underlying: "Connection failed"),
            .serverError(message: "Internal error")
        ]

        for error in networkErrors {
            XCTAssertFalse(error.title.isEmpty, "Error \(error) should have a title")
        }
    }

    // MARK: - Equatable Tests

    func test_equatable_sameCase_areEqual() {
        XCTAssertEqual(CustomContestError.nameRequired, .nameRequired)
        XCTAssertEqual(CustomContestError.notInDraftState, .notInDraftState)
        XCTAssertEqual(
            CustomContestError.nameTooLong(maxLength: 50),
            .nameTooLong(maxLength: 50)
        )
    }

    func test_equatable_differentAssociatedValues_areNotEqual() {
        XCTAssertNotEqual(
            CustomContestError.nameTooLong(maxLength: 50),
            .nameTooLong(maxLength: 100)
        )
        XCTAssertNotEqual(
            CustomContestError.maxEntriesTooLow(minimum: 2),
            .maxEntriesTooLow(minimum: 5)
        )
    }

    func test_equatable_differentCases_areNotEqual() {
        XCTAssertNotEqual(
            CustomContestError.nameRequired,
            .maxEntriesInvalid
        )
    }
}
