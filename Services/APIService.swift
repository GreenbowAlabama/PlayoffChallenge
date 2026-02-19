//
//  APIService.swift
//  PlayoffChallenge
//
//  Complete working version with Leaderboard Quick View support
//

import Foundation

enum APIError: Error, LocalizedError {
case invalidURL
case invalidResponse
case serverError(String)
case decodingError
case unauthorized
case notFound
case restrictedState(String)
case needsEligibility

    var errorDescription: String? {
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

// MARK: - APIClient Protocol
protocol APIClient {
    func get<T: Decodable>(path: String, headers: [String: String]?) async throws -> T
}

// MARK: - API Service
class APIService {
    static let shared = APIService()

    private let baseURL: String

    // Client capabilities for v2 behavior opt-in.
    // These are sent as a comma-separated list in X-Client-Capabilities header.
    // Backend enables enhanced behavior only when these tokens are present.
    private let clientCapabilities = [
        "leaderboard_meta",
        "leaderboard_gating",
        "picks_v2",
        "tos_required_flag"
    ]

    private let clientVersion = "1.40.0"

    private init() {
        self.baseURL = AppEnvironment.shared.baseURL.absoluteString
        print("APIService: Using baseURL: \(self.baseURL)")
    }

    // MARK: - Request Helpers

    /// Adds capability headers to a request. These headers signal to the backend
    /// that this client supports enhanced behavior. Legacy clients do not send these.
    private func addCapabilityHeaders(to request: inout URLRequest) {
        request.setValue(clientCapabilities.joined(separator: ","), forHTTPHeaderField: "X-Client-Capabilities")
        request.setValue(clientVersion, forHTTPHeaderField: "X-Client-Version")
    }

    /// Adds authorization header if a user is authenticated.
    private func addAuthorizationHeader(to request: inout URLRequest) {
        if let userIdString = UserDefaults.standard.string(forKey: "userId"),
           let userId = UUID(uuidString: userIdString) {
            request.setValue("Bearer \(userId.uuidString)", forHTTPHeaderField: "Authorization")
            print("APIService: Added Authorization header for userId: \(userId.uuidString)")
        } else {
            print("APIService: No authenticated user, Authorization header not added.")
        }
    }

    /// Creates a URLRequest with capability headers for v2 endpoints
    private func createV2Request(url: URL, method: String = "GET") -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addCapabilityHeaders(to: &request)
        addAuthorizationHeader(to: &request) // Add authorization here
        return request
    }

    // NEW: Generic GET method to conform to APIClient
    func get<T: Decodable>(path: String, headers: [String: String]?) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var hasCustomAuthorization = false
        if let headers = headers {
            for (key, value) in headers {
                request.setValue(value, forHTTPHeaderField: key)
                if key.lowercased() == "authorization" || key.lowercased() == "x-user-id" {
                    hasCustomAuthorization = true
                }
            }
        }
        addCapabilityHeaders(to: &request)
        // Only add default Authorization if custom auth wasn't provided
        if !hasCustomAuthorization {
            addAuthorizationHeader(to: &request)
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            print("APIService ERROR: No HTTP response for GET \(path)")
            throw APIError.invalidResponse
        }

        print("APIService: GET \(path) Response status: \(httpResponse.statusCode)")

        guard (200...299).contains(httpResponse.statusCode) else {
            if let errorString = String(data: data, encoding: .utf8) {
                print("APIService ERROR: GET \(path) Response data: \(errorString)")
            }
            throw APIError.serverError("Server returned \(httpResponse.statusCode) for GET \(path)")
        }

        // 🔎 RAW RESPONSE LOGGING (TEMPORARY DIAGNOSTIC)
        if let raw = String(data: data, encoding: .utf8) {
            print("🔎 RAW GET \(path) RESPONSE:")
            print(raw)
        } else {
            print("🔎 RAW RESPONSE COULD NOT BE STRINGIFIED")
        }

        do {
            let decoder = JSONDecoder.iso8601Decoder
            let decodedObject = try decoder.decode(T.self, from: data)
            return decodedObject
        } catch {
            print("❌ DECODE ERROR - GET \(path)")
            print("Error: \(error)")
            if let rawJSON = String(data: data, encoding: .utf8) {
                print("Raw response: \(rawJSON)")
            }
            throw APIError.decodingError
        }
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

// MARK: - Email/Password Authentication (Debug Only)

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

func updateUserProfile(userId: UUID, username: String?, email: String?, phone: String?, name: String?) async throws -> User {
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

  if let name = name {
      body["name"] = name
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

func deleteAccount(userId: UUID) async throws {
  let url = URL(string: "\(baseURL)/api/user?userId=\(userId.uuidString)")!

  var request = URLRequest(url: url)
  request.httpMethod = "DELETE"
  request.setValue("application/json", forHTTPHeaderField: "Content-Type")

  let (data, response) = try await URLSession.shared.data(for: request)

  guard let httpResponse = response as? HTTPURLResponse else {
      throw APIError.invalidResponse
  }

  if httpResponse.statusCode == 401 {
      throw APIError.unauthorized
  }

  guard httpResponse.statusCode == 200 else {
      if let errorDict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
         let errorMessage = errorDict["error"] as? String {
          throw APIError.serverError(errorMessage)
      }
      throw APIError.serverError("Failed to delete account")
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

// MARK: - User Flags (v2 capability)

/// Fetches user flags including TOS requirement status.
/// Requires capability headers. Only call from new iOS builds.
func getUserFlags(userId: UUID) async throws -> UserFlags {
    let url = URL(string: "\(baseURL)/api/me/flags?userId=\(userId.uuidString)")!
    var request = createV2Request(url: url)

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse,
          httpResponse.statusCode == 200 else {
        throw APIError.invalidResponse
    }

    return try JSONDecoder().decode(UserFlags.self, from: data)
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

  guard let httpResponse = response as? HTTPURLResponse else {
      throw APIError.invalidResponse
  }

  guard httpResponse.statusCode == 200 else {
      // Try to parse error message from response (e.g., payment required)
      if let errorDict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
         let errorMessage = errorDict["error"] as? String {
          throw APIError.serverError(errorMessage)
      }
      throw APIError.serverError("Failed to submit pick (Status: \(httpResponse.statusCode))")
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

// MARK: - Picks V2 Methods (new iOS builds only)
// These endpoints use capability headers and provide the single source of truth
// for lineup state. Legacy clients continue using the v1 endpoints above.

/// Fetches lineup state for a user and week using the v2 API.
/// This is the single source of truth for lineup rendering.
func getPicksV2(userId: UUID, weekNumber: Int) async throws -> PicksV2Response {
    let url = URL(string: "\(baseURL)/api/picks/v2?userId=\(userId.uuidString)&weekNumber=\(weekNumber)")!
    let request = createV2Request(url: url)

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse,
          httpResponse.statusCode == 200 else {
        if let httpResponse = response as? HTTPURLResponse {
            print("APIService ERROR: GET /api/picks/v2 returned \(httpResponse.statusCode)")
        }
        throw APIError.serverError("Failed to get lineup state")
    }

    return try JSONDecoder().decode(PicksV2Response.self, from: data)
}

/// Performs lineup operations (add/remove) using the v2 API.
/// Supports batched operations for atomic lineup changes.
func submitPicksV2(userId: UUID, weekNumber: Int, operations: [PickOp]) async throws -> PicksV2OperationResponse {
    let url = URL(string: "\(baseURL)/api/picks/v2")!
    var request = createV2Request(url: url, method: "POST")

    let requestBody = PicksV2Request(
        userId: userId.uuidString,
        weekNumber: weekNumber,
        ops: operations
    )

    request.httpBody = try JSONEncoder().encode(requestBody)

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse else {
        throw APIError.invalidResponse
    }

    if httpResponse.statusCode != 200 {
        // Try to parse error message
        if let errorDict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let errorMessage = errorDict["error"] as? String {
            throw APIError.serverError(errorMessage)
        }
        throw APIError.serverError("Failed to submit picks (Status: \(httpResponse.statusCode))")
    }

    return try JSONDecoder().decode(PicksV2OperationResponse.self, from: data)
}

/// Convenience method to add a single player to the lineup.
func addPickV2(userId: UUID, weekNumber: Int, playerId: String, position: String) async throws -> PicksV2OperationResponse {
    let op = PickOp(action: "add", playerId: playerId, pickId: nil, position: position)
    return try await submitPicksV2(userId: userId, weekNumber: weekNumber, operations: [op])
}

/// Convenience method to remove a pick from the lineup.
func removePickV2(userId: UUID, weekNumber: Int, pickId: UUID) async throws -> PicksV2OperationResponse {
    let op = PickOp(action: "remove", playerId: nil, pickId: pickId.uuidString, position: nil)
    return try await submitPicksV2(userId: userId, weekNumber: weekNumber, operations: [op])
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

func getLeaderboard(weekNumber: Int? = nil, round: String? = nil, includePicks: Bool = false) async throws -> [LeaderboardEntry] {
  var urlString = "\(baseURL)/api/leaderboard"
  var queryParams: [String] = []

  // Prefer round over weekNumber
  if let round = round {
      queryParams.append("round=\(round)")
  } else if let week = weekNumber {
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

/// V2 leaderboard method that includes capability headers and returns response metadata.
/// Use this in new iOS builds to receive X-Leaderboard-* header info.
func getLeaderboardV2(weekNumber: Int? = nil, round: String? = nil, includePicks: Bool = false, mode: String? = nil) async throws -> (entries: [LeaderboardEntry], meta: LeaderboardMeta?) {
    var urlString = "\(baseURL)/api/leaderboard"
    var queryParams: [String] = []

    if let round = round {
        queryParams.append("round=\(round)")
    } else if let week = weekNumber {
        queryParams.append("weekNumber=\(week)")
    }

    if includePicks {
        queryParams.append("includePicks=true")
    }

    // Phase 2: Explicit mode parameter to disambiguate intent
    // - mode=cumulative: Force cumulative view (All Weeks)
    // - mode=week: Force week-specific view (explicit round selection)
    if let mode = mode {
        queryParams.append("mode=\(mode)")
    }

    if !queryParams.isEmpty {
        urlString += "?" + queryParams.joined(separator: "&")
    }

    let url = URL(string: urlString)!
    var request = createV2Request(url: url)

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse,
          httpResponse.statusCode == 200 else {
        throw APIError.invalidResponse
    }

    let entries = try JSONDecoder().decode([LeaderboardEntry].self, from: data)
    let meta = LeaderboardMeta(from: httpResponse)

    return (entries, meta)
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

// MARK: - Multiplier & Player Replacement Methods

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

  // MARK: - Custom Contest Mutations (DELETE, UNJOIN)

  /// Delete a custom contest (organizer-only)
  /// Returns the updated contest detail on success
  func deleteContest(id: UUID) async throws {
      let url = URL(string: "\(baseURL)/api/custom-contests/\(id.uuidString)")!
      let request = createV2Request(url: url, method: "DELETE")

      let (data, response) = try await URLSession.shared.data(for: request)

      guard let httpResponse = response as? HTTPURLResponse else {
          throw APIError.invalidResponse
      }

      switch httpResponse.statusCode {

      case 200...299:
          return

      case 401:
          throw APIError.unauthorized

      case 403:
          if let structured = try? JSONDecoder().decode(StructuredErrorResponse.self, from: data) {
              throw APIError.restrictedState(structured.reason)
          }
          throw APIError.restrictedState("Operation not allowed")

      case 404:
          throw APIError.notFound

      default:
          throw APIError.serverError(
              "DELETE /api/custom-contests/\(id.uuidString) failed with \(httpResponse.statusCode)"
          )
      }
  }

  /// Unjoin (leave) a custom contest (participant)
  /// Removes user participation from contest
  func unjoinContest(id: UUID) async throws {
      let url = URL(string: "\(baseURL)/api/custom-contests/\(id.uuidString)/entry")!
      let request = createV2Request(url: url, method: "DELETE")

      let (data, response) = try await URLSession.shared.data(for: request)

      guard let httpResponse = response as? HTTPURLResponse else {
          throw APIError.invalidResponse
      }

      switch httpResponse.statusCode {

      case 200...299:
          return

      case 401:
          throw APIError.unauthorized

      case 403:
          if let structured = try? JSONDecoder().decode(StructuredErrorResponse.self, from: data) {
              throw APIError.restrictedState(structured.reason)
          }
          throw APIError.restrictedState("Operation not allowed")

      case 404:
          throw APIError.notFound

      default:
          throw APIError.serverError(
              "DELETE /api/custom-contests/\(id.uuidString)/entry failed with \(httpResponse.statusCode)"
          )
      }
  }

  // MARK: - Error Response Helper

  private struct StructuredErrorResponse: Codable {
      let error_code: String
      let reason: String
  }
}

// MARK: - APIClient Conformance
extension APIService: APIClient {}

// MARK: - Supporting Types
    // Leaderboard response metadata from X-Leaderboard-* headers
// Leaderboard response metadata from X-Leaderboard-* headers
struct LeaderboardMeta {
    let gamesStarted: Bool

    init?(from response: HTTPURLResponse) {
        guard let gamesStartedValue = response.value(forHTTPHeaderField: "X-Leaderboard-Games-Started") else {
            return nil
        }
        self.gamesStarted = gamesStartedValue.lowercased() == "true"
    }
}

// User flags response from /api/me/flags
struct UserFlags: Codable {
    let requiresTos: Bool

    enum CodingKeys: String, CodingKey {
        case requiresTos = "requires_tos"
    }
}

// MARK: - Picks V2 Types (matches backend /api/picks/v2 contract)

// Response from GET /api/picks/v2
struct PicksV2Response: Codable {
    let userId: String
    let weekNumber: Int
    let picks: [PickV2Slot]
    let positionLimits: PositionLimitsV2

    // Backend uses camelCase, explicit CodingKeys for clarity
    enum CodingKeys: String, CodingKey {
        case userId
        case weekNumber
        case picks
        case positionLimits
    }
}

struct PickV2Slot: Codable, Identifiable {
    let pickId: UUID?
    let playerId: String?
    let position: String
    let fullName: String?
    let team: String?
    let sleeperId: String?
    let imageUrl: String?
    let locked: Bool
    let multiplier: Double?
    let consecutiveWeeks: Int?
    let basePoints: Double?
    let finalPoints: Double?
    let isLive: Bool?
    let gameStatus: String?
    // Matchup fields - optional, used for MatchupView display when available
    let opponent: String?
    let isHome: Bool?

    var id: String { pickId?.uuidString ?? "\(position)-\(playerId ?? "empty")" }
    var isEmpty: Bool { playerId == nil }

    enum CodingKeys: String, CodingKey {
        case pickId = "pick_id"
        case playerId = "player_id"
        case position
        case fullName = "full_name"
        case team
        case sleeperId = "sleeper_id"
        case imageUrl = "image_url"
        case locked
        case multiplier
        case consecutiveWeeks = "consecutive_weeks"
        case basePoints = "base_points"
        case finalPoints = "final_points"
        case isLive = "is_live"
        case gameStatus = "game_status"
        case opponent
        case isHome = "is_home"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pickId = try c.decodeIfPresent(UUID.self, forKey: .pickId)
        playerId = try c.decodeIfPresent(String.self, forKey: .playerId)
        position = try c.decode(String.self, forKey: .position)
        fullName = try c.decodeIfPresent(String.self, forKey: .fullName)
        team = try c.decodeIfPresent(String.self, forKey: .team)
        sleeperId = try c.decodeIfPresent(String.self, forKey: .sleeperId)
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        locked = (try? c.decode(Bool.self, forKey: .locked)) ?? false
        consecutiveWeeks = try c.decodeIfPresent(Int.self, forKey: .consecutiveWeeks)
        isLive = try c.decodeIfPresent(Bool.self, forKey: .isLive)
        gameStatus = try c.decodeIfPresent(String.self, forKey: .gameStatus)
        opponent = try c.decodeIfPresent(String.self, forKey: .opponent)
        isHome = try c.decodeIfPresent(Bool.self, forKey: .isHome)

        // Flexible number decoding for multiplier and points
        if let s = try? c.decode(String.self, forKey: .multiplier) {
            multiplier = Double(s)
        } else {
            multiplier = try c.decodeIfPresent(Double.self, forKey: .multiplier)
        }
        if let s = try? c.decode(String.self, forKey: .basePoints) {
            basePoints = Double(s)
        } else {
            basePoints = try c.decodeIfPresent(Double.self, forKey: .basePoints)
        }
        if let s = try? c.decode(String.self, forKey: .finalPoints) {
            finalPoints = Double(s)
        } else {
            finalPoints = try c.decodeIfPresent(Double.self, forKey: .finalPoints)
        }
    }
}

struct PositionLimitsV2: Codable {
    let qb: Int
    let rb: Int
    let wr: Int
    let te: Int
    let k: Int
    let def: Int

    enum CodingKeys: String, CodingKey {
        case qb = "QB"
        case rb = "RB"
        case wr = "WR"
        case te = "TE"
        case k = "K"
        case def = "DEF"
    }
}

// Request for POST /api/picks/v2
struct PicksV2Request: Encodable {
    let userId: String
    let weekNumber: Int
    let ops: [PickOp]
}

struct PickOp: Encodable {
    let action: String  // "add" or "remove"
    let playerId: String?
    let pickId: String?
    let position: String?
}

// Response from POST /api/picks/v2
struct PicksV2OperationResponse: Codable {
    let success: Bool
    let weekNumber: Int
    let operations: [PickOperationResult]
    let positionCounts: [String: Int]
}

struct PickOperationResult: Codable {
    let action: String
    let success: Bool
    let pick: PickV2Slot?
    let pickId: String?
}

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
