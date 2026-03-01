import Foundation
import Core

// MARK: - Input Models

/// Input for contest creation - what the View provides
/// Never decodes JSON.
struct ContestCreationInput {
    let name: String
    let entryFeeCents: Int
    let maxEntries: Int
    let lockTime: Date?

    init(name: String, entryFeeCents: Int, maxEntries: Int, lockTime: Date? = nil) {
        self.name = name
        self.entryFeeCents = entryFeeCents
        self.maxEntries = maxEntries
        self.lockTime = lockTime
    }
}

/// Production service for custom contest creation and publishing.
/// Wraps APIService.shared and implements protocol contracts.
final class CustomContestService: CustomContestCreating, CustomContestPublishing {

    private let environment: AppEnvironment
    private let apiService: APIService

    init(environment: AppEnvironment = .shared, apiService: APIService = .shared) {
        self.environment = environment
        self.apiService = apiService
    }

    // MARK: - Available Contests

    /// Fetches available contests from backend.
    /// Backend handles all filtering (status=SCHEDULED, not full, user hasn't joined),
    /// capacity logic, sorting, and user_has_entered flag.
    /// Client must NOT re-implement any of this logic.
    func fetchAvailableContests() async throws -> [Contest] {
        // Retrieve userId from persistence before building request
        guard let userIdString = UserDefaults.standard.string(forKey: "userId"),
              let userId = UUID(uuidString: userIdString) else {
            print("❌ Missing userId before /available call")
            throw CustomContestError.notAuthenticated
        }

        let url = environment.baseURL.appendingPathComponent("api/custom-contests/available")

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Use X-User-Id header (not Bearer token) for custom contest endpoints
        request.setValue(userId.uuidString, forHTTPHeaderField: "X-User-Id")

        print("🔐 userId from defaults:", userIdString)
        print("📋 [fetchAvailableContests] Request headers BEFORE sending:")
        print("   \(request.allHTTPHeaderFields ?? [:])")
        print("   Method: \(request.httpMethod ?? "GET")")
        print("   URL: \(request.url?.absoluteString ?? "nil")")
        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw CustomContestError.networkError(underlying: "Invalid response")
        }

        // Log request details
        print("[fetchAvailableContests] baseURL: \(environment.baseURL.absoluteString)")
        print("[fetchAvailableContests] full URL: \(url.absoluteString)")
        print("[fetchAvailableContests] Authorization header: true")
        print("[fetchAvailableContests] HTTP status: \(httpResponse.statusCode)")

