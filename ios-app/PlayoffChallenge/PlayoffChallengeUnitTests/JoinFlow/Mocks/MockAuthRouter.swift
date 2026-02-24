//
//  MockAuthRouter.swift
//  PlayoffChallengeTests
//
//  Mock for testing auth-dependent join flows
//

import Foundation
@testable import PlayoffChallenge

final class MockAuthRouter {
    var currentUserId: UUID?
    var isAuthenticated: Bool { currentUserId != nil }
    var onAuthenticationComplete: ((UUID) -> Void)?

    func simulateAuthentication(userId: UUID) {
        currentUserId = userId
        onAuthenticationComplete?(userId)
    }

    func simulateSignOut() {
        currentUserId = nil
    }

    func reset() {
        currentUserId = nil
        onAuthenticationComplete = nil
    }
}
