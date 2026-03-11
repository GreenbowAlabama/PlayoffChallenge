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

    private var feeDisplay: String {
        contest.entryFeeCents == 0 ? "Free" : "$\(contest.entryFeeCents / 100)"
    }

    private var payoutDisplay: String? {
        // FINANCIAL BOUNDARY: Client does not compute pot or payout.
        // Backend settlement is authoritative via payout_table.
        return contest.status == .complete ? "Settled" : nil
    }

    private var isInviteOnly: Bool {
        guard let actions = contest.actions else { return false }
        let hasNotJoined = !(contest.actions?.canEditEntry == true || contest.actions?.canUnjoin == true)
        return !actions.canJoin && hasNotJoined
    }

    private var ctaText: String {
        if contest.actions?.isLive == true {
            return "Watch Live"
        } else if contest.actions?.canEditEntry == true {
            return "View My Entry"
        } else if contest.actions?.canJoin == true {
            let entryFee = contest.entryFeeCents / 100
            return entryFee == 0 ? "Join Free Contest" : "Enter $\(entryFee) Contest"
        } else if isInviteOnly {
            return "Invite Only"
        } else {
            return "View Contest"
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
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(DesignTokens.Spacing.sm)
                        .background(Color.white.opacity(0.2))
                        .clipShape(Circle())
                }
            }
        }
    }

    var body: some View {
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
                .font(.title3)
                .fontWeight(.bold)
                .foregroundColor(.white)
                .lineLimit(2)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Event Start Time: Priority logic (tournamentStartTime > startTime > lockTime)
            if let eventDisplay = formatContestEventStartTime(
                tournamentStartTime: contest.tournamentStartTime,
                startTime: contest.startTime,
                lockTime: contest.lockTime
            ) {
                Text(eventDisplay)
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.8))
            }

            // Fee and Payout Text (capacity displayed in CapacityBarView below)
            VStack(alignment: .leading, spacing: 2) {
                Text("$\(contest.entryFeeCents / 100) entry")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.white.opacity(0.9))

                if let payout = payoutDisplay {
                    Text(payout)
                        .font(.caption)
                        .foregroundColor(.orange)
                }
            }

            // Capacity Bar
            CapacityBarView(entryCount: contest.entryCount, maxEntries: contest.maxEntries)

            // Lock Time
            if let countdown = formatLockCountdown(contest.lockTime) {
                Text(countdown)
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
                .padding(.top, DesignTokens.Spacing.md)
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
                )
            )

            FeaturedContestHeroView(
                contest: MockContest.fixture(
                    name: "Super Bowl LXI Challenge",
                    status: .live,
                    isPlatformOwned: true
                )
            )
        }
        .padding()
    }
    .background(DesignTokens.Color.Brand.background)
}
