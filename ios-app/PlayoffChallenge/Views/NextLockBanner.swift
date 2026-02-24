//
//  NextLockBanner.swift
//  PlayoffChallenge
//
//  Banner showing the next scheduled contest with future lock time.
//  Pure presentation component—zero selection or time logic.
//

import SwiftUI

struct NextLockBanner: View {
    let contestName: String
    let lockTimeText: String
    let urgency: LockUrgency
    let isJoinable: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Image(systemName: "clock.badge.exclamationmark")
                    .font(.headline)
                    .foregroundColor(urgency.color)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Next Contest Locks")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text(lockTimeText)
                        .font(.headline)
                        .foregroundColor(urgency.color)
                        .fontWeight(.semibold)
                }

                Spacer()

                if isJoinable {
                    Label("Open", systemImage: "arrow.right")
                        .font(.caption2)
                        .foregroundColor(.green)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.green.opacity(0.15))
                        .cornerRadius(4)
                }
            }

            Text(contestName)
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundColor(.primary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(12)
        .background(Color(.systemGray6))
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(urgency.color.opacity(0.3), lineWidth: 1)
        )
    }
}

#Preview {
    VStack(spacing: 16) {
        NextLockBanner(
            contestName: "NFL Playoffs 2026",
            lockTimeText: "Locks Today • 8:50 PM",
            urgency: .normal,
            isJoinable: true
        )

        NextLockBanner(
            contestName: "Friends League",
            lockTimeText: "Locks in 2h 14m",
            urgency: .warning,
            isJoinable: false
        )

        NextLockBanner(
            contestName: "Office Pool",
            lockTimeText: "Locks in 45m",
            urgency: .critical,
            isJoinable: true
        )
    }
    .padding()
}