        switch httpResponse.statusCode {
        case 200:
            let decoder = JSONDecoder.iso8601Decoder

            do {
                let rawString = String(data: data, encoding: .utf8) ?? "nil"
                print("🟡 RAW JSON RESPONSE:")
                print(rawString)

                let dtos = try decoder.decode([Core.ContestListItemDTO].self, from: data)
                let contests = dtos.map { Contest.from($0) }

                print("🟢 Successfully decoded \(contests.count) contests")

                return contests

            } catch {
                print("🔴 DECODE ERROR:", error)

                let rawString = String(data: data, encoding: .utf8) ?? "nil"

                var debugMessage = "DECODE ERROR:\n\(error.localizedDescription)\n\n"

                if let decodingError = error as? DecodingError {
                    switch decodingError {
                    case .typeMismatch(let type, let context):
                        print("Type mismatch:", type)
                        print("CodingPath:", context.codingPath)
                        print("DebugDescription:", context.debugDescription)

                        debugMessage += "TypeMismatch: \(type)\n"
                        debugMessage += "Path: \(context.codingPath)\n"
                        debugMessage += "Debug: \(context.debugDescription)\n"

                    case .valueNotFound(let type, let context):
                        print("Value not found:", type)
                        print("CodingPath:", context.codingPath)
                        print("DebugDescription:", context.debugDescription)

                        debugMessage += "ValueNotFound: \(type)\n"
                        debugMessage += "Path: \(context.codingPath)\n"
                        debugMessage += "Debug: \(context.debugDescription)\n"

                    case .keyNotFound(let key, let context):
                        print("Key not found:", key)
                        print("CodingPath:", context.codingPath)
                        print("DebugDescription:", context.debugDescription)

                        debugMessage += "KeyNotFound: \(key)\n"
                        debugMessage += "Path: \(context.codingPath)\n"
                        debugMessage += "Debug: \(context.debugDescription)\n"

                    case .dataCorrupted(let context):
                        print("Data corrupted:")
                        print("CodingPath:", context.codingPath)
                        print("DebugDescription:", context.debugDescription)

                        debugMessage += "DataCorrupted\n"
                        debugMessage += "Path: \(context.codingPath)\n"
                        debugMessage += "Debug: \(context.debugDescription)\n"

                    @unknown default:
                        print("Unknown decoding error")
                        debugMessage += "Unknown decoding error\n"
                    }
                }

                debugMessage += "\n\nRAW JSON:\n\(rawString)"

                print("🔴 RAW JSON ON FAILURE:")
                print(rawString)

                throw CustomContestError.decodeFailure(debugMessage)
            }

        case 401, 403:
            throw CustomContestError.notAuthorized

        default:
            throw CustomContestError.serverError(message: "Server returned \(httpResponse.statusCode)")
        }
    }

    // MARK: - Created Contests

    /// Fetches contests created by the authenticated user.
    /// Returns Domain [Contest] objects only.
    func fetchCreatedContests() async throws -> [Contest] {
        guard let userIdString = UserDefaults.standard.string(forKey: "userId"),
              let userId = UUID(uuidString: userIdString) else {
            print("❌ Missing userId before /created contests call")
            throw CustomContestError.notAuthenticated
        }

        let url = environment.baseURL.appendingPathComponent("api/custom-contests")

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userId.uuidString, forHTTPHeaderField: "X-User-Id")

        print("📋 [fetchCreatedContests] Request headers:")
        print("   \(request.allHTTPHeaderFields ?? [:])")
        print("   URL: \(request.url?.absoluteString ?? "nil")")
        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw CustomContestError.networkError(underlying: "Invalid response")
        }

        print("[fetchCreatedContests] HTTP status: \(httpResponse.statusCode)")

        switch httpResponse.statusCode {
        case 200:
            let decoder = JSONDecoder.iso8601Decoder
            do {
                let dtos = try decoder.decode([Core.ContestListItemDTO].self, from: data)
                let contests = dtos.map { Contest.from($0) }
                print("🟢 Successfully decoded \(contests.count) created contests")
                return contests
            } catch {
                print("🔴 DECODE ERROR:", error)
                throw CustomContestError.serverError(message: "Failed to decode created contests")
            }
        case 401, 403:
            throw CustomContestError.notAuthorized
        default:
            throw CustomContestError.serverError(message: "Server returned \(httpResponse.statusCode)")
        }
    }

    // MARK: - Template Loading

    /// Loads minimal contest templates (id, name only) for display.
    /// No authentication required.
    func loadTemplates() async throws -> [ContestTemplate] {
        let url = environment.baseURL.appendingPathComponent("api/custom-contests/templates")

        print("[loadTemplates] URL: \(url.absoluteString)")

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw CustomContestError.networkError(underlying: "Invalid response")
        }

        print("[loadTemplates] HTTP Status: \(httpResponse.statusCode)")

        if let rawString = String(data: data, encoding: .utf8) {
            print("[loadTemplates] Raw JSON Response: \(rawString.prefix(500))...")
        }

        switch httpResponse.statusCode {
        case 200:
            let decoder = JSONDecoder()
            do {
                let templates = try decoder.decode([ContestTemplate].self, from: data)
                print("[loadTemplates] ✅ Successfully decoded \(templates.count) templates")
                return templates
            } catch {
                print("[loadTemplates] ❌ Decode error: \(error)")
                throw CustomContestError.serverError(message: "Failed to decode templates: \(error.localizedDescription)")
            }
        default:
            throw CustomContestError.serverError(message: "Failed to load templates: \(httpResponse.statusCode)")
        }
    }

    // MARK: - High-Level Orchestration

    /// Creates and publishes a contest in one call.
    /// Handles template fetching, contest creation, and publishing internally.
    /// Returns publish result with contest ID and join URL ready for sharing.
    func createAndPublish(input: ContestCreationInput, userId: UUID) async throws -> PublishResult {
        // Step 1: Fetch default template
        let template = try await fetchDefaultTemplate(userId: userId)

        // Step 2: Create contest instance
        let contestName = input.name.isEmpty ? template.name : input.name
        let contestId = try await createContestInstance(
            templateId: template.id,
            name: contestName,
            entryFeeCents: input.entryFeeCents,
            payoutStructure: template.defaultPayoutStructure,
            userId: userId,
            lockTime: input.lockTime
        )

        // Step 3: Publish to make joinable
        return try await publish(contestId: contestId, userId: userId)
    }

    // MARK: - Template Fetching

    private struct TemplateInfo {
        let id: UUID
        let name: String
        let defaultPayoutStructure: [String: Any]
    }

    private func fetchDefaultTemplate(userId: UUID) async throws -> TemplateInfo {
        let url = environment.baseURL.appendingPathComponent("api/custom-contests/templates")

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(userId.uuidString, forHTTPHeaderField: "X-User-Id")

        print("📋 [fetchDefaultTemplate] Request headers BEFORE sending:")
        print("   \(request.allHTTPHeaderFields ?? [:])")
        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw CustomContestError.serverError(message: "Failed to fetch templates")
        }

        // Parse as raw JSON to handle mixed types in allowed_payout_structures
        guard let jsonArray = try JSONSerialization.jsonObject(with: data) as? [[String: Any]],
              let first = jsonArray.first,
              let idString = first["id"] as? String,
              let id = UUID(uuidString: idString),
              let name = first["name"] as? String else {
            throw CustomContestError.serverError(message: "Invalid template response")
        }

        // Extract first allowed payout structure or use default
        let payoutStructures = first["allowed_payout_structures"] as? [[String: Any]]
        let defaultPayout: [String: Any] = payoutStructures?.first ?? ["type": "winner_takes_all"]

        return TemplateInfo(
            id: id,
            name: name,
            defaultPayoutStructure: defaultPayout
        )
    }

    // MARK: - Contest Instance Creation (Backend-Compatible)

    private func createContestInstance(
        templateId: UUID,
        name: String,
        entryFeeCents: Int,
        payoutStructure: [String: Any],
        userId: UUID,
        lockTime: Date? = nil
    ) async throws -> UUID {
        let url = environment.baseURL.appendingPathComponent("api/custom-contests")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Use X-User-Id header (not Bearer token) for custom contest endpoints
        request.setValue(userId.uuidString, forHTTPHeaderField: "X-User-Id")

        var body: [String: Any] = [
            "template_id": templateId.uuidString,
            "contest_name": name,
            "entry_fee_cents": entryFeeCents,
            "payout_structure": payoutStructure
        ]
        if let lockTime {
            body["lock_time"] = ISO8601DateFormatter().string(from: lockTime)
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw CustomContestError.networkError(underlying: "Invalid response")
        }

        switch httpResponse.statusCode {
        case 200, 201:
            let decoder = JSONDecoder.iso8601Decoder
            let dto = try decoder.decode(ContestDetailResponseDTO.self, from: data)
            return dto.id
        case 400:
            throw parseValidationError(from: data)
        case 401, 403:
            throw CustomContestError.notAuthorized
        case 404:
            throw CustomContestError.serverError(message: "Template not found")
        default:
            throw CustomContestError.serverError(message: "Server returned \(httpResponse.statusCode)")
        }
    }

    // MARK: - CustomContestCreating

    func createDraft(
        templateId: UUID,
        name: String,
        settings: CustomContestSettings,
        payoutStructure: PayoutStructure,
        userId: UUID,
        lockTime: Date? = nil
    ) async throws -> Contest {
        // Validate inputs before making network request
        let validationErrors = CustomContestValidation.validateDraftCreation(
            name: name,
            maxEntries: settings.maxEntries
        )
        if let firstError = validationErrors.first {
            throw firstError
        }

        let url = environment.baseURL.appendingPathComponent("api/custom-contests")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userId.uuidString, forHTTPHeaderField: "X-User-Id")

        struct RequestWrapper: Encodable {
            let templateId: String
            let name: String
            let maxEntries: Int?
            let entryFeeCents: Int
            let lockTime: String?
            let payoutStructure: PayoutStructure

            enum CodingKeys: String, CodingKey {
                case templateId = "template_id"
                case name = "contest_name"
                case maxEntries = "max_entries"
                case entryFeeCents = "entry_fee_cents"
                case lockTime = "lock_time"
                case payoutStructure = "payout_structure"
            }
        }

        let lockTimeString: String? = lockTime.map {
            ISO8601DateFormatter().string(from: $0)
        }

        let wrapper = RequestWrapper(
            templateId: templateId.uuidString,
            name: name,
            maxEntries: settings.maxEntries,
            entryFeeCents: settings.entryFeeCents,
            lockTime: lockTimeString,
            payoutStructure: payoutStructure
        )

        request.httpBody = try JSONEncoder().encode(wrapper)

        print("===== CREATE DRAFT REQUEST START =====")
        print("Base URL: \(environment.baseURL.absoluteString)")
        print("URL: \(request.url?.absoluteString ?? "nil")")
        print("Method: \(request.httpMethod ?? "nil")")
        print("Headers: \(request.allHTTPHeaderFields ?? [:])")

        if let body = request.httpBody,
           let bodyString = String(data: body, encoding: .utf8) {
            print("Body:")
            print(bodyString)
            print("Content-Length: \(body.count)")
        } else {
            print("No HTTP Body")
        }
        print("===== CREATE DRAFT REQUEST END =====")

        let (data, response) = try await URLSession.shared.data(for: request)

        print("===== CREATE DRAFT RESPONSE START =====")

        if let httpResponse = response as? HTTPURLResponse {
            print("Status Code: \(httpResponse.statusCode)")
            print("Response Headers: \(httpResponse.allHeaderFields)")
        } else {
            print("Response was not HTTPURLResponse")
        }

        if let raw = String(data: data, encoding: .utf8) {
            print("Raw Response Body:")
            print(raw)
        } else {
            print("Response body could not be converted to string")
        }

        print("===== CREATE DRAFT RESPONSE END =====")

        guard let httpResponse = response as? HTTPURLResponse else {
            throw CustomContestError.networkError(underlying: "Invalid response")
        }

        switch httpResponse.statusCode {
        case 200, 201:
            let decodedContest = try decodeResponse(data)
            print("===== DECODE RESPONSE RETURNED =====")
            print("Returned Contest ID: \(decodedContest.id.uuidString)")
            print("Returned Contest Status: \(decodedContest.status)")
            print("Returned Contest Name: \(decodedContest.contestName)")
            print("===== DECODE RESPONSE RETURN END =====")
            return decodedContest
        case 400:
            throw parseValidationError(from: data)
        case 401, 403:
            throw CustomContestError.notAuthorized
        case 404:
            throw CustomContestError.contestNotFound
        default:
            throw CustomContestError.serverError(message: "Server returned \(httpResponse.statusCode)")
        }
    }

    // MARK: - CustomContestPublishing

    func publish(
        contestId: UUID,
        userId: UUID
    ) async throws -> PublishResult {
        let url = environment.baseURL.appendingPathComponent("api/custom-contests/\(contestId.uuidString)/publish")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userId.uuidString, forHTTPHeaderField: "X-User-Id")

        print("📋 [publish] Request headers BEFORE sending:")
        print("   \(request.allHTTPHeaderFields ?? [:])")
        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw CustomContestError.networkError(underlying: "Invalid response")
        }

        switch httpResponse.statusCode {
        case 200:
            return try decodePublishResponse(data)
        case 400:
            // Check if it's a state error (not in draft)
            if let errorInfo = parseErrorMessage(from: data),
               errorInfo.lowercased().contains("draft") {
                throw CustomContestError.notInDraftState
            }
            throw CustomContestError.serverError(message: parseErrorMessage(from: data) ?? "Bad request")
        case 401, 403:
            throw CustomContestError.notAuthorized
        case 404:
            throw CustomContestError.contestNotFound
        default:
            throw CustomContestError.serverError(message: "Server returned \(httpResponse.statusCode)")
        }
    }

    // MARK: - Private Helpers

    private func decodeResponse(_ data: Data) throws -> Contest {
        let decoder = JSONDecoder.iso8601Decoder

        print("===== DECODE RESPONSE ENTRY =====")
        if let raw = String(data: data, encoding: .utf8) {
            print("Decode Input:")
            print(raw)
        }
        print("===== DECODE RESPONSE EXIT ATTEMPT =====")

        do {
            // POST returns minimal draft response (CreateContestResponseDTO)
            // Separate from GET full detail response (ContestDetailResponseDTO)
            let dto = try decoder.decode(CreateContestResponseDTO.self, from: data)
            return mapCreateResponseToDomain(dto)
        } catch {
            print("===== DECODE FAILURE =====")
            print("Error: \(error)")
            if let raw = String(data: data, encoding: .utf8) {
                print("Failed JSON:")
                print(raw)
            }
            print("===== END DECODE FAILURE =====")
            throw CustomContestError.serverError(message: "Failed to decode response")
        }
    }

    /// Maps CreateContestResponseDTO (POST response) to Core Domain model.
    /// Service boundary: translates transport layer → canonical domain.
    /// DTO never imports Core; mapping happens here only.
    private func mapCreateResponseToDomain(_ dto: CreateContestResponseDTO) -> Contest {
        let status = ContestStatus(rawValue: dto.status.uppercased()) ?? .scheduled
        return Contest(
            id: dto.id,
            organizerId: dto.organizerId.uuidString,
            contestName: dto.contestName,
            organizerName: nil,
            status: status,
            entryCount: 0,
            maxEntries: dto.maxEntries,
            entryFeeCents: dto.entryFeeCents,
            lockTime: dto.lockTime,
            startTime: nil,  // Not included in CREATE response
            endTime: nil,  // Not included in CREATE response
            joinToken: dto.joinToken,
            createdAt: dto.createdAt,
            updatedAt: dto.updatedAt,
            leaderboardState: nil,
            actions: nil,
            payoutTable: nil,
            rosterConfig: nil,
            isPlatformOwned: false
        )
    }

    private func decodePublishResponse(_ data: Data) throws -> PublishResult {
        let decoder = JSONDecoder()

        do {
            let dto = try decoder.decode(PublishResponseDTO.self, from: data)
            return PublishResult(
                contestId: dto.contestId,
                joinToken: dto.joinToken,
                joinURL: dto.joinURL
            )
        } catch {
            print("CustomContestService: Decode error - \(error)")
            throw CustomContestError.serverError(message: "Failed to decode publish response")
        }
    }

    private func parseValidationError(from data: Data) -> CustomContestError {
        if let errorMessage = parseErrorMessage(from: data) {
            let lowercased = errorMessage.lowercased()
            if lowercased.contains("name") && lowercased.contains("required") {
                return .nameRequired
            }
            if lowercased.contains("name") && lowercased.contains("long") {
                return .nameTooLong(maxLength: CustomContestValidation.nameMaxLength)
            }
            if lowercased.contains("entries") {
                return .maxEntriesInvalid
            }
            return .serverError(message: errorMessage)
        }
        return .serverError(message: "Validation failed")
    }

    private func parseErrorMessage(from data: Data) -> String? {
        struct ErrorResponse: Codable {
            let error: String?
            let message: String?
        }

        if let errorResponse = try? JSONDecoder().decode(ErrorResponse.self, from: data) {
            return errorResponse.error ?? errorResponse.message
        }
        return nil
    }
}

// MARK: - Protocol Conformance

extension CustomContestService: ContestServiceing {}
