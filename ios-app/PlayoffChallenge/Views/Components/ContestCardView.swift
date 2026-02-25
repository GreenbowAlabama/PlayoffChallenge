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
        guard contest.entryCount > 0 else { return nil }
        let totalCents = contest.entryFeeCents * contest.entryCount
        let totalDollars = totalCents / 100
        return totalDollars > 0 ? "$\(totalDollars) pot" : nil
    }
    
    private var showJoinedBadge: Bool {
        contest.actions?.canEditEntry == true || contest.actions?.canUnjoin == true
    }
    
    private var lockDisplay: LockTimeDisplay? {
        formatLockTimeForDisplay(lockTime: contest.lockTime, status: contest.status)
    }
    
    private var lockUrgencyColor: Color {
        guard let display = lockDisplay else { return DesignTokens.Color.Text.secondary }
        switch display.urgency {
        case .normal: return DesignTokens.Color.Text.secondary
        case .warning: return .orange
        case .critical: return .red
        }
    }

    private var shareButton: some View {
        ShareLink(item: contest.shareURL) {
            Image(systemName: "square.and.arrow.up")
                .font(.system(size: 14))
                .foregroundColor(DesignTokens.Color.Brand.primary)
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
            
            if let display = lockDisplay {
                Text(display.text)
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
                
                if let display = lockDisplay {
                    Text(display.text)
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
