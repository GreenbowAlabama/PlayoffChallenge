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
    let id: UUID
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
        case entriesCurrent = "entries_current"
    }
}


// MARK: - Joined Contests Store

/// Shared storage for contests the user has joined (persists to UserDefaults)
/// MainActor-isolated singleton for safe access from UI code.
@MainActor
final class JoinedContestsStore {
    static let shared = JoinedContestsStore(defaults: .standard)

    /// For testing: create a store with an isolated UserDefaults suite
    static func makeForTesting() -> JoinedContestsStore {
        let testDefaults = UserDefaults(suiteName: "PlayoffChallengeTests")!
        testDefaults.removePersistentDomain(forName: "PlayoffChallengeTests")
        return JoinedContestsStore(defaults: testDefaults)
    }

    private static let storageKey = "com.playoffchallenge.joinedContests"
    private var joinedContestIds: Set<UUID> = []
    private var joinedContests: [MockContest] = []
    private let defaults: UserDefaults

    init(defaults: UserDefaults) {
        self.defaults = defaults
        loadFromStorage()
    }

    /// Mark a contest as joined
    func markJoined(_ contest: MockContest) {
        if !joinedContestIds.contains(contest.id) {
            joinedContestIds.insert(contest.id)
            // Store contest with isJoined = true
            let joinedContest = MockContest(
                id: contest.id,
                name: contest.name,
                entryCount: contest.entryCount,
                maxEntries: contest.maxEntries,
                status: contest.status,
                creatorName: contest.creatorName,
                entryFee: contest.entryFee,
                joinToken: contest.joinToken,
                isJoined: true
            )
            joinedContests.append(joinedContest)
            saveToStorage()
        }
    }

    /// Check if user has joined a specific contest
    func isJoined(contestId: UUID) -> Bool {
        return joinedContestIds.contains(contestId)
    }

    /// Get all joined contest IDs
    func getJoinedIds() -> Set<UUID> {
        return joinedContestIds
    }

    /// Get all joined contests
    func getJoinedContests() -> [MockContest] {
        return joinedContests
    }

    /// Get a joined contest by ID
    func getContest(by id: UUID) -> MockContest? {
        return joinedContests.first { $0.id == id }
    }

    /// Update a joined contest's data
    func updateContest(_ contest: MockContest) {
        if let index = joinedContests.firstIndex(where: { $0.id == contest.id }) {
            joinedContests[index] = contest
            saveToStorage()
        }
    }

    /// Clear all joined contests (for testing)
    func clear() {
        joinedContestIds.removeAll()
        joinedContests.removeAll()
        defaults.removeObject(forKey: Self.storageKey)
    }

    private func saveToStorage() {
        do {
            let data = try JSONEncoder().encode(joinedContests)
            defaults.set(data, forKey: Self.storageKey)
        } catch {
            print("Failed to save joined contests to storage: \(error)")
        }
    }

    private func loadFromStorage() {
        guard let data = defaults.data(forKey: Self.storageKey) else {
            return
        }
        do {
            let decoded = try JSONDecoder().decode([MockContest].self, from: data)
            joinedContests = decoded
            joinedContestIds = Set(decoded.map { $0.id })
        } catch {
            print("Failed to load joined contests from storage: \(error)")
            defaults.removeObject(forKey: Self.storageKey)
        }
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

    func loadMyContests() async {
        isLoading = true
        errorMessage = nil

        // After reviewing all service files, no backend endpoint for fetching a list of user's
        // created contests was found. Therefore, we return an empty array to show an empty state.
        myContests = []

        isLoading = false
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
                    id: dto.id,
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
