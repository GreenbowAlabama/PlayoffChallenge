//
//  CreateContestFlowView.swift
//  PlayoffChallenge
//
//  Wrapper for the create contest flow that navigates to management after creation.
//

import SwiftUI
import UIKit

struct CreateContestFlowView: View {
    @EnvironmentObject var authService: AuthService
    @Environment(\.dismiss) private var dismiss
    @State private var createdContest: MockContest?
    @State private var showContestDetail = false

    var body: some View {
        VStack {
            if let userId = authService.currentUser?.id {
                CreateContestFormView(
                    userId: userId,
                    creatorUsername: authService.currentUser?.username ?? "Unknown",
                    onContestCreated: { contest in
                        createdContest = contest
                        showContestDetail = true
                    }
                )
            } else {
                // Fallback UI if no user
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 60))
                        .foregroundColor(.orange)

                    Text("Please sign in to create a contest")
                        .font(.headline)

                    Button("Go Back") {
                        dismiss()
                    }
                }
            }
        }
        .navigationTitle("Create Contest")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: $showContestDetail) {
            if let contest = createdContest {
                ContestDetailView(contest: contest)
            }
        }
    }
}

// MARK: - Create Contest Form

struct CreateContestFormView: View {
    let userId: UUID
    let creatorUsername: String
    let onContestCreated: (MockContest) -> Void

    @State private var contestName = ""
    @State private var maxEntries = 20
    @State private var entryFee: Double = 0.0
    @State private var lockTimeEnabled = false
    @State private var lockTimeDate = Date().addingTimeInterval(3600)
    @State private var isCreating = false
    @State private var errorMessage: String?

    private let entryFeeOptions: [Double] = [0, 5, 10, 20, 25, 50, 100]

    var body: some View {
        Form {
            Section("Contest Details") {
                TextField("Contest Name", text: $contestName)
                    .autocorrectionDisabled()

                Stepper(
                    "Max Entries: \(maxEntries)",
                    value: $maxEntries,
                    in: 2...1000
                )

                Picker("Entry Fee", selection: $entryFee) {
                    ForEach(entryFeeOptions, id: \.self) { fee in
                        Text(fee == 0 ? "Free" : String(format: "$%.0f", fee))
                            .tag(fee)
                    }
                }
            }

            Section {
                Toggle("Contest locks", isOn: $lockTimeEnabled)

                if lockTimeEnabled {
                    DatePicker(
                        "Date & Time",
                        selection: $lockTimeDate,
                        in: Date()...,
                        displayedComponents: [.date, .hourAndMinute]
                    )
                }
            } footer: {
                Text("Optional. After this time, the contest locks and new entries are not accepted.")
            }

            Section {
                if isCreating {
                    HStack {
                        Spacer()
                        ProgressView()
                        Text("Creating...")
                            .padding(.leading, 8)
                        Spacer()
                    }
                } else {
                    Button {
                        createContest()
                    } label: {
                        HStack {
                            Spacer()
                            Text("Create Contest")
                            Spacer()
                        }
                    }
                    .disabled(contestName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .foregroundColor(.red)
                }
            }
        }
    }

    private func createContest() {
        isCreating = true
        errorMessage = nil

        Task {
            do {
                let service = CustomContestService()
                let selectedLockTime: Date? = lockTimeEnabled ? lockTimeDate : nil
                let input = ContestCreationInput(
                    name: contestName,
                    entryFeeCents: Int(entryFee * 100),
                    maxEntries: maxEntries,
                    lockTime: selectedLockTime
                )

                let result = try await service.createAndPublish(input: input, userId: userId)

                let contest = MockContest(
                    id: result.id,
                    name: result.name,
                    entryCount: 1,
                    maxEntries: maxEntries,
                    status: ContestStatus(rawValue: result.status) ?? .scheduled,
                    creatorName: creatorUsername,
                    entryFee: entryFee,
                    joinToken: result.joinToken,
                    joinURL: result.joinURL,
                    isJoined: true,
                    lockTime: selectedLockTime
                )

                isCreating = false
                onContestCreated(contest)
            } catch {
                print("[CreateContest] Error: \(error)")
                isCreating = false
                errorMessage = "Failed to create contest. Please try again."
            }
        }
    }
}

#Preview {
    NavigationStack {
        CreateContestFlowView()
            .environmentObject(AuthService())
    }
}
