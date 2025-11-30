//
//  MatchupView.swift
//  PlayoffChallenge
//
//  Displays team matchup with logos (e.g., "BUF @ PIT" or "SF vs DAL")
//

import SwiftUI

struct MatchupView: View {
    let team: String
    let opponent: String?
    let isHome: Bool?
    let logoSize: CGFloat

    init(team: String, opponent: String?, isHome: Bool?, logoSize: CGFloat = 20) {
        self.team = team
        self.opponent = opponent
        self.isHome = isHome
        self.logoSize = logoSize
    }

    var body: some View {
        if let opponent = opponent, let isHome = isHome {
            HStack(spacing: 4) {
                if isHome {
                    // Home game: "SF vs DAL"
                    TeamLogoView(teamAbbreviation: team, size: logoSize)
                    Text("vs")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    TeamLogoView(teamAbbreviation: opponent, size: logoSize)
                } else {
                    // Away game: "BUF @ PIT"
                    TeamLogoView(teamAbbreviation: team, size: logoSize)
                    Text("@")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    TeamLogoView(teamAbbreviation: opponent, size: logoSize)
                }
            }
        } else {
            // Fallback if opponent data not available
            HStack(spacing: 4) {
                TeamLogoView(teamAbbreviation: team, size: logoSize)
                Text(team)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }
}

// MARK: - Preview
struct MatchupView_Previews: PreviewProvider {
    static var previews: some View {
        VStack(spacing: 20) {
            // Away game
            MatchupView(team: "BUF", opponent: "KC", isHome: false, logoSize: 24)

            // Home game
            MatchupView(team: "SF", opponent: "DAL", isHome: true, logoSize: 24)

            // No opponent data
            MatchupView(team: "PHI", opponent: nil, isHome: nil, logoSize: 24)

            // Different sizes
            VStack(spacing: 12) {
                MatchupView(team: "GB", opponent: "CHI", isHome: true, logoSize: 20)
                MatchupView(team: "LAR", opponent: "SEA", isHome: false, logoSize: 28)
                MatchupView(team: "NE", opponent: "MIA", isHome: true, logoSize: 32)
            }
        }
        .padding()
    }
}
