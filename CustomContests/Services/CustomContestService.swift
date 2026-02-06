import Foundation

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
}

/// Production service for custom contest creation and publishing.
/// Wraps APIService.shared and implements protocol contracts.
final class CustomContestService: CustomContestCreating, CustomContestPublishing {

    private let baseURL: String

    init() {
        guard let baseURLValue = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String,
              !baseURLValue.isEmpty else {
            fatalError("CustomContestService: API_BASE_URL not configured")
        }
        self.baseURL = baseURLValue
    }

    // For testing with custom base URL
    init(baseURL: String) {
        self.baseURL = baseURL
    }

    // MARK: - High-Level Orchestration

    /// Creates and publishes a contest in one call.
    /// Handles template fetching, contest creation, and publishing internally.
    /// Returns a clean domain model with join URL ready for sharing.
    func createAndPublish(input: ContestCreationInput, userId: UUID) async throws -> CreatedContest {
        // Step 1: Fetch default template
        let template = try await fetchDefaultTemplate(userId: userId)

        // Step 2: Create contest instance
        let contestId = try await createContestInstance(
            templateId: template.id,
            entryFeeCents: input.entryFeeCents,
            payoutStructure: template.defaultPayoutStructure,
            userId: userId
        )

        // Step 3: Publish to make joinable
        let publishResult = try await publish(contestId: contestId, userId: userId)

        return CreatedContest(
            id: publishResult.contestId,
            name: input.name.isEmpty ? template.name : input.name,
            entryFeeCents: input.entryFeeCents,
            status: "open",
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
        let url = URL(string: "\(baseURL)/api/custom-contests/templates")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(userId.uuidString, forHTTPHeaderField: "X-User-Id")

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
        entryFeeCents: Int,
        payoutStructure: [String: Any],
        userId: UUID
    ) async throws -> UUID {
        let url = URL(string: "\(baseURL)/api/custom-contests")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userId.uuidString, forHTTPHeaderField: "X-User-Id")

        let body: [String: Any] = [
            "template_id": templateId.uuidString,
            "entry_fee_cents": entryFeeCents,
            "payout_structure": payoutStructure
        ]
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

        let url = URL(string: "\(baseURL)/api/custom-contests")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userId.uuidString, forHTTPHeaderField: "X-User-Id")

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
                case name
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
        let url = URL(string: "\(baseURL)/api/custom-contests/\(contestId.uuidString)/publish")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userId.uuidString, forHTTPHeaderField: "X-User-Id")

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
