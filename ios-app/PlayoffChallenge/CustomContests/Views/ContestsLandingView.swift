//
//  ContestsLandingView.swift
//  PlayoffChallenge
//
//  Landing page for contest-related actions.
//

import SwiftUI

struct ContestsLandingView: View {
    @EnvironmentObject var deepLinkCoordinator: DeepLinkCoordinator
    @ObservedObject var viewModel: ContestsLandingViewModel

    @State private var showCreateContest = false
    @State private var showJoinByLink = false

    var body: some View {
        NavigationView {
            List {
                Section {
                    // Create Custom Contest
                    Button {
                        viewModel.selectCreateCustomContest()
                    } label: {
                        Label("Create Custom Contest", systemImage: "plus.circle")
                    }

                    // Join Contest by Link
                    Button {
                        viewModel.selectJoinByLink()
                    } label: {
                        Label("Join Contest by Link", systemImage: "link")
                    }

                    // Resume Pending Join (conditional)
                    if viewModel.showResumePendingJoin {
                        Button {
                            viewModel.selectResumePendingJoin()
                        } label: {
                            Label("Resume Pending Join", systemImage: "arrow.clockwise")
                        }
                    }
                }
            }
            .navigationTitle("Contests")
            .onChange(of: viewModel.navigationIntent) { _, intent in
                handleNavigationIntent(intent)
            }
            .sheet(isPresented: $showCreateContest) {
                if let userIdString = UserDefaults.standard.string(forKey: "userId"),
                   let userId = UUID(uuidString: userIdString) {
                    let service = CustomContestService()
                    CreateCustomContestView(
                        viewModel: CreateCustomContestViewModel(
                            creator: service,
                            publisher: service,
                            userId: userId
                        )
                    )
                }
            }
            .alert("Join Contest", isPresented: $showJoinByLink) {
                Button("OK", role: .cancel) { }
            } message: {
                Text("To join a contest, open the invite link you received.")
            }
        }
    }

    private func handleNavigationIntent(_ intent: ContestsLandingNavigation?) {
        guard let intent = intent else { return }

        switch intent {
        case .createCustomContest:
            showCreateContest = true

        case .joinByLink:
            showJoinByLink = true

        case .resumePendingJoin:
            Task {
                await deepLinkCoordinator.resumePendingJoinIfNeeded()
            }
        }

        viewModel.clearNavigationIntent()
    }
}

#Preview {
    ContestsLandingView(
        viewModel: ContestsLandingViewModel(
            pendingJoinChecker: PendingJoinManager()
        )
    )
    .environmentObject(DeepLinkCoordinator(
        joinLinkResolver: JoinLinkService(),
        pendingJoinStore: PendingJoinManager()
    ))
}
