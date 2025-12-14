//
//  APIService.swift
//  PlayoffChallenge
//
//  Complete working version with Leaderboard Quick View support
//

import Foundation

// MARK: - API Error
enum APIError: Error {
    case invalidURL
    case invalidResponse
    case serverError(String)
    case decodingError
    case unauthorized
    case notFound
    case restrictedState(String)
    case needsEligibility

    var localizedDescription: String {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .serverError(let message):
            return message
        case .decodingError:
            return "Failed to decode response"
        case .unauthorized:
            return "Unauthorized access"
        case .notFound:
            return "Resource not found"
        case .restrictedState(let message):
            return message
        case .needsEligibility:
            return "Eligibility confirmation required"
        }
    }
}

// MARK: - API Service
class APIService {
    static let shared = APIService()
    
    private let baseURL: String
    
    private init() {
        self.baseURL = "https://playoffchallenge-production.up.railway.app"
        print("APIService: Using baseURL: \(self.baseURL)")
    }
    
    // MARK: - Auth/User Methods
    
    func getOrCreateUser(
        appleId: String,
        email: String?,
        name: String?,
        state: String? = nil,
        eligibilityCertified: Bool = false,
        tosVersion: String = "2025-12-12"
    ) async throws -> User {
        let url = URL(string: "\(baseURL)/api/users")!

        print("APIService: POST \(url.absoluteString)")
        print("APIService: Body - apple_id: \(appleId), state: \(state ?? "nil")")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = ["apple_id": appleId]

        if let email = email, !email.isEmpty {
            body["email"] = email
        }

        if let name = name, !name.isEmpty {
            body["name"] = name
        }

        // Add compliance fields for new users
        if let state = state {
            body["state"] = state
            body["eligibility_certified"] = eligibilityCertified
            body["tos_version"] = tosVersion
        }

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            print("APIService ERROR: No HTTP response")
            throw APIError.invalidResponse
        }

        print("APIService: Response status: \(httpResponse.statusCode)")

        // Handle restricted state blocking (403 Forbidden)
        if httpResponse.statusCode == 403 {
            struct ErrorResponse: Codable {
                let error: String
            }
            if let errorResponse = try? JSONDecoder().decode(ErrorResponse.self, from: data) {
                throw APIError.restrictedState(errorResponse.error)
            }
            throw APIError.serverError("Forbidden")
        }

        // Handle new user needing eligibility (400 Bad Request)
        if httpResponse.statusCode == 400 {
            struct ErrorResponse: Codable {
                let error: String
            }
            if let errorResponse = try? JSONDecoder().decode(ErrorResponse.self, from: data),
               errorResponse.error.contains("State and eligibility certification are required") {
                throw APIError.needsEligibility
            }
        }

        guard httpResponse.statusCode == 200 else {
            if let errorString = String(data: data, encoding: .utf8) {
                print("APIService ERROR: \(errorString)")
            }
            throw APIError.serverError("Server returned \(httpResponse.statusCode)")
        }

