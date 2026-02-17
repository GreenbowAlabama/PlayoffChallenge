//
//  AvailableContestsViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for the Available Contests list.
//

import Combine
import Foundation

/// ViewModel for the Available Contests screen.
/// Loads and manages the list of joinable contests from backend.
/// Backend is authoritative for filtering, capacity, sorting, and user_has_entered.
@MainActor
final class AvailableContestsViewModel: ObservableObject {

    // MARK: - Published State

    @Published private(set) var contests: [MockContest] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    // MARK: - Dependencies

    private let service: ContestServiceing

    // MARK: - Initialization

    init(service: ContestServiceing = CustomContestService()) {
        self.service = service
    }

    // MARK: - Actions

    func loadContests() async {
        isLoading = true
        errorMessage = nil

        do {
            let dtos = try await service.fetchAvailableContests()
            print("[AvailableContestsViewModel] Loaded \(dtos.count) DTOs from backend")

            // Map DTO directly to MockContest.
            // Backend handles filtering, capacity, sorting, and user_has_entered.
            // Client does NOT filter, sort, or modify entry counts.
            contests = dtos.map { dto in
                let fee = dto.entry_fee_cents.map { Double($0) / 100.0 } ?? 0
                let joinURL: URL? = dto.join_token.flatMap {
                    URL(string: AppEnvironment.shared.baseURL.appendingPathComponent("join/\($0)").absoluteString)
                }

                let mapped = MockContest(
                    id: dto.id,
                    name: dto.contest_name,
                    entryCount: dto.entry_count,
                    maxEntries: dto.max_entries ?? 0,
                    status: ContestStatus(rawValue: dto.status) ?? .scheduled,
                    creatorName: dto.organizer_name ?? "Unknown",
                    entryFee: fee,
                    joinToken: dto.join_token,
                    joinURL: joinURL,
                    isJoined: dto.user_has_entered,
                    lockTime: dto.lock_time,
                    startTime: dto.start_time,
                    endTime: dto.end_time
                )

                // 🟢 POINT B: Log immediately after DTO→MockContest mapping
                print("🟢 MAPPED \(dto.id.uuidString.prefix(8)): dto.organizer_name='\(dto.organizer_name ?? "nil")' => creatorName='\(mapped.creatorName)'")

                return mapped
            }

            print("[AvailableContestsViewModel] Mapped to \(contests.count) MockContest objects")
            for (index, contest) in contests.enumerated() {
                print("[AvailableContestsViewModel] Contest \(index): \(contest.name) (status: \(contest.displayStatus), joined: \(contest.isJoined))")
            }

            // 🔵 POINT C: Log after contests array is assigned
            for contest in contests {
                print("🔵 VIEWMODEL contest: \(contest.id.uuidString.prefix(8)) creator: '\(contest.creatorName)'")
            }

            errorMessage = nil
        } catch {
            print("[AvailableContestsViewModel] ERROR loading contests: \(error)")
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    func refresh() async {
        await loadContests()
    }
}
