//
//  FeaturedContestHeroView.swift
//  PlayoffChallenge
//
//  A prominent hero banner for highlighting featured contests.
//  Phase 3 implementation of the UI Refresh.
//

import SwiftUI
import Core

struct FeaturedContestHeroView: View {
    let contest: Contest
    let onTap: () -> Void
    
    private var feeDisplay: String {
        contest.entryFeeCents == 0 ? "Free" : "$\(contest.entryFeeCents / 100)"
    }

    private var payoutDisplay: String? {
        guard contest.entryCount > 0 else { return nil }
        let totalCents = contest.entryFeeCents * contest.entryCount
        let totalDollars = totalCents / 100
        return totalDollars > 0 ? "$\(totalDollars) pot" : nil
    }

    private var ctaText: String {
        if contest.actions?.isLive == true {
            return "Watch Live"
        } else if contest.actions?.canEditEntry == true {
            return "View My Entry"
        } else if contest.actions?.canJoin == true {
            return "Join Contest"
        } else {
            return "View Contest"
        }
    }
    
    private var lockDisplay: LockTimeDisplay? {
        formatLockTimeForDisplay(lockTime: contest.lockTime, status: contest.status)
    }

    private var shareButton: some View {
        ShareLink(item: contest.shareURL) {
            Image(systemName: "square.and.arrow.up")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(.white)
                .padding(DesignTokens.Spacing.sm)
                .background(Color.white.opacity(0.2))
                .clipShape(Circle())
        }
    }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
                // Featured Badge
                HStack {
                    HStack(spacing: 4) {
                        Circle()
                            .fill(Color.white)
                            .frame(width: 6, height: 6)
                        Text("FEATURED")
                            .font(.caption2.bold())
                    }
                    .padding(.horizontal, DesignTokens.Spacing.sm)
                    .padding(.vertical, DesignTokens.Spacing.xxs)
                    .background(Color.white.opacity(0.2))
                    .foregroundColor(.white)
                    .cornerRadius(DesignTokens.Radius.sm)

                    Spacer()

                    shareButton
                }
                
                // Contest Name
                Text(contest.contestName)
                    .font(.title2.bold())
                    .foregroundColor(.white)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                
                // Fee and Capacity Text
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.xxs) {
                    HStack(spacing: DesignTokens.Spacing.sm) {
                        Text(feeDisplay)
                        Text("•")
                        if let maxEntries = contest.maxEntries {
                            Text("\(contest.entryCount)/\(maxEntries) spots")
                        } else {
                            Text("\(contest.entryCount) entered")
                        }
                    }
                    .font(.subheadline.bold())
                    .foregroundColor(.white.opacity(0.9))

                    if let payout = payoutDisplay {
                        Text(payout)
                            .font(.subheadline.bold())
                            .foregroundColor(.orange)
                    }
                }
                
                // Capacity Bar
                VStack(alignment: .trailing, spacing: DesignTokens.Spacing.xxs) {
                    CapacityBarView(entryCount: contest.entryCount, maxEntries: contest.maxEntries)
                    
                    if let maxEntries = contest.maxEntries, maxEntries > 0 {
                        let percent = Int(Double(contest.entryCount) / Double(maxEntries) * 100)
                        Text("\(percent)% full")
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.8))
                    }
                }
                
                // Lock Time
                if let display = lockDisplay {
                    Text(display.text)
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.9))
                }
                
                // CTA Button
                Text(ctaText)
                    .font(.headline)
                    .foregroundColor(DesignTokens.Color.Brand.primary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, DesignTokens.Spacing.md)
                    .background(Color.white)
                    .cornerRadius(DesignTokens.Radius.md)
                    .padding(.top, DesignTokens.Spacing.sm)
            }
            .padding(DesignTokens.Spacing.xxl)
            .background(
                LinearGradient(
                    gradient: Gradient(colors: [DesignTokens.Color.Brand.primary, DesignTokens.Color.Brand.secondary]),
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .cornerRadius(DesignTokens.Radius.lg)
            .shadow(
                color: DesignTokens.Shadow.elevatedColor,
                radius: DesignTokens.Shadow.elevatedRadius,
                x: 0,
                y: DesignTokens.Shadow.elevatedY
            )
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// MARK: - Previews

#Preview("Featured Hero") {
    ScrollView {
        VStack(spacing: DesignTokens.Spacing.xl) {
            FeaturedContestHeroView(
                contest: MockContest.fixture(
                    name: "NFL Playoffs 2026",
                    status: .scheduled,
                    isPlatformOwned: true
                ),
                onTap: {}
            )

            FeaturedContestHeroView(
                contest: MockContest.fixture(
                    name: "Super Bowl LXI Challenge",
                    status: .live,
                    isPlatformOwned: true
                ),
                onTap: {}
            )
        }
        .padding()
    }
    .background(DesignTokens.Color.Brand.background)
}
