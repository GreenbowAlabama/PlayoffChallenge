//
//  PendingJoinManager.swift
//  PlayoffChallenge
//
//  Stores pending join intent for resume after authentication.
//  Uses UserDefaults for persistence across app restarts.
//

import Foundation

/// Stores pending join intent for resume after authentication.
final class PendingJoinManager: PendingJoinStoring {
    private let userDefaults: UserDefaults
    private let key = "pendingJoinToken"

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
    }

    func store(token: String) {
        userDefaults.set(token, forKey: key)
    }

    func retrieve() -> String? {
        guard let token = userDefaults.string(forKey: key) else {
            return nil
        }
        clear()
        return token
    }

    func clear() {
        userDefaults.removeObject(forKey: key)
    }

    var hasPendingJoin: Bool {
        userDefaults.string(forKey: key) != nil
    }
}
