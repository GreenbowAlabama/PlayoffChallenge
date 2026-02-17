//
//  ContestManagementViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for the Contest Management screen.
//

import Combine
import Foundation

// MARK: - DTOs (Data Transfer Objects)
// This DTO exists in the backend, but we need its definition here.
struct OrganizerContestDTO: Decodable, Identifiable {
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
    }
}


// MARK: - Created Contests Store

/// Shared storage for created contests (persists to UserDefaults)
final class CreatedContestsStore {
    static let shared = CreatedContestsStore()
    private init() {
        loadFromStorage()
    }

    private static let storageKey = "com.playoffchallenge.createdContests"
    private var contests: [MockContest] = []
    private let lock = NSLock()

    func add(_ contest: MockContest) {
        lock.lock()
        defer { lock.unlock() }
        // Avoid duplicates
        if !contests.contains(where: { $0.id == contest.id }) {
            contests.insert(contest, at: 0)
            saveToStorage()
        }
    }

    func getAll() -> [MockContest] {
        lock.lock()
        defer { lock.unlock() }
        return contests
    }

    func update(_ contest: MockContest) {
        lock.lock()
        defer { lock.unlock() }
        if let index = contests.firstIndex(where: { $0.id == contest.id }) {
            contests[index] = contest
            saveToStorage()
        }
    }

    func clear() {
        lock.lock()
        defer { lock.unlock() }
        contests.removeAll()
        UserDefaults.standard.removeObject(forKey: Self.storageKey)
    }

    private func saveToStorage() {
        do {
            let data = try JSONEncoder().encode(contests)
            UserDefaults.standard.set(data, forKey: Self.storageKey)
        } catch {
            print("Failed to save contests to storage: \(error)")
        }
    }

    private func loadFromStorage() {
        guard let data = UserDefaults.standard.data(forKey: Self.storageKey) else {
            return
        }
        do {
            contests = try JSONDecoder().decode([MockContest].self, from: data)
        } catch {
            print("Failed to load contests from storage: \(error)")
        }
    }
}

/// ViewModel for managing user's created contests.
@MainActor
final class ContestManagementViewModel: ObservableObject {

    // MARK: - Dependencies
    private let apiClient: APIClient
    private let userId: String

    init(apiClient: APIClient = APIService.shared, userId: String) {
        self.apiClient = apiClient
        self.userId = userId
    }

    // MARK: - Published State

    @Published private(set) var myContests: [MockContest] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    // MARK: - Actions

    func loadContests() async {
        // Alias for loadOrganizerContests for consistency
        await loadOrganizerContests()
    }

    func loadOrganizerContests() async {
        isLoading = true
        errorMessage = nil

        do {
            let response: [OrganizerContestDTO] = try await apiClient.get(
                path: "/api/custom-contests",
                headers: [
                    "Authorization": "Bearer \(userId)"
                ]
            )
            // Map OrganizerContestDTO to MockContest
            myContests = response.map { dto in
                MockContest(
                    id: UUID(uuidString: dto.id) ?? UUID(),
                    name: dto.templateName,
                    entryCount: dto.entriesCurrent,
                    maxEntries: dto.maxEntries ?? 0,
                    status: dto.status,
                    creatorName: "Unknown",
                    entryFee: 0.0,
                    joinToken: dto.joinToken,
                    joinURL: nil,
                    isJoined: false,
                    lockTime: dto.lockTime
                )
            }
        } catch {
            errorMessage = "Failed to load contests: \(error.localizedDescription)"
        }

        isLoading = false
    }

    func refresh() async {
        await loadOrganizerContests() // Call the new method for refresh
    }

    /// Add a newly created contest
    func addCreatedContest(_ contest: MockContest) {
        CreatedContestsStore.shared.add(contest)
        // Immediately update local state
        if !myContests.contains(where: { $0.id == contest.id }) {
            myContests.insert(contest, at: 0)
        }
    }

    /// Get a contest by ID
    func getContest(by id: UUID) -> MockContest? {
        myContests.first { $0.id == id }
    }
}
