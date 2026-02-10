//
//  PendingJoinManagerTests.swift
//  PlayoffChallengeTests
//
//  Unit tests for PendingJoinManager
//

import XCTest
@testable import PlayoffChallenge

final class PendingJoinManagerTests: XCTestCase {

    var sut: PendingJoinManager!
    private let testKey = "pendingJoinToken_test_\(UUID().uuidString)"

    override func setUp() {
        super.setUp()
        // Use standard UserDefaults with the default key
        sut = PendingJoinManager()
        // Clear any existing token
        sut.clear()
    }

    override func tearDown() {
        // Clear token after each test
        sut?.clear()
        sut = nil
        super.tearDown()
    }

    // MARK: - store tests

    func test_store_savesToken() {
        // Given
        let token = "test-token-123"

        // When
        sut.store(token: token)

        // Then
        XCTAssertTrue(sut.hasPendingJoin)
    }

    func test_store_overwritesPreviousToken() {
        // Given
        sut.store(token: "first-token")

        // When
        sut.store(token: "second-token")

        // Then
        let retrieved = sut.retrieve()
        XCTAssertEqual(retrieved, "second-token")
    }

    // MARK: - retrieve tests

    func test_retrieve_returnsStoredToken() {
        // Given
        let token = "test-token-456"
        sut.store(token: token)

        // When
        let retrieved = sut.retrieve()

        // Then
        XCTAssertEqual(retrieved, token)
    }

    func test_retrieve_clearsTokenAfterRetrieving() {
        // Given
        sut.store(token: "test-token")

        // When
        _ = sut.retrieve()

        // Then
        XCTAssertFalse(sut.hasPendingJoin)
        XCTAssertNil(sut.retrieve())
    }

    func test_retrieve_whenEmpty_returnsNil() {
        // When
        let retrieved = sut.retrieve()

        // Then
        XCTAssertNil(retrieved)
    }

    // MARK: - clear tests

    func test_clear_removesStoredToken() {
        // Given
        sut.store(token: "test-token")

        // When
        sut.clear()

        // Then
        XCTAssertFalse(sut.hasPendingJoin)
        XCTAssertNil(sut.retrieve())
    }

    func test_clear_whenEmpty_doesNothing() {
        // When
        sut.clear()

        // Then
        XCTAssertFalse(sut.hasPendingJoin)
    }

    // MARK: - hasPendingJoin tests

    func test_hasPendingJoin_whenStored_returnsTrue() {
        // Given
        sut.store(token: "test-token")

        // Then
        XCTAssertTrue(sut.hasPendingJoin)
    }

    func test_hasPendingJoin_whenEmpty_returnsFalse() {
        // Then
        XCTAssertFalse(sut.hasPendingJoin)
    }

    func test_hasPendingJoin_afterClear_returnsFalse() {
        // Given
        sut.store(token: "test-token")

        // When
        sut.clear()

        // Then
        XCTAssertFalse(sut.hasPendingJoin)
    }
}
