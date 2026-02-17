//
//  AvailableContestsView.swift
//  PlayoffChallenge
//
//  List of available contests that users can join.
//

import SwiftUI

struct AvailableContestsView: View {
    @EnvironmentObject var authService: AuthService
    @StateObject private var viewModel = AvailableContestsViewModel()
    @State private var selectedContest: MockContest?

    var body: some View {
        List {
            Section {
                if let errorMessage = viewModel.errorMessage {
                    ScrollView {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundColor(.red)
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                } else if viewModel.contests.isEmpty {
                    Text("No contests available")
                        .foregroundColor(.secondary)
                        .onAppear {
                            print("[AvailableContestsView] No contests to display. Loading: \(viewModel.isLoading), Error: \(viewModel.errorMessage ?? "none")")
                        }
                } else {
                    ForEach(viewModel.contests) { contest in
                        ContestRowView(contest: contest)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                selectedContest = contest
                            }
                    }
                }
            } header: {
                Text("Open Contests")
            } footer: {
                Text("Tap a contest to view rules and join")
                    .font(.caption)
            }
        }
        .navigationTitle("Available Contests")
        .navigationBarTitleDisplayMode(.large)
        .navigationDestination(item: $selectedContest) { contest in
            RulesPreviewView(contest: contest)
        }
        .refreshable {
            await viewModel.refresh()
        }
        .task(id: authService.isAuthenticated) {
            if authService.isAuthenticated {
                await viewModel.loadContests()
            }
        }
    }
}

// MARK: - Contest Row

struct ContestRowView: View {
    let contest: MockContest

    var body: some View {
        HStack(spacing: 12) {
            // Contest Icon
            Image(systemName: contest.isJoined ? "checkmark.circle.fill" : "trophy.fill")
                .font(.title2)
                .foregroundColor(contest.isJoined ? .green : .orange)
                .frame(width: 44, height: 44)
                .background((contest.isJoined ? Color.green : Color.orange).opacity(0.15))
                .cornerRadius(10)

            // Contest Info
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(contest.name)
                        .font(.headline)

                    if contest.isJoined {
                        Text("Joined")
                            .font(.caption2)
                            .fontWeight(.semibold)
                            .foregroundColor(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.green)
                            .cornerRadius(4)
                    }
                }

                HStack(spacing: 8) {
                    Label("\(contest.entryCount)/\(contest.maxEntries)", systemImage: "person.2")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text(contest.displayStatus)
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(.green)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.green.opacity(0.15))
                        .cornerRadius(4)
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 8)
    }
}

#Preview {
    NavigationStack {
        AvailableContestsView()
    }
}