        do {
            let user = try JSONDecoder().decode(User.self, from: data)
            print("APIService: Decoded user: \(user.id)")
            return user
        } catch {
            print("APIService ERROR: Decode failed: \(error)")
            throw APIError.decodingError
        }
    }

    // MARK: - Email/Password Authentication (TestFlight Only)

    #if DEBUG
    func registerWithEmail(
        email: String,
        password: String,
        name: String?,
        state: String,
        eligibilityCertified: Bool,
        tosVersion: String = "2025-12-12"
    ) async throws -> User {
        let url = URL(string: "\(baseURL)/api/auth/register")!

        print("APIService: POST \(url.absoluteString)")
        print("APIService: Email registration for: \(email)")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [
            "email": email,
            "password": password,
            "state": state,
            "eligibility_certified": eligibilityCertified,
            "tos_version": tosVersion
        ]

        if let name = name, !name.isEmpty {
            body["name"] = name
        }

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        print("APIService: Response status: \(httpResponse.statusCode)")

        // Handle restricted state blocking (403 Forbidden)
        if httpResponse.statusCode == 403 {
            struct ErrorResponse: Codable {
                let error: String
            }
            if let errorResponse = try? JSONDecoder().decode(ErrorResponse.self, from: data) {
                throw APIError.restrictedState(errorResponse.error)
            }
            throw APIError.serverError("Forbidden")
        }

        guard httpResponse.statusCode == 200 else {
            if let errorString = String(data: data, encoding: .utf8) {
                print("APIService ERROR: \(errorString)")
            }
            throw APIError.serverError("Server returned \(httpResponse.statusCode)")
        }

        do {
            let user = try JSONDecoder().decode(User.self, from: data)
            print("APIService: Email user created: \(user.id)")
            return user
        } catch {
            print("APIService ERROR: Decode failed: \(error)")
            throw APIError.decodingError
        }
    }

    func loginWithEmail(email: String, password: String) async throws -> User {
        let url = URL(string: "\(baseURL)/api/auth/login")!

        print("APIService: POST \(url.absoluteString)")
        print("APIService: Email login for: \(email)")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "email": email,
            "password": password
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        print("APIService: Response status: \(httpResponse.statusCode)")

        guard httpResponse.statusCode == 200 else {
            if let errorString = String(data: data, encoding: .utf8) {
                print("APIService ERROR: \(errorString)")
            }
            throw APIError.serverError("Server returned \(httpResponse.statusCode)")
        }

        do {
            let user = try JSONDecoder().decode(User.self, from: data)
            print("APIService: User logged in: \(user.id)")
            return user
        } catch {
            print("APIService ERROR: Decode failed: \(error)")
            throw APIError.decodingError
        }
    }
    #endif

    func getUser(userId: UUID) async throws -> User {
        let url = URL(string: "\(baseURL)/api/users/\(userId.uuidString)")!
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        
        return try JSONDecoder().decode(User.self, from: data)
    }
    
    func getCurrentUser(userId: UUID) async throws -> User {
        // Alias for getUser - used by ProfileView
        return try await getUser(userId: userId)
    }

    func updateUserProfile(userId: UUID, username: String?, email: String?, phone: String?) async throws -> User {
        let url = URL(string: "\(baseURL)/api/users/\(userId.uuidString)")!

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [:]

        if let username = username {
            body["username"] = username
        }

        if let email = email {
            body["email"] = email
        }

        if let phone = phone {
            body["phone"] = phone
        }

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if httpResponse.statusCode == 400 {
            if let errorDict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let errorMessage = errorDict["error"] as? String {
                throw APIError.serverError(errorMessage)
            }
        }

        guard httpResponse.statusCode == 200 else {
            // Try to parse error message from response
            if let errorDict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let errorMessage = errorDict["error"] as? String {
                throw APIError.serverError(errorMessage)
            }
            throw APIError.serverError("Failed to update user profile (Status: \(httpResponse.statusCode))")
        }

        do {
            let user = try JSONDecoder().decode(User.self, from: data)
            print("APIService: User profile updated successfully: \(user.id)")
            return user
        } catch {
            print("APIService ERROR: Failed to decode updated user: \(error)")
            if let dataString = String(data: data, encoding: .utf8) {
                print("APIService ERROR: Response data: \(dataString)")
            }
            throw APIError.decodingError
        }
    }

    func getAllUsers() async throws -> [User] {
        let url = URL(string: "\(baseURL)/api/users")!
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        
        return try JSONDecoder().decode([User].self, from: data)
    }
    
    func getAllUsers(adminUserId: UUID) async throws -> [User] {
        let url = URL(string: "\(baseURL)/api/admin/users?adminId=\(adminUserId.uuidString)")!

        let (data, response) = try await URLSession.shared.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }

        return try JSONDecoder().decode([User].self, from: data)
    }
    
    func updateUserPayment(userId: UUID, adminUserId: UUID, hasPaid: Bool, paymentMethod: String? = nil) async throws {
        let url = URL(string: "\(baseURL)/api/admin/users/\(userId.uuidString)/payment")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        var body: [String: Any] = [
            "adminUserId": adminUserId.uuidString,
            "hasPaid": hasPaid
        ]
        
        if let method = paymentMethod {
            body["paymentMethod"] = method
        }
        
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (_, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to update payment status")
        }
    }

    // MARK: - Compliance Methods

    func getTermsOfService() async throws -> (content: String, version: String) {
        let url = URL(string: "\(baseURL)/api/terms")!
        let (data, _) = try await URLSession.shared.data(from: url)

        struct TOSResponse: Codable {
            let content: String
            let version: String
        }

        let response = try JSONDecoder().decode(TOSResponse.self, from: data)
        return (response.content, response.version)
    }

    func acceptTermsOfService(userId: UUID, tosVersion: String) async throws {
        let url = URL(string: "\(baseURL)/api/users/\(userId.uuidString)/accept-tos")!
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = ["tos_version": tosVersion]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.serverError("Failed to accept Terms of Service")
        }
    }

    // MARK: - Settings Methods
    
    func getSettings() async throws -> GameSettings {
        let url = URL(string: "\(baseURL)/api/settings")!
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        
        return try JSONDecoder().decode(GameSettings.self, from: data)
    }
    
    func updateSettings(_ settings: GameSettings, adminUserId: UUID) async throws -> GameSettings {
        let url = URL(string: "\(baseURL)/api/admin/settings")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        
        var body = try encoder.encode(settings)
        var dict = try JSONSerialization.jsonObject(with: body) as! [String: Any]
        dict["adminUserId"] = adminUserId.uuidString
        
        request.httpBody = try JSONSerialization.data(withJSONObject: dict)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to update settings")
        }
        
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(GameSettings.self, from: data)
    }
    
    func updateSettings(
        userId: UUID,
        entryAmount: Double,
        venmoHandle: String?,
        cashappHandle: String?,
        zelleHandle: String?,
        qbLimit: Int,
        rbLimit: Int,
        wrLimit: Int,
        teLimit: Int,
        kLimit: Int,
        defLimit: Int
    ) async throws -> GameSettings {
        let url = URL(string: "\(baseURL)/api/admin/settings")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "adminUserId": userId.uuidString,
            "entry_amount": entryAmount,
            "venmo_handle": venmoHandle as Any,
            "cashapp_handle": cashappHandle as Any,
            "zelle_handle": zelleHandle as Any,
            "qb_limit": qbLimit,
            "rb_limit": rbLimit,
            "wr_limit": wrLimit,
            "te_limit": teLimit,
            "k_limit": kLimit,
            "def_limit": defLimit
        ]
        
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to update settings")
        }
        
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(GameSettings.self, from: data)
    }
    
    // MARK: - Players Methods
    
    func getPlayers(position: String? = nil, limit: Int = 50, offset: Int = 0) async throws -> PlayersResponse {
        var components = URLComponents(string: "\(baseURL)/api/players")!
        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "offset", value: "\(offset)")
        ]
        
        if let position = position {
            queryItems.append(URLQueryItem(name: "position", value: position))
        }
        
        components.queryItems = queryItems
        
        let request = URLRequest(url: components.url!)
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(PlayersResponse.self, from: data)
    }

    struct PlayersResponse: Codable {
        let players: [Player]
        let total: Int
        let limit: Int
        let offset: Int
    }
    
    func syncPlayers(adminUserId: UUID) async throws -> APIResponse {
        let url = URL(string: "\(baseURL)/api/admin/sync-players")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = ["adminUserId": adminUserId.uuidString]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to sync players")
        }
        
        let apiResponse = try JSONDecoder().decode(APIResponse.self, from: data)
        return apiResponse
    }
    
    // MARK: - Picks Methods
    
    func getUserPicks(userId: UUID) async throws -> [Pick] {
        let url = URL(string: "\(baseURL)/api/picks?userId=\(userId.uuidString)")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to get picks")
        }
        
        let picks = try JSONDecoder().decode([Pick].self, from: data)
        return picks
    }
    
    func submitPick(userId: UUID, playerId: String, position: String, weekNumber: Int) async throws -> Pick {
        let url = URL(string: "\(baseURL)/api/picks")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "userId": userId.uuidString,
            "playerId": playerId,
            "position": position,
            "weekNumber": weekNumber
        ]
        
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to submit pick")
        }
        
        let pick = try JSONDecoder().decode(Pick.self, from: data)
        return pick
    }
    
    func deletePick(pickId: UUID, userId: UUID) async throws {
        let url = URL(string: "\(baseURL)/api/picks/\(pickId.uuidString)?userId=\(userId.uuidString)")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let (_, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to delete pick")
        }
    }
    
    // NEW: Get user's detailed picks for quick view
    func getUserPickDetails(userId: UUID, weekNumber: Int) async throws -> [UserPickDetail] {
        let url = URL(string: "\(baseURL)/api/users/\(userId.uuidString)/picks/\(weekNumber)")!
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        
        let decoder = JSONDecoder()
        let responseData = try decoder.decode(UserPicksResponse.self, from: data)
        return responseData.picks
    }
    
    // MARK: - Scores Methods
    
    func getScores(userId: UUID, weekNumber: Int) async throws -> [PlayerScore] {
        let url = URL(string: "\(baseURL)/api/scores?userId=\(userId.uuidString)&weekNumber=\(weekNumber)")!
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        
        return try JSONDecoder().decode([PlayerScore].self, from: data)
    }
    
    func getLeaderboard(weekNumber: Int? = nil, includePicks: Bool = false) async throws -> [LeaderboardEntry] {
        var urlString = "\(baseURL)/api/leaderboard"
        var queryParams: [String] = []

        if let week = weekNumber {
            queryParams.append("weekNumber=\(week)")
        }

        if includePicks {
            queryParams.append("includePicks=true")
        }

        if !queryParams.isEmpty {
            urlString += "?" + queryParams.joined(separator: "&")
        }

        print("DEBUG APIService: Requesting URL: \(urlString)")
        let url = URL(string: urlString)!
        let (data, response) = try await URLSession.shared.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }

        print("DEBUG APIService: Response data size: \(data.count) bytes")

        // Debug: print raw JSON
        if let jsonString = String(data: data, encoding: .utf8) {
            print("DEBUG APIService: First 500 chars of response: \(String(jsonString.prefix(500)))")
        }

        return try JSONDecoder().decode([LeaderboardEntry].self, from: data)
    }
    
    func getLiveScores(weekNumber: Int) async throws -> LiveScoresResponse {
        let url = URL(string: "\(baseURL)/api/live-scores?weekNumber=\(weekNumber)")!
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to get live scores")
        }
        
        let liveScores = try JSONDecoder().decode(LiveScoresResponse.self, from: data)
        return liveScores
    }
    
    // MARK: - Admin Methods
    
    func setActiveWeek(userId: UUID, weekNumber: Int) async throws -> [String: Any] {
        let url = URL(string: "\(baseURL)/api/admin/set-active-week")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "userId": userId.uuidString,
            "weekNumber": weekNumber
        ]
        
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to set active week")
        }
        
        let result = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return result ?? [:]
    }
    
    func updateWeekStatus(isActive: Bool) async throws {
        let url = URL(string: "\(baseURL)/api/admin/update-week-status")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = ["is_week_active": isActive]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to update week status")
        }
        
        let result = try JSONDecoder().decode(APIResponse.self, from: data)
        if result.success != true {
            throw APIError.serverError("Update week status failed")
        }
    }
    
    func updateCurrentWeek(weekNumber: Int, isActive: Bool) async throws {
        let url = URL(string: "\(baseURL)/api/admin/update-current-week")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "current_playoff_week": weekNumber,
            "is_week_active": isActive
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to update current week")
        }
        
        let result = try JSONDecoder().decode(APIResponse.self, from: data)
        if result.success != true {
            throw APIError.serverError("Update current week failed")
        }
    }
    
    // MARK: - Rules & Payouts Methods
    
    func getRules() async throws -> [RulesContent] {
        let url = URL(string: "\(baseURL)/api/rules")!
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        
        return try JSONDecoder().decode([RulesContent].self, from: data)
    }
    
    func getPayouts() async throws -> PayoutResponse {
        let url = URL(string: "\(baseURL)/api/payouts")!
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        
        return try JSONDecoder().decode(PayoutResponse.self, from: data)
    }

    func getScoringRules() async throws -> [ScoringRule] {
        let url = URL(string: "\(baseURL)/api/scoring-rules")!

        let (data, response) = try await URLSession.shared.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }

        return try JSONDecoder().decode([ScoringRule].self, from: data)
    }

    func getPositionRequirements() async throws -> [PositionRequirement] {
        let url = URL(string: "\(baseURL)/api/admin/position-requirements")!

        let (data, response) = try await URLSession.shared.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }

        return try JSONDecoder().decode([PositionRequirement].self, from: data)
    }

    // MARK: - Admin User Management Methods
    
    func syncESPNIds() async throws {
        let url = URL(string: "\(baseURL)/api/admin/sync-espn-ids")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to sync ESPN IDs")
        }
        
        let result = try JSONDecoder().decode(APIResponse.self, from: data)
        if result.success != true {
            throw APIError.serverError(result.error ?? "Sync failed")
        }
    }
    
    func updateUserPaymentStatus(userId: UUID, adminUserId: UUID, hasPaid: Bool) async throws -> User {
        let url = URL(string: "\(baseURL)/api/admin/users/\(userId.uuidString)/payment")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "adminUserId": adminUserId.uuidString,
            "hasPaid": hasPaid
        ]
        
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to update payment status")
        }
        
        return try JSONDecoder().decode(User.self, from: data)
    }
    
    func deleteUser(userId: UUID, adminUserId: UUID) async throws {
        let url = URL(string: "\(baseURL)/api/admin/users/\(userId.uuidString)")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "adminUserId": adminUserId.uuidString
        ]
        
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to delete user")
        }
        
        let result = try JSONDecoder().decode(APIResponse.self, from: data)
        if result.success != true {
            throw APIError.serverError(result.error ?? "Delete failed")
        }
    }

    // MARK: - Multiplier & Player Replacement Methods

    // Admin: Process week transition (manual)
    func processWeekTransition(userId: UUID, fromWeek: Int, toWeek: Int) async throws -> WeekTransitionResponse {
        let url = URL(string: "\(baseURL)/api/admin/process-week-transition")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "userId": userId.uuidString,
            "fromWeek": fromWeek,
            "toWeek": toWeek
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard httpResponse.statusCode == 200 else {
            if let errorString = String(data: data, encoding: .utf8) {
                print("APIService ERROR: \(errorString)")
            }
            throw APIError.serverError("Failed to process week transition")
        }

        return try JSONDecoder().decode(WeekTransitionResponse.self, from: data)
    }

    // Get eliminated players for a user
    func getEliminatedPlayers(userId: UUID, weekNumber: Int) async throws -> EliminatedPlayersResponse {
        let url = URL(string: "\(baseURL)/api/picks/eliminated/\(userId.uuidString)/\(weekNumber)")!

        let (data, response) = try await URLSession.shared.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to get eliminated players")
        }

        return try JSONDecoder().decode(EliminatedPlayersResponse.self, from: data)
    }

    // Replace an eliminated player with a new player
    func replacePlayer(userId: UUID, oldPlayerId: String, newPlayerId: String, position: String, weekNumber: Int) async throws -> PlayerReplacementResponse {
        let url = URL(string: "\(baseURL)/api/picks/replace-player")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "userId": userId.uuidString,
            "oldPlayerId": oldPlayerId,
            "newPlayerId": newPlayerId,
            "position": position,
            "weekNumber": weekNumber
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard httpResponse.statusCode == 200 else {
            if let errorString = String(data: data, encoding: .utf8),
               let errorJson = try? JSONSerialization.jsonObject(with: Data(errorString.utf8)) as? [String: Any],
               let errorMessage = errorJson["error"] as? String {
                throw APIError.serverError(errorMessage)
            }
            throw APIError.serverError("Failed to replace player")
        }

        return try JSONDecoder().decode(PlayerReplacementResponse.self, from: data)
    }
}

