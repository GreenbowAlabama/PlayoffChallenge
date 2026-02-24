//
//  MockPendingJoinStore.swift
//  PlayoffChallengeTests
//
//  Mock implementation of PendingJoinStoring for testing
//

import Foundation
@testable import PlayoffChallenge

final class MockPendingJoinStore: PendingJoinStoring {
    private var storedToken: String?

    var storeCalled = false
    var retrieveCalled = false
    var clearCalled = false

    func store(token: String) {
        storeCalled = true
        storedToken = token
    }

    func retrieve() -> String? {
        retrieveCalled = true
        let token = storedToken
        storedToken = nil
        return token
    }

    func clear() {
        clearCalled = true
        storedToken = nil
    }

    var hasPendingJoin: Bool {
        storedToken != nil
    }

    func reset() {
        storedToken = nil
        storeCalled = false
        retrieveCalled = false
        clearCalled = false
    }
}
