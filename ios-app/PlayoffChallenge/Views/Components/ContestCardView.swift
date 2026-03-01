//
//  ContestCardView.swift
//  PlayoffChallenge
//
//  A reusable card component for displaying contest information.
//  Phase 2 implementation of the Contest Card System.
//

import SwiftUI
import Core

enum CardStyle {
    case standard
    case compact
    case list
}

struct ContestCardView: View {
    let contest: Contest
    let style: CardStyle
    let onTap: (() -> Void)?

    private var feeDisplay: String {
        contest.entryFeeCents == 0 ? "Free" : "$\(contest.entryFeeCents / 100)"
    }

    private var payoutDisplay: String? {
        // FINANCIAL BOUNDARY: Client does not compute pot or payout.
        // Backend settlement is authoritative via payout_table.
        return contest.status == .complete ? "Settled" : nil
    }
    
    private var showJoinedBadge: Bool {
        contest.actions?.canEditEntry == true || contest.actions?.canUnjoin == true
    }
    
    private var lockUrgencyColor: Color {
        guard let lockTime = contest.lockTime else { return DesignTokens.Color.Text.secondary }
        let timeInterval = lockTime.timeIntervalSinceNow
        if timeInterval < 3600 { // Less than 1 hour
            return .red
        } else if timeInterval < 86400 { // Less than 24 hours
            return .orange
        } else {
            return DesignTokens.Color.Text.secondary
        }
    }

    private var shareURL: URL? {
        guard let token = contest.shareURLToken else { return nil }
        let shareString = "\(AppEnvironment.shared.baseURL.absoluteString)/join/\(token)"
        return URL(string: shareString)
    }

    private var shareButton: some View {
        Group {
            if let url = shareURL {
                ShareLink(item: url) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 14))
                        .foregroundColor(DesignTokens.Color.Brand.primary)
                }
            }
        }
    }
    
    var body: some View {
        Button(action: { onTap?() }) {
            Group {
                switch style {
                case .standard:
                    standardLayout
                case .compact:
                    compactLayout
                case .list:
                    listLayout
                }
            }
            .padding(DesignTokens.Spacing.md)
            .background(DesignTokens.Color.Surface.card)
            .cornerRadius(DesignTokens.Radius.md)
            .shadow(
                color: DesignTokens.Shadow.cardColor,
                radius: DesignTokens.Shadow.cardRadius,
                x: 0,
                y: DesignTokens.Shadow.cardY
            )
        }
        .buttonStyle(PlainButtonStyle())
    }
    
    // MARK: - Layouts
    
    private var standardLayout: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.xxs) {
                    Text(contest.contestName)
                        .font(.headline)
                        .foregroundColor(DesignTokens.Color.Text.primary)
                        .lineLimit(2)

                    if let organizer = contest.organizerName {
                        Text("by \(organizer)")
                            .font(.caption)
                            .foregroundColor(DesignTokens.Color.Text.secondary)
                    }
                }

                Spacer()

                HStack(spacing: DesignTokens.Spacing.sm) {
                    shareButton
                    StatusBadgeView(status: contest.status)
                }
            }
            
            Spacer(minLength: DesignTokens.Spacing.xs)
            
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(feeDisplay)
                        .font(.subheadline.bold())
                        .foregroundColor(DesignTokens.Color.Brand.primary)

                    if let payout = payoutDisplay {
                        Text(payout)
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }

                Spacer()

                if showJoinedBadge {
                    joinedBadge
                }
            }
            
            CapacityBarView(entryCount: contest.entryCount, maxEntries: contest.maxEntries)
            
            if let lockTime = contest.lockTime {
                Text(lockTime, style: .relative)
                    .font(.caption2)
                    .foregroundColor(lockUrgencyColor)
            }
        }
        .frame(minHeight: DesignTokens.Size.cardMinHeight)
    }
    
    private var compactLayout: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            HStack {
                Text(contest.contestName)
                    .font(.subheadline.bold())
                    .foregroundColor(DesignTokens.Color.Text.primary)
                    .lineLimit(1)

                Spacer()

                HStack(spacing: DesignTokens.Spacing.sm) {
                    shareButton
                    StatusBadgeView(status: contest.status)
                }
            }
            
            CapacityBarView(entryCount: contest.entryCount, maxEntries: contest.maxEntries)
        }
    }
    
    private var listLayout: some View {
        HStack(spacing: DesignTokens.Spacing.md) {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.xxs) {
                Text(contest.contestName)
                    .font(.subheadline.bold())
                    .foregroundColor(DesignTokens.Color.Text.primary)
                    .lineLimit(1)

                HStack(spacing: DesignTokens.Spacing.sm) {
                    StatusBadgeView(status: contest.status)

                    VStack(alignment: .leading, spacing: 1) {
                        Text(feeDisplay)
                            .font(.caption.bold())
                            .foregroundColor(DesignTokens.Color.Brand.primary)

                        if let payout = payoutDisplay {
                            Text(payout)
                                .font(.caption2)
                                .foregroundColor(.orange)
                        }
                    }

                    if showJoinedBadge {
                        joinedBadge
                    }
                }
            }

            Spacer()

            shareButton
            
            VStack(alignment: .trailing, spacing: DesignTokens.Spacing.xxs) {
                CapacityBarView(entryCount: contest.entryCount, maxEntries: contest.maxEntries)

                if let lockTime = contest.lockTime {
                    Text(lockTime, style: .relative)
                        .font(.caption2)
                        .foregroundColor(lockUrgencyColor)
                }
            }
        }
    }
    
    private var joinedBadge: some View {
        HStack(spacing: 4) {
            Image(systemName: "checkmark.circle.fill")
            Text("Joined")
        }
        .font(.caption2.bold())
        .foregroundColor(DesignTokens.Color.Action.primary)
    }
}

// MARK: - Previews

#Preview("Standard") {
    VStack(spacing: DesignTokens.Spacing.xl) {
        ContestCardView(contest: MockContest.samples[0], style: .standard, onTap: {})
        ContestCardView(contest: MockContest.samples[1], style: .standard, onTap: {})
        ContestCardView(contest: MockContest.samples[2], style: .standard, onTap: {})
    }
    .padding()
    .background(DesignTokens.Color.Brand.background)
}

#Preview("Compact") {
    VStack(spacing: DesignTokens.Spacing.xl) {
        ContestCardView(contest: MockContest.samples[0], style: .compact, onTap: {})
        ContestCardView(contest: MockContest.samples[1], style: .compact, onTap: {})
    }
    .padding()
    .background(DesignTokens.Color.Brand.background)
}

#Preview("List") {
    VStack(spacing: 12) {
        ContestCardView(contest: MockContest.samples[0], style: .list, onTap: {})
        ContestCardView(contest: MockContest.samples[1], style: .list, onTap: {})
        ContestCardView(contest: MockContest.samples[2], style: .list, onTap: {})
    }
    .padding()
    .background(DesignTokens.Color.Brand.background)
}
