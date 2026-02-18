//
//  ContestDetailView.swift
//  PlayoffChallenge
//
//  Detail view for a specific contest.
//

import SwiftUI
import UIKit

struct ContestDetailView: View {
    @StateObject private var viewModel: ContestDetailViewModel
    @EnvironmentObject var authService: AuthService
    @State private var navigateToLeaderboard = false
    @State private var navigateToLineup = false
    @State private var showRules = false
    @State private var showCopyConfirmation = false

    /// Primary initializer — contestId is the source of truth, placeholder is optional.
    init(contestId: UUID, placeholder: MockContest? = nil, contestJoiner: ContestJoining? = nil) {
        let joiner = contestJoiner ?? ContestJoinService()
        _viewModel = StateObject(wrappedValue: ContestDetailViewModel(
            contestId: contestId,
            placeholder: placeholder,
            contestJoiner: joiner
        ))
    }

    /// Convenience initializer for callers that have a full MockContest.
    /// contestId is extracted from the contest; the contest is used as placeholder only.
    init(contest: MockContest, contestJoiner: ContestJoining? = nil) {
        self.init(contestId: contest.id, placeholder: contest, contestJoiner: contestJoiner)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Contest Header Card
                VStack(spacing: 16) {
                    Image(systemName: "trophy.fill")
                        .font(.system(size: 60))
                        .foregroundColor(.orange)

                    Text(viewModel.contest.name)
                        .font(.title)
                        .fontWeight(.bold)

                    HStack(spacing: 20) {
                        StatView(value: "\(viewModel.contest.entryCount)", label: "Entries")
                        StatView(value: viewModel.contest.displayStatus, label: "Status")
                        StatView(value: "\(viewModel.contest.maxEntries)", label: "Max")
                    }
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(Color(.systemGray6))
                .cornerRadius(16)
                .padding(.horizontal)
                .redacted(reason: viewModel.contest.displayStatus == "Loading" ? .placeholder : [])

                // Entry Fee Card
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Entry Fee")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        Text(viewModel.contest.formattedEntryFee)
                            .font(.title2)
                            .fontWeight(.bold)
                            .foregroundColor(viewModel.contest.entryFee == 0 ? .green : .primary)
                    }

                    Spacer()

                    if viewModel.canSelectLineup {
                        Label("Joined", systemImage: "checkmark.circle.fill")
                            .font(.headline)
                            .foregroundColor(.green)
                    }
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(12)
                .padding(.horizontal)

                // Status Message
                if let message = viewModel.statusMessage {
                    Text(message)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }

                // Action Buttons
                VStack(spacing: 12) {
                    // Join Button (only shown if can join)
                    if viewModel.canJoinContest {
                        Button {
                            Task {
                                await viewModel.joinContest()
                            }
                        } label: {
                            HStack {
                                if viewModel.isJoining {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                } else {
                                    Image(systemName: "person.badge.plus")
                                    Text(viewModel.joinButtonTitle)
                                }
                            }
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(viewModel.canJoinContest ? Color.green : Color.gray)
                            .cornerRadius(12)
                        }
                        .disabled(!viewModel.canJoinContest || viewModel.isJoining)
                    }

                    // Leaderboard Button
                    Button {
                        navigateToLeaderboard = true
                    } label: {
                        HStack {
                            Image(systemName: "chart.bar.fill")
                            Text("View Leaderboard")
                        }
                        .font(.headline)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue)
                        .cornerRadius(12)
                    }

                    // My Lineup Button
                    Button {
                        navigateToLineup = true
                    } label: {
                        HStack {
                            Image(systemName: "person.3.fill")
                            Text("Select Lineup")
                        }
                        .font(.headline)
                        .foregroundColor(viewModel.canSelectLineup ? .blue : .gray)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(viewModel.canSelectLineup ? Color.blue.opacity(0.15) : Color(.systemGray5))
                        .cornerRadius(12)
                    }
                    .disabled(!viewModel.canSelectLineup)

                    // Rules Button
                    Button {
                        showRules = true
                    } label: {
                        HStack {
                            Image(systemName: "book.fill")
                            Text("View Rules")
                        }
                        .font(.headline)
                        .foregroundColor(.blue)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue.opacity(0.15))
                        .cornerRadius(12)
                    }
                }
                .padding(.horizontal)

                // Contest Info
                VStack(alignment: .leading, spacing: 12) {
                    Text("Contest Info")
                        .font(.headline)

                    InfoRowView(label: "Created By", value: viewModel.contest.creatorName)
                    InfoRowView(label: "Participants", value: "\(viewModel.contest.entryCount) of \(viewModel.contest.maxEntries)")
                    InfoRowView(label: "Entry Fee", value: viewModel.contest.formattedEntryFee)
                    InfoRowView(label: "Status", value: viewModel.contest.displayStatus)
                    if let lockTime = viewModel.contest.lockTime {
                        InfoRowView(label: "Contest Locks", value: viewModel.formattedLockTime(lockTime))
                    }
                    if viewModel.canSelectLineup {
                        InfoRowView(label: "Your Status", value: "Joined")
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.systemGray6))
                .cornerRadius(12)
                .padding(.horizontal)
                .redacted(reason: viewModel.contest.displayStatus == "Loading" ? .placeholder : [])

                // Share Link (contract-driven capability)
                if viewModel.contractContest?.actions.can_share_invite == true, let joinURL = viewModel.contest.joinURL {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Share Link")
                                .font(.headline)
                            Spacer()
                            if showCopyConfirmation {
                                Label("Copied!", systemImage: "checkmark.circle.fill")
                                    .font(.caption)
                                    .foregroundColor(.green)
                            }
                        }

                        Text("Share this link to invite others to join your contest:")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        HStack {
                            Text(joinURL.absoluteString)
                                .font(.caption)
                                .foregroundColor(.blue)
                                .lineLimit(1)
                                .truncationMode(.middle)

                            Spacer()

                            Button {
                                UIPasteboard.general.string = joinURL.absoluteString
                                showCopyConfirmation = true
                                // Reset after 2 seconds
                                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                    showCopyConfirmation = false
                                }
                            } label: {
                                Label("Copy", systemImage: "doc.on.doc")
                                    .font(.caption)
                            }
                            .buttonStyle(.bordered)
                        }

                        // Share button
                        Button {
                            let message = "Join my contest: \(viewModel.contest.name)"
                            let items: [Any] = [message, joinURL]
                            let ac = UIActivityViewController(activityItems: items, applicationActivities: nil)
                            if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                               let root = windowScene.windows.first?.rootViewController {
                                // Find the topmost presented controller
                                var presenter = root
                                while let presented = presenter.presentedViewController {
                                    presenter = presented
                                }
                                ac.popoverPresentationController?.sourceView = presenter.view
                                presenter.present(ac, animated: true)
                            }
                        } label: {
                            HStack {
                                Image(systemName: "square.and.arrow.up")
                                Text("Share Invite Link")
                            }
                            .font(.subheadline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(Color.orange)
                            .cornerRadius(8)
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
                    .padding(.horizontal)
                }

                Spacer()
            }
            .padding(.top)
        }
        .navigationTitle("Contest")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: $navigateToLeaderboard) {
            ContestLeaderboardView(contestId: viewModel.contestId)
        }
        .navigationDestination(isPresented: $navigateToLineup) {
            // Navigate to lineup view (using existing LineupView or similar)
            LineupView()
        }
        .sheet(isPresented: $showRules) {
            NavigationStack {
                RulesView()
                    .navigationTitle("Rules")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .navigationBarTrailing) {
                            Button("Done") {
                                showRules = false
                            }
                        }
                    }
            }
        }
        .alert("Error", isPresented: .constant(viewModel.errorMessage != nil)) {
            Button("OK") {
                viewModel.clearError()
            }
        } message: {
            if let error = viewModel.errorMessage {
                Text(error)
            }
        }
        .onAppear {
            viewModel.configure(currentUserId: authService.currentUser?.id)
            if !viewModel.isFetching {
                viewModel.fetchContestDetailDetached()
            }
        }
        .refreshable {
            await viewModel.refresh()
        }
    }
}

// MARK: - Stat View

struct StatView: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title2)
                .fontWeight(.bold)

            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - Info Row

struct InfoRowView: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .fontWeight(.medium)
        }
    }
}

#Preview {
    NavigationStack {
        ContestDetailView(contest: MockContest.samples[0])
            .environmentObject(AuthService())
    }
}
