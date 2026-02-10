//
//  RulesPreviewView.swift
//  PlayoffChallenge
//
//  Preview of contest rules before joining.
//  Display only — navigates to ContestDetailView for the actual join.
//

import SwiftUI

struct RulesPreviewView: View {
    let contest: MockContest
    @State private var navigateToContest = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // Contest Header
                VStack(alignment: .leading, spacing: 8) {
                    Text(contest.name)
                        .font(.title)
                        .fontWeight(.bold)

                    HStack(spacing: 12) {
                        Label("\(contest.entryCount)/\(contest.maxEntries) entries", systemImage: "person.2")
                        Label("Created by \(contest.creatorName)", systemImage: "person")
                    }
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                }
                .padding(.horizontal)

                Divider()

                // Rules Section
                VStack(alignment: .leading, spacing: 16) {
                    RulesSectionView(
                        title: "Overview",
                        content: "Pick NFL players each week of the playoffs. Earn points based on their real-game performance."
                    )

                    RulesSectionView(
                        title: "How It Works",
                        content: "Select your lineup before each playoff round. Points are calculated after games are final."
                    )

                    RulesSectionView(
                        title: "Player Selection",
                        content: "Choose 1 QB, 2 RB, 2 WR, 1 TE, 1 K, and 1 DEF for each week."
                    )

                    RulesSectionView(
                        title: "Multipliers",
                        content: "Use the same player in consecutive weeks to earn bonus multipliers on their points."
                    )
                }
                .padding(.horizontal)

                Spacer(minLength: 100)
            }
            .padding(.top)
        }
        .navigationTitle("Contest Rules")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            VStack {
                Button {
                    navigateToContest = true
                } label: {
                    Text("Join Contest")
                        .font(.headline)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue)
                        .cornerRadius(12)
                }
                .padding(.horizontal)
                .padding(.bottom, 8)
            }
            .background(Color(.systemBackground).shadow(radius: 2))
        }
        .navigationDestination(isPresented: $navigateToContest) {
            ContestDetailView(contest: contest)
        }
    }
}

// MARK: - Rules Section

struct RulesSectionView: View {
    let title: String
    let content: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
                .foregroundColor(.blue)

            Text(content)
                .font(.body)
                .foregroundColor(.primary)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

#Preview {
    NavigationStack {
        RulesPreviewView(contest: MockContest.samples[0])
    }
}