// MARK: - Supporting Types

struct LiveScoresResponse: Codable {
    let weekNumber: Int
    let picks: [LivePickScore]
    let lastUpdated: String?
    
    enum CodingKeys: String, CodingKey {
        case weekNumber = "week_number"
        case picks
        case lastUpdated = "last_updated"
    }
}

struct LivePickScore: Codable {
    let pickId: String
    let playerId: String
    let playerName: String
    let position: String
    let team: String?
    let basePoints: Double
    let multiplier: Double
    let finalPoints: Double
    let isLive: Bool
    let gameStatus: String?
    
    enum CodingKeys: String, CodingKey {
        case pickId = "pick_id"
        case playerId = "player_id"
        case playerName = "player_name"
        case position
        case team
        case basePoints = "base_points"
        case multiplier
        case finalPoints = "final_points"
        case isLive = "is_live"
        case gameStatus = "game_status"
    }
}

// NEW: User Pick Details for Quick View
struct UserPickDetail: Codable, Identifiable {
    let fullName: String
    let position: String
    let team: String
    let locked: Bool
    let pickId: String
    let points: Double
    let basePoints: Double
    let multiplier: Double?
    
    var id: String { pickId }
    
    enum CodingKeys: String, CodingKey {
        case fullName = "full_name"
        case position
        case team
        case locked
        case pickId = "pick_id"
        case points
        case basePoints = "base_points"
        case multiplier
    }
}

