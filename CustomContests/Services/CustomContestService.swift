import Foundation

/// DTO for available contests from /api/contests/available endpoint
/// Backend handles filtering, capacity logic, sorting, and user_has_entered.
struct AvailableContestDTO: Codable {
    let id: UUID
    let contest_name: String
    let status: String
    let entry_count: Int
    let max_entries: Int?
    let user_has_entered: Bool
    let is_platform_owned: Bool?
    let join_token: String?
    let lock_time: Date?
    let created_at: Date?
    let start_time: Date?
    let end_time: Date?
    let entry_fee_cents: Int?
    let organizer_name: String?
}

/// Domain model returned by createAndPublish - clean interface for Views
struct CreatedContest: Equatable {
    let id: UUID
    let name: String
    let entryFeeCents: Int
    let status: String
    let joinToken: String
    let joinURL: URL
}

/// Input for contest creation - what the View provides
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

    init(environment: AppEnvironment = .shared) {
        self.environment = environment
    }

    // MARK: - Available Contests

    /// Fetches available contests from backend.
    /// Backend handles all filtering (status=SCHEDULED, not full, user hasn't joined),
    /// capacity logic, sorting, and user_has_entered flag.
    /// Client must NOT re-implement any of this logic.
    func fetchAvailableContests() async throws -> [AvailableContestDTO] {
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
        request.setValue("Bearer \(userId.uuidString)", forHTTPHeaderField: "Authorization")

        print("🔐 userId from defaults:", userIdString)
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

                let dtos = try decoder.decode([AvailableContestDTO].self, from: data)

                print("🟢 Successfully decoded \(dtos.count) contests")

                return dtos

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

    // MARK: - High-Level Orchestration

    /// Creates and publishes a contest in one call.
    /// Handles template fetching, contest creation, and publishing internally.
    /// Returns a clean domain model with join URL ready for sharing.
    func createAndPublish(input: ContestCreationInput, userId: UUID) async throws -> CreatedContest {
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
        let publishResult = try await publish(contestId: contestId, userId: userId)

        return CreatedContest(
            id: publishResult.contestId,
            name: contestName,
            entryFeeCents: input.entryFeeCents,
            status: "SCHEDULED",
            joinToken: publishResult.joinToken,
            joinURL: publishResult.joinURL
        )
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
        request.setValue("Bearer \(userId.uuidString)", forHTTPHeaderField: "Authorization")

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
        request.setValue("Bearer \(userId.uuidString)", forHTTPHeaderField: "Authorization")

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
            struct CreateResponse: Codable {
                let id: UUID
            }
            let result = try JSONDecoder().decode(CreateResponse.self, from: data)
            return result.id
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

    // MARK: - CustomContestCreating (Legacy Protocol)

    func createDraft(
        name: String,
        settings: CustomContestSettings,
        userId: UUID,
        lockTime: Date? = nil
    ) async throws -> CustomContestDraft {
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
        request.setValue("Bearer \(userId.uuidString)", forHTTPHeaderField: "Authorization")

        let requestBody = CreateContestRequest(name: name, settings: settings, lockTime: lockTime)

        struct RequestWrapper: Encodable {
            let userId: String
            let name: String
            let maxEntries: Int
            let entryFee: Decimal
            let isPrivate: Bool
            let lockTime: String?

            enum CodingKeys: String, CodingKey {
                case userId = "user_id"
                case name = "contest_name"
                case maxEntries = "max_entries"
                case entryFee = "entry_fee"
                case isPrivate = "is_private"
                case lockTime = "lock_time"
            }
        }

        let lockTimeString: String? = requestBody.lockTime.map {
            ISO8601DateFormatter().string(from: $0)
        }

        let wrapper = RequestWrapper(
            userId: userId.uuidString,
            name: requestBody.name,
            maxEntries: requestBody.maxEntries,
            entryFee: requestBody.entryFee,
            isPrivate: requestBody.isPrivate,
            lockTime: lockTimeString
        )

        request.httpBody = try JSONEncoder().encode(wrapper)

        // DEBUG: Log outgoing payload to verify contest_name is present
        if let bodyData = request.httpBody,
           let bodyString = String(data: bodyData, encoding: .utf8) {
            print("[CreateDraft] Outgoing JSON: \(bodyString)")
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw CustomContestError.networkError(underlying: "Invalid response")
        }

        switch httpResponse.statusCode {
        case 200, 201:
            return try decodeResponse(data)
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
    ) async throws -> PublishContestResult {
        let url = environment.baseURL.appendingPathComponent("api/custom-contests/\(contestId.uuidString)/publish")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(userId.uuidString)", forHTTPHeaderField: "Authorization")

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

    private func decodeResponse(_ data: Data) throws -> CustomContestDraft {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970

        do {
            return try decoder.decode(CustomContestDraft.self, from: data)
        } catch {
            print("CustomContestService: Decode error - \(error)")
            throw CustomContestError.serverError(message: "Failed to decode response")
        }
    }

    private func decodePublishResponse(_ data: Data) throws -> PublishContestResult {
        let decoder = JSONDecoder()

        do {
            return try decoder.decode(PublishContestResult.self, from: data)
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
