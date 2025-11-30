//
//  TeamLogoView.swift
//  PlayoffChallenge
//
//  Displays NFL team logos using Sleeper CDN
//

import SwiftUI

struct TeamLogoView: View {
    let teamAbbreviation: String
    let size: CGFloat

    init(teamAbbreviation: String, size: CGFloat = 24) {
        self.teamAbbreviation = teamAbbreviation
        self.size = size
    }

    private var logoUrl: String {
        // Sleeper CDN provides NFL team logos
        "https://sleepercdn.com/images/team_logos/nfl/\(teamAbbreviation.lowercased()).png"
    }

    var body: some View {
        AsyncImage(url: URL(string: logoUrl)) { phase in
            switch phase {
            case .empty:
                ProgressView()
                    .frame(width: size, height: size)
            case .success(let image):
                image
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: size, height: size)
            case .failure:
                // Fallback to text abbreviation
                Text(teamAbbreviation)
                    .font(.system(size: size * 0.4, weight: .bold))
                    .foregroundColor(.secondary)
                    .frame(width: size, height: size)
            @unknown default:
                Text(teamAbbreviation)
                    .font(.system(size: size * 0.4, weight: .bold))
                    .foregroundColor(.secondary)
                    .frame(width: size, height: size)
            }
        }
    }
}

// MARK: - Preview
struct TeamLogoView_Previews: PreviewProvider {
    static var previews: some View {
        VStack(spacing: 20) {
            HStack(spacing: 16) {
                TeamLogoView(teamAbbreviation: "BUF", size: 32)
                TeamLogoView(teamAbbreviation: "KC", size: 32)
                TeamLogoView(teamAbbreviation: "SF", size: 32)
                TeamLogoView(teamAbbreviation: "PHI", size: 32)
            }

            HStack(spacing: 16) {
                TeamLogoView(teamAbbreviation: "DAL", size: 40)
                TeamLogoView(teamAbbreviation: "GB", size: 40)
                TeamLogoView(teamAbbreviation: "NE", size: 40)
            }

            // Different sizes
            HStack(spacing: 16) {
                TeamLogoView(teamAbbreviation: "LAR", size: 20)
                TeamLogoView(teamAbbreviation: "LAC", size: 24)
                TeamLogoView(teamAbbreviation: "SEA", size: 28)
                TeamLogoView(teamAbbreviation: "DEN", size: 32)
            }
        }
        .padding()
    }
}
