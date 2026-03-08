//
//  LineupContainerView.swift
//  PlayoffChallenge
//
//  Router view that selects lineup implementation based on contest template type.
//  Routes PGA_TOURNAMENT to PGALineupView, all others to NFL LineupView.
//

import SwiftUI

struct LineupContainerView: View {
    let contestId: UUID
    let placeholder: Contest?

    var body: some View {
        if let contest = placeholder,
           [.pgaTournament, .pgaBase, .pgaDaily, .golfMajor].contains(contest.templateType) {
            PGALineupView(contestId: contestId, placeholder: contest)
        } else {
            LineupView(contestId: contestId, placeholder: placeholder)
        }
    }
}

#Preview {
    LineupContainerView(contestId: UUID(), placeholder: Contest.stub(templateType: .playoffChallenge))
        .environmentObject(AuthService())
}
