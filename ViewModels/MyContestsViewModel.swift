//
//  MyContestsViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for the My Contests screen.
//

import Combine
import Foundation

// MARK: - DTOs (Data Transfer Objects)
struct ContestListDTO: Decodable, Identifiable {
    let id: String
    let status: String
    let templateName: String
    let templateSport: String
    let templateType: String
    let createdAt: Date
    let lockTime: Date?
    let joinToken: String?
    let maxEntries: Int?
    let entriesCurrent: Int
    let contestName: String
    let userHasEntered: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case status
        case templateName = "template_name"
        case templateSport = "template_sport"
        case templateType = "template_type"
        case createdAt = "created_at"
        case lockTime = "lock_time"
        case joinToken = "join_token"
        case maxEntries = "max_entries"
        case entriesCurrent = "entry_count"
        case contestName = "contest_name"
        case userHasEntered = "user_has_entered"
    }
}

/// ViewModel for displaying contests user has joined or created.
@MainActor
final class MyContestsViewModel: ObservableObject {

    // MARK: - Dependencies
    private let apiClient: APIClient
    private let userId: String
    private var refreshTask: Task<Void, Never>?

    init(apiClient: APIClient = APIService.shared, userId: String) {
        self.apiClient = apiClient
        self.userId = userId
    }

    // MARK: - Published State
    @Published private(set) var myContests: [MockContest] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var deletingIds: Set<UUID> = []

    // MARK: - Computed Properties

    /// Contests sorted by priority: LIVE → LOCKED → SCHEDULED → COMPLETE → CANCELLED
    /// Within same status, sorted by creation date (descending, newest first).
    var sortedContests: [MockContest] {
        myContests.sorted { contest1, contest2 in
            let priority1 = priority(for: contest1.status)
            let priority2 = priority(for: contest2.status)

            // Different status: sort by priority
            if priority1 != priority2 {
                return priority1 < priority2
            }

            // Same status: sort by createdAt descending (newest first)
            let date1 = contest1.createdAt ?? Date.distantPast
            let date2 = contest2.createdAt ?? Date.distantPast
            return date1 > date2
        }
    }

    /// Determines sort priority for a contest status.
    /// Lower number = higher priority (appears first).
    private func priority(for status: ContestStatus) -> Int {
        switch status {
        case .live:
            return 0
        case .locked:
            return 1
        case .scheduled:
            return 2
        case .complete:
            return 3
        case .cancelled:
            return 4
        case .error, .unknown:
            return 5
        }
    }

    // MARK: - Actions

    func loadMyContests() async {
        isLoading = true
        errorMessage = nil

        do {
            // Fetch both endpoints in parallel
            async let createdContests = fetchCreatedContests()
            async let joinedContests = fetchJoinedContests()

            let created = try await createdContests
            let joined = try await joinedContests

            // Merge and deduplicate by ID
            var contestMap: [String: MockContest] = [:]

            for contest in created {
                contestMap[contest.id.uuidString] = contest
            }

            for contest in joined {
                if contestMap[contest.id.uuidString] == nil {
                    contestMap[contest.id.uuidString] = contest
                }
            }

            // Single atomic assignment
            myContests = Array(contestMap.values).sorted { $0.id.uuidString > $1.id.uuidString }
        } catch {
            errorMessage = "Failed to load contests: \(error.localizedDescription)"
        }

        isLoading = false
    }

    private func fetchCreatedContests() async throws -> [MockContest] {
        let response: [ContestListDTO] = try await apiClient.get(
            path: "/api/custom-contests",
            headers: ["X-User-Id": userId]
        )

        return response.map { dto in
            MockContest(
                id: UUID(uuidString: dto.id) ?? UUID(),
                name: dto.contestName,
                entryCount: dto.entriesCurrent,
                maxEntries: dto.maxEntries ?? 0,
                status: ContestStatus(rawValue: dto.status) ?? .scheduled,
                creatorName: "Unknown",
                entryFee: 0.0,
                joinToken: dto.joinToken,
                joinURL: nil,
                isJoined: false,
                lockTime: dto.lockTime,
                startTime: nil,
                endTime: nil,
                createdAt: dto.createdAt
            )
        }
    }

    private func fetchJoinedContests() async throws -> [MockContest] {
        let response: [ContestListDTO] = try await apiClient.get(
            path: "/api/custom-contests/available",
            headers: ["X-User-Id": userId]
        )

        return response
            .filter { $0.userHasEntered }
            .map { dto in
                MockContest(
                    id: UUID(uuidString: dto.id) ?? UUID(),
                    name: dto.contestName,
                    entryCount: dto.entriesCurrent,
                    maxEntries: dto.maxEntries ?? 0,
                    status: ContestStatus(rawValue: dto.status) ?? .scheduled,
                    creatorName: "Unknown",
                    entryFee: 0.0,
                    joinToken: dto.joinToken,
                    joinURL: nil,
                    isJoined: true,
                    lockTime: dto.lockTime,
                    startTime: nil,
                    endTime: nil,
                    createdAt: dto.createdAt
                )
            }
    }

    /// Get a contest by ID
    func getContest(by id: UUID) -> MockContest? {
        myContests.first { $0.id == id }
    }

    // MARK: - Mutation Actions

    /// Delete a contest (organizer-only, idempotent)
    /// Removes contest from list on success or 404 (idempotent)
    func deleteContest(_ id: UUID) async {
        // Guard against double-tap
        guard !deletingIds.contains(id) else { return }

        // Cancel any in-flight refresh before mutation
        refreshTask?.cancel()

        deletingIds.insert(id)
        errorMessage = nil

        do {
            _ = try await APIService.shared.deleteContest(id: id)
            // Success — remove from list
            myContests.removeAll { $0.id == id }
        } catch APIError.notFound {
            // 404 — idempotent removal (already deleted or never existed)
            myContests.removeAll { $0.id == id }
        } catch APIError.restrictedState(let reason) {
            // 403 — permission or lifecycle error, don't remove
            errorMessage = reason
        } catch {
            // Other errors
            errorMessage = error.localizedDescription
        }

        deletingIds.remove(id)
    }

    /// Unjoin a contest (participant, idempotent)
    /// Removes contest from list on success or 404 (idempotent)
    func unjoinContest(_ id: UUID) async {
        // Guard against double-tap
        guard !deletingIds.contains(id) else { return }

        // Cancel any in-flight refresh before mutation
        refreshTask?.cancel()

        deletingIds.insert(id)
        errorMessage = nil

        do {
            _ = try await APIService.shared.unjoinContest(id: id)
            // Success — remove from list
            myContests.removeAll { $0.id == id }
        } catch APIError.notFound {
            // 404 — idempotent removal (already unjoined or contest gone)
            myContests.removeAll { $0.id == id }
        } catch APIError.restrictedState(let reason) {
            // 403 — permission or lifecycle error, don't remove
            errorMessage = reason
        } catch {
            // Other errors
            errorMessage = error.localizedDescription
        }

        deletingIds.remove(id)
    }
}
