//
//  ContestsHubView.swift
//  PlayoffChallenge
//
//  Central hub for all contest-related views (Available and My Contests).
//

import SwiftUI

/// Local routing for the Contests Hub
enum ContestsHubRoute: Hashable {
    case create
    case detail(UUID)
}

struct ContestsHubView: View {
    @EnvironmentObject var availableVM: AvailableContestsViewModel
    @EnvironmentObject var myVM: MyContestsViewModel
    
    /// Factory closure to create the CreateCustomContestViewModel
    /// Injected from parent to avoid service instantiation in the View.
    let makeCreateViewModel: () -> CreateCustomContestViewModel
    
    @State private var selectedTab: Int = 0 // 0: Available, 1: My
    @State private var path: [ContestsHubRoute] = []
    
    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                // Segmented Control
                Picker("Contests", selection: $selectedTab) {
                    Text("Available").tag(0)
                    Text("My Contests").tag(1)
                }
                .pickerStyle(.segmented)
                .padding()
                
                // Content
                Group {
                    if selectedTab == 0 {
                        AvailableContestsView(viewModel: availableVM)
                    } else {
                        MyContestsView(viewModel: myVM)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .navigationTitle("Contests")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        path.append(.create)
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.title3)
                    }
                }
            }
            .navigationDestination(for: ContestsHubRoute.self) { route in
                switch route {
                case .create:
                    CreateCustomContestView(
                        viewModel: makeCreateViewModel(),
                        onPublished: { newId in
                            // Handle post-create routing locally
                            if !path.isEmpty {
                                path.removeLast() // Pop create
                            }
                            path.append(.detail(newId)) // Push detail
                        }
                    )
                case .detail(let id):
                    ContestDetailView(contestId: id)
                }
            }
        }
    }
}
