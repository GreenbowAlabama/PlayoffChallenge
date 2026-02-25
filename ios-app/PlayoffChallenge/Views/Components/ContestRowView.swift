//
//  ContestRowView.swift
//  PlayoffChallenge
//
//  Reusable, stable contest row component for list rendering.
//  Pure presentation layer: takes pre-formatted strings, renders layout only.
//

import SwiftUI
import Core

struct ContestRowView: View {
    let contestName: String
    let isJoined: Bool
    let entryCountText: String        // e.g., "1/20"
    let statusText: String            // e.g., "Scheduled"
    let lockText: String?             // e.g., "Locks Feb 27 · 14:29", nil if not shown
    let entryFeeText: String?         // e.g., "$10 Entry", "Free", nil if 0
    let payoutText: String?           // e.g., "$500 pot", "$500 paid out"
    let shareURL: URL?                // Share link for contest
    let showsChevron: Bool

    init(
        contestName: String,
        isJoined: Bool,
        entryCountText: String,
        statusText: String,
        lockText: String? = nil,
        entryFeeText: String? = nil,
        payoutText: String? = nil,
        shareURL: URL? = nil,
        showsChevron: Bool = true
    ) {
        self.contestName = contestName
        self.isJoined = isJoined
        self.entryCountText = entryCountText
        self.statusText = statusText
        self.lockText = lockText
        self.entryFeeText = entryFeeText
        self.payoutText = payoutText
        self.shareURL = shareURL
        self.showsChevron = showsChevron
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Icon
            Image(systemName: isJoined ? "checkmark.circle.fill" : "trophy.fill")
                .font(.title2)
                .foregroundColor(isJoined ? DesignTokens.Color.Action.primary : DesignTokens.Color.Brand.primary)
                .frame(width: 44, height: 44)
                .background((isJoined ? DesignTokens.Color.Action.primary : DesignTokens.Color.Brand.primary).opacity(0.15))
                .cornerRadius(DesignTokens.Radius.lg)

            // Main content
            VStack(alignment: .leading, spacing: 6) {
                // Title row: name + joined badge
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(contestName)
                        .font(.headline)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .layoutPriority(2)

                    if isJoined {
                        Text("Joined")
                            .font(.caption2)
                            .fontWeight(.semibold)
                            .foregroundColor(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(DesignTokens.Color.Action.primary)
                            .cornerRadius(DesignTokens.Radius.sm)
                            .fixedSize(horizontal: true, vertical: false)
                    }

                    Spacer(minLength: 0)
                }

                // Meta row: entry count + status
                HStack(spacing: 8) {
                    Label(entryCountText, systemImage: "person.2")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text(statusText)
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(DesignTokens.Color.Action.primary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(DesignTokens.Color.Action.primary.opacity(0.15))
                        .cornerRadius(DesignTokens.Radius.sm)
                }

                // Lock time (if provided)
                if let lockText = lockText {
                    Text(lockText)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Spacer(minLength: 8)

            // Right side: fee + share + chevron
            HStack(alignment: .center, spacing: 8) {
                // Share button (if URL available)
                if let url = shareURL {
                    ShareLink(item: url) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.caption2)
                            .foregroundColor(DesignTokens.Color.Brand.primary)
                    }
                }

                VStack(alignment: .trailing, spacing: 2) {
                    if let entryFeeText = entryFeeText {
                        Text(entryFeeText)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }

                    if let payoutText = payoutText {
                        Text(payoutText)
                            .font(.caption2)
                            .foregroundColor(.orange)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }

                    if showsChevron {
                        Image(systemName: "chevron.right")
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
        .padding(.vertical, 8)
    }
}

#Preview {
    List {
        ContestRowView(
            contestName: "NFL Playoffs 2026",
            isJoined: false,
            entryCountText: "45/100",
            statusText: "Scheduled",
            entryFeeText: "$50 Entry",
            payoutText: "$2250 pot",
            shareURL: URL(string: "https://67.games/contest/123")
        )

        ContestRowView(
            contestName: "Very Long Contest Name That Should Wrap to Multiple Lines Gracefully",
            isJoined: true,
            entryCountText: "8/20",
            statusText: "Scheduled",
            lockText: "Locks Feb 27 · 14:29",
            entryFeeText: "$25 Entry",
            payoutText: "$200 pot",
            shareURL: URL(string: "https://67.games/contest/456")
        )

        ContestRowView(
            contestName: "Free Contest",
            isJoined: false,
            entryCountText: "12/50",
            statusText: "Live",
            entryFeeText: "Free",
            shareURL: URL(string: "https://67.games/contest/789")
        )
    }
}
