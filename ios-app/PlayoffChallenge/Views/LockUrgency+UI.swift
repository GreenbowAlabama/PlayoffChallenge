//
//  LockUrgency+UI.swift
//  PlayoffChallenge
//
//  UI presentation for lock urgency levels.
//

import SwiftUI

extension LockUrgency {
    var color: Color {
        switch self {
        case .normal:
            return .secondary
        case .warning:
            return .orange
        case .critical:
            return .red
        }
    }
}
