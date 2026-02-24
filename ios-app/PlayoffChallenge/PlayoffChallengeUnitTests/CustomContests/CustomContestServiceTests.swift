import XCTest
@testable import PlayoffChallenge

/// Tests for CustomContestService.
/// Note: These tests verify protocol conformance and validation behavior.
/// Network behavior would be tested via integration tests with a mock server.
final class CustomContestServiceTests: XCTestCase {

    // MARK: - Protocol Conformance Tests

    func test_service_conformsToCustomContestCreating() {
        let service = CustomContestService()
        XCTAssertTrue(service is CustomContestCreating)
    }

    func test_service_conformsToCustomContestPublishing() {
        let service = CustomContestService()
        XCTAssertTrue(service is CustomContestPublishing)
    }

    // MARK: - Validation Tests (createDraft validates before network call)

    func test_createDraft_withEmptyName_throwsNameRequired() async {
        let service = CustomContestService()
        let settings = CustomContestSettings(maxEntries: 10)

        do {
            _ = try await service.createDraft(
                name: "",
                settings: settings,
                userId: UUID()
            )
            XCTFail("Expected error to be thrown")
        } catch let error as CustomContestError {
            XCTAssertEqual(error, .nameRequired)
        } catch {
            XCTFail("Wrong error type: \(error)")
        }
    }

    func test_createDraft_withWhitespaceOnlyName_throwsNameRequired() async {
        let service = CustomContestService()
        let settings = CustomContestSettings(maxEntries: 10)

        do {
            _ = try await service.createDraft(
                name: "   ",
                settings: settings,
                userId: UUID()
            )
            XCTFail("Expected error to be thrown")
        } catch let error as CustomContestError {
            XCTAssertEqual(error, .nameRequired)
        } catch {
            XCTFail("Wrong error type: \(error)")
        }
    }

    func test_createDraft_withNameTooLong_throwsNameTooLong() async {
        let service = CustomContestService()
        let settings = CustomContestSettings(maxEntries: 10)
        let longName = String(repeating: "a", count: CustomContestValidation.nameMaxLength + 1)

        do {
            _ = try await service.createDraft(
                name: longName,
                settings: settings,
                userId: UUID()
            )
            XCTFail("Expected error to be thrown")
        } catch let error as CustomContestError {
            XCTAssertEqual(error, .nameTooLong(maxLength: CustomContestValidation.nameMaxLength))
        } catch {
            XCTFail("Wrong error type: \(error)")
        }
    }

    func test_createDraft_withZeroMaxEntries_throwsMaxEntriesInvalid() async {
        let service = CustomContestService()
        let settings = CustomContestSettings(maxEntries: 0)

        do {
            _ = try await service.createDraft(
                name: "Valid Name",
                settings: settings,
                userId: UUID()
            )
            XCTFail("Expected error to be thrown")
        } catch let error as CustomContestError {
            XCTAssertEqual(error, .maxEntriesInvalid)
        } catch {
            XCTFail("Wrong error type: \(error)")
        }
    }

    func test_createDraft_withMaxEntriesTooLow_throwsMaxEntriesTooLow() async {
        let service = CustomContestService()
        let settings = CustomContestSettings(maxEntries: 1) // Below minimum of 2

        do {
            _ = try await service.createDraft(
                name: "Valid Name",
                settings: settings,
                userId: UUID()
            )
            XCTFail("Expected error to be thrown")
        } catch let error as CustomContestError {
            XCTAssertEqual(error, .maxEntriesTooLow(minimum: CustomContestValidation.maxEntriesMinimum))
        } catch {
            XCTFail("Wrong error type: \(error)")
        }
    }

    func test_createDraft_withMaxEntriesTooHigh_throwsMaxEntriesTooHigh() async {
        let service = CustomContestService()
        let settings = CustomContestSettings(maxEntries: CustomContestValidation.maxEntriesMaximum + 1)

        do {
            _ = try await service.createDraft(
                name: "Valid Name",
                settings: settings,
                userId: UUID()
            )
            XCTFail("Expected error to be thrown")
        } catch let error as CustomContestError {
            XCTAssertEqual(error, .maxEntriesTooHigh(maximum: CustomContestValidation.maxEntriesMaximum))
        } catch {
            XCTFail("Wrong error type: \(error)")
        }
    }

    // MARK: - Mock Tests (using protocol mocks)

    func test_mockCreator_canBeConfiguredForSuccess() async throws {
        let mock = MockCustomContestCreator()
        let expectedDraft = CustomContestDraft(
            id: UUID(),
            name: "Test Contest",
            settings: CustomContestSettings(maxEntries: 10)
        )
        mock.configureSuccess(draft: expectedDraft)

        let result = try await mock.createDraft(
            name: "Test Contest",
            settings: CustomContestSettings(maxEntries: 10),
            userId: UUID()
        )

        XCTAssertEqual(result.name, expectedDraft.name)
        XCTAssertEqual(mock.createDraftCallCount, 1)
    }

    func test_mockCreator_canBeConfiguredForFailure() async {
        let mock = MockCustomContestCreator()
        mock.configureFailure(error: .nameRequired)

        do {
            _ = try await mock.createDraft(
                name: "Test",
                settings: CustomContestSettings(maxEntries: 10),
                userId: UUID()
            )
            XCTFail("Expected error")
        } catch let error as CustomContestError {
            XCTAssertEqual(error, .nameRequired)
        } catch {
            XCTFail("Wrong error type")
        }
    }

    func test_mockCreator_capturesInputs() async throws {
        let mock = MockCustomContestCreator()
        let draft = CustomContestDraft(
            name: "Test",
            settings: CustomContestSettings(maxEntries: 10)
        )
        mock.configureSuccess(draft: draft)

        let userId = UUID()
        let settings = CustomContestSettings(maxEntries: 25, entryFee: 10, isPrivate: false)

        _ = try await mock.createDraft(
            name: "My Contest",
            settings: settings,
            userId: userId
        )

        XCTAssertEqual(mock.lastCreateDraftName, "My Contest")
        XCTAssertEqual(mock.lastCreateDraftSettings, settings)
        XCTAssertEqual(mock.lastCreateDraftUserId, userId)
    }

    func test_mockPublisher_canBeConfiguredForSuccess() async throws {
        let mock = MockCustomContestPublisher()
        let expectedResult = PublishContestResult(
            contestId: UUID(),
            joinToken: "abc123",
            joinURL: URL(string: "https://example.com/join/abc123")!
        )
        mock.configureSuccess(result: expectedResult)

        let result = try await mock.publish(
            contestId: UUID(),
            userId: UUID()
        )

        XCTAssertEqual(result.joinToken, "abc123")
        XCTAssertEqual(mock.publishCallCount, 1)
    }

    func test_mockPublisher_canBeConfiguredForFailure() async {
        let mock = MockCustomContestPublisher()
        mock.configureFailure(error: .notInDraftState)

        do {
            _ = try await mock.publish(contestId: UUID(), userId: UUID())
            XCTFail("Expected error")
        } catch let error as CustomContestError {
            XCTAssertEqual(error, .notInDraftState)
        } catch {
            XCTFail("Wrong error type")
        }
    }
}
