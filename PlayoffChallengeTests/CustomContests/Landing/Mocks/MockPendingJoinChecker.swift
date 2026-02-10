import Foundation
@testable import PlayoffChallenge

/// Mock implementation of PendingJoinChecking for tests.
final class MockPendingJoinChecker: PendingJoinChecking {
    var hasPendingJoin: Bool = false

    func setHasPendingJoin(_ value: Bool) {
        hasPendingJoin = value
    }

    func reset() {
        hasPendingJoin = false
    }
}
