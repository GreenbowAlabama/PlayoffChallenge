//
//  PGALineupView.swift
//  PlayoffChallenge
//
//  PGA tournament lineup view.
//  Uses LineupViewModel for contest state and lifecycle enforcement.
//  Displays golfer lineup with configurable slot count from contest.rosterConfig.lineupSize.
//  Shows scoring hint with automatic drop-lowest behavior.
//

import SwiftUI

struct PGALineupView: View {
    let contestId: UUID
    let placeholder: Contest?
    @EnvironmentObject var authService: AuthService
    @StateObject private var viewModel: LineupViewModel

    init(contestId: UUID, placeholder: Contest? = nil) {
        self.contestId = contestId
        self.placeholder = placeholder
        _viewModel = StateObject(wrappedValue: LineupViewModel(
            contestId: contestId,
            placeholder: placeholder
        ))
    }

    // Extract PGA configuration from rosterConfig typed helpers
    private var lineupSize: Int {
        placeholder?.rosterConfig?.lineupSize ?? 7
    }

    private var scoringCount: Int {
        placeholder?.rosterConfig?.scoringCount ?? 6
    }

    private var dropLowest: Bool {
        placeholder?.rosterConfig?.dropLowest ?? true
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                if viewModel.isLocked {
                    LockedBanner()
                }

                ScrollView {
                    VStack(spacing: DesignTokens.Spacing.lg) {
                        if viewModel.isLoading {
                            ProgressView("Loading lineup...")
                                .frame(maxWidth: .infinity)
                                .padding()
                        } else {
                            // Scoring hint card
                            PGAScoringHintCard(
                                lineupSize: lineupSize,
                                scoringCount: scoringCount,
                                dropLowest: dropLowest
                            )

                            // Golfer lineup slots
                            VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
                                Text("My Golfers")
                                    .font(.headline)
                                    .foregroundColor(.primary)
                                    .padding(.horizontal)

                                VStack(spacing: DesignTokens.Spacing.md) {
                                    ForEach(0..<lineupSize, id: \.self) { slotIndex in
                                        if slotIndex < viewModel.slots.count && !viewModel.slots[slotIndex].isEmpty {
                                            PGAGolferSlotRow(
                                                slot: viewModel.slots[slotIndex],
                                                slotNumber: slotIndex + 1,
                                                viewModel: viewModel
                                            )
                                        } else {
                                            PGAEmptySlotButton(
                                                slotNumber: slotIndex + 1,
                                                viewModel: viewModel
                                            )
                                        }
                                    }
                                }
                                .padding(.horizontal)
                            }
                        }
                    }
                    .padding()
                }

                if viewModel.isSaving {
                    HStack {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        Text("Saving...")
                            .font(.headline)
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(DesignTokens.Color.Action.secondary)
                    .cornerRadius(DesignTokens.Radius.lg)
                    .padding()
                }
            }
            .navigationTitle("My Lineup")
            .task {
                if let userId = authService.currentUser?.id {
                    viewModel.configure(currentUserId: userId)
                    await viewModel.loadData(userId: userId)
                }
            }
            .refreshable {
                if let userId = authService.currentUser?.id {
                    await viewModel.loadData(userId: userId)
                }
            }
            .alert("Error", isPresented: $viewModel.showError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(viewModel.errorMessage ?? "An error occurred")
            }
            .sheet(isPresented: $viewModel.showingPlayerPicker) {
                if let position = viewModel.selectedPosition {
                    LineupPlayerPickerSheetV2(
                        position: position,
                        viewModel: viewModel
                    )
                }
            }
        }
    }
}

// MARK: - PGA Scoring Hint Card
struct PGAScoringHintCard: View {
    let lineupSize: Int
    let scoringCount: Int
    let dropLowest: Bool

    var hintText: String {
        if dropLowest {
            return "Best \(scoringCount) of \(lineupSize) scores count. Lowest score automatically dropped."
        } else {
            return "All \(lineupSize) scores count."
        }
    }

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.md) {
            HStack(spacing: DesignTokens.Spacing.md) {
                Image(systemName: "info.circle.fill")
                    .font(.title3)
                    .foregroundColor(DesignTokens.Color.Brand.primary)

                Text(hintText)
                    .font(.body)
                    .foregroundColor(.primary)
                    .lineLimit(nil)

                Spacer()
            }
        }
        .padding(DesignTokens.Spacing.lg)
        .background(DesignTokens.Color.Surface.elevated)
        .cornerRadius(DesignTokens.Radius.lg)
    }
}

// MARK: - PGA Golfer Slot Row
struct PGAGolferSlotRow: View {
    let slot: PickV2Slot
    let slotNumber: Int
    @ObservedObject var viewModel: LineupViewModel
    @State private var showingDeleteAlert = false

    var body: some View {
        HStack(spacing: DesignTokens.Spacing.md) {
            // Golfer headshot
            PlayerImageView(
                imageUrl: slot.imageUrl,
                size: 48,
                position: "G"
            )

            // Golfer info
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
                Text(slot.fullName ?? "Unknown")
                    .font(.body)
                    .fontWeight(.medium)
                    .foregroundColor(.primary)

                if let team = slot.team {
                    Text(team)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            // Delete button
            if viewModel.canEditLineup {
                Button(action: {
                    showingDeleteAlert = true
                }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.red.opacity(0.8))
                        .imageScale(.large)
                }
            }
        }
        .padding(DesignTokens.Spacing.md)
        .background(DesignTokens.Color.Surface.elevated)
        .cornerRadius(DesignTokens.Radius.lg)
        .alert("Remove Golfer?", isPresented: $showingDeleteAlert) {
            Button("Cancel", role: .cancel) { }
            Button("Remove", role: .destructive) {
                Task {
                    await viewModel.removeSlot(slot)
                }
            }
        } message: {
            Text("Are you sure you want to remove \(slot.fullName ?? "this golfer") from your lineup?")
        }
    }
}

// MARK: - PGA Empty Slot Button
struct PGAEmptySlotButton: View {
    let slotNumber: Int
    @ObservedObject var viewModel: LineupViewModel

    var body: some View {
        Button(action: {
            // Open player picker with correct position ("G" for golfer)
            viewModel.openPlayerPicker(for: "G")
        }) {
            HStack(spacing: DesignTokens.Spacing.md) {
                // Slot number placeholder
                VStack(alignment: .center) {
                    Text("\(slotNumber)")
                        .font(.headline)
                        .foregroundColor(.gray.opacity(0.5))
                }
                .frame(width: 44, alignment: .center)

                VStack(alignment: .leading, spacing: DesignTokens.Spacing.xxs) {
                    Text("Add Golfer")
                        .font(.body)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)

                    Text("Tap to select")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(DesignTokens.Spacing.md)
            .frame(maxWidth: .infinity)
            .background(DesignTokens.Color.Surface.elevated)
            .cornerRadius(DesignTokens.Radius.lg)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

#Preview {
    PGALineupView(contestId: UUID(), placeholder: Contest.stub(templateType: .pgaTournament))
        .environmentObject(AuthService())
}
