//
//  StatusBadgeView.swift
//  PlayoffChallenge
//
//  A colored pill for contest status display.
//

import SwiftUI
import Core

struct StatusBadgeView: View {
    let status: ContestStatus
    
    var body: some View {
        Text(status.displayName)
            .font(.caption2.bold())
            .padding(.horizontal, DesignTokens.Spacing.sm)
            .padding(.vertical, DesignTokens.Spacing.xxs)
            .background(DesignTokens.Color.Status.forContestStatus(status))
            .foregroundColor(.white)
            .cornerRadius(DesignTokens.Radius.sm)
    }
}

#Preview {
    VStack(spacing: DesignTokens.Spacing.xl) {
        StatusBadgeView(status: .scheduled)
        StatusBadgeView(status: .live)
        StatusBadgeView(status: .locked)
        StatusBadgeView(status: .complete)
        StatusBadgeView(status: .cancelled)
    }
    .padding()
}