struct UserPicksResponse: Codable {
    let picks: [UserPickDetail]
}

// MARK: - Multiplier & Replacement Response Types

struct WeekTransitionResponse: Codable {
    let success: Bool
    let fromWeek: Int
    let toWeek: Int
    let activeTeams: [String]
    let advancedCount: Int
    let eliminatedCount: Int
    let eliminated: [EliminatedPlayer]
}

struct EliminatedPlayersResponse: Codable {
    let weekNumber: Int
    let previousWeek: Int
    let activeTeams: [String]
    let eliminated: [EliminatedPlayer]
}

struct EliminatedPlayer: Codable, Identifiable {
    let pickId: UUID?
    let playerId: String
    let playerName: String
    let position: String
    let team: String
    let multiplier: Double?
    let userId: UUID?

    var id: String { playerId }

    enum CodingKeys: String, CodingKey {
        case pickId = "pickId"
        case playerId = "playerId"
        case playerName = "playerName"
        case position
        case team
        case multiplier
        case userId
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        if let pickIdString = try? container.decode(String.self, forKey: .pickId) {
            pickId = UUID(uuidString: pickIdString)
        } else {
            pickId = try? container.decodeIfPresent(UUID.self, forKey: .pickId)
        }

        playerId = try container.decode(String.self, forKey: .playerId)
        playerName = try container.decode(String.self, forKey: .playerName)
        position = try container.decode(String.self, forKey: .position)
        team = try container.decode(String.self, forKey: .team)

        if let multString = try? container.decode(String.self, forKey: .multiplier) {
            multiplier = Double(multString)
        } else {
            multiplier = try? container.decodeIfPresent(Double.self, forKey: .multiplier)
        }

        if let userIdString = try? container.decode(String.self, forKey: .userId) {
            userId = UUID(uuidString: userIdString)
        } else {
            userId = try? container.decodeIfPresent(UUID.self, forKey: .userId)
        }
    }
}

struct PlayerReplacementResponse: Codable {
    let success: Bool
    let oldPlayer: PlayerInfo
    let newPlayer: PlayerInfo
    let pick: Pick
}

struct PlayerInfo: Codable {
    let id: String
    let name: String
    let team: String
}
