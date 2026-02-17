import XCTest
@testable import PlayoffChallenge

/// Tests for CustomContest model encoding and decoding.
final class CustomContestModelsTests: XCTestCase {

    // MARK: - CustomContestSettings Tests

    func test_settings_encodesToCorrectJSON() throws {
        let settings = CustomContestSettings(
            maxEntries: 20,
            entryFee: 5.00,
            isPrivate: true
        )

        let encoder = JSONEncoder()
        let data = try encoder.encode(settings)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(json["max_entries"] as? Int, 20)
        XCTAssertEqual(json["is_private"] as? Bool, true)
        // Decimal encodes as number
        XCTAssertNotNil(json["entry_fee"])
    }

    func test_settings_decodesFromSnakeCaseJSON() throws {
        let json = """
        {
            "max_entries": 50,
            "entry_fee": 10.00,
            "is_private": false
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let settings = try decoder.decode(CustomContestSettings.self, from: json)

        XCTAssertEqual(settings.maxEntries, 50)
        XCTAssertEqual(settings.entryFee, 10.00)
        XCTAssertEqual(settings.isPrivate, false)
    }

    func test_settings_defaultValues() {
        let settings = CustomContestSettings(maxEntries: 10)

        XCTAssertEqual(settings.maxEntries, 10)
        XCTAssertEqual(settings.entryFee, 0)
        XCTAssertEqual(settings.isPrivate, true)
    }

    // MARK: - CustomContestDraft Tests

    func test_draft_defaultsToCorrectStatus() {
        let draft = CustomContestDraft(
            name: "Test Contest",
            settings: CustomContestSettings(maxEntries: 10)
        )

        XCTAssertEqual(draft.status, .scheduled)
        XCTAssertNil(draft.joinToken)
    }

    func test_draft_encodesToCorrectJSON() throws {
        let fixedDate = Date(timeIntervalSince1970: 1704067200) // 2024-01-01 00:00:00 UTC
        let fixedId = UUID(uuidString: "12345678-1234-1234-1234-123456789012")!

        let draft = CustomContestDraft(
            id: fixedId,
            name: "My Custom Contest",
            settings: CustomContestSettings(maxEntries: 25, entryFee: 0, isPrivate: true),
            status: .scheduled,
            createdAt: fixedDate,
            joinToken: nil
        )

        let encoder = JSONEncoder()
        let data = try encoder.encode(draft)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(json["id"] as? String, "12345678-1234-1234-1234-123456789012")
        XCTAssertEqual(json["name"] as? String, "My Custom Contest")
        XCTAssertEqual(json["status"] as? String, "SCHEDULED")
        XCTAssertNotNil(json["settings"])
        XCTAssertNotNil(json["created_at"])
    }

    func test_draft_decodesFromBackendResponse() throws {
        let json = """
        {
            "id": "ABCD1234-ABCD-ABCD-ABCD-ABCD12345678",
            "name": "Backend Contest",
            "settings": {
                "max_entries": 100,
                "entry_fee": 25.00,
                "is_private": false
            },
            "status": "SCHEDULED",
            "created_at": 1704067200,
            "join_token": "abc123"
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        let draft = try decoder.decode(CustomContestDraft.self, from: json)

        XCTAssertEqual(draft.id.uuidString, "ABCD1234-ABCD-ABCD-ABCD-ABCD12345678")
        XCTAssertEqual(draft.name, "Backend Contest")
        XCTAssertEqual(draft.settings.maxEntries, 100)
        XCTAssertEqual(draft.settings.entryFee, 25.00)
        XCTAssertEqual(draft.settings.isPrivate, false)
        XCTAssertEqual(draft.status, .scheduled)
        XCTAssertEqual(draft.joinToken, "abc123")
    }

    func test_draft_statusEncodesCorrectly() throws {
        let encoder = JSONEncoder()

        for status in [
            ContestStatus.scheduled,
            .locked,
            .live,
            .complete,
            .cancelled,
            .error
        ] {
            let draft = CustomContestDraft(
                name: "Test",
                settings: CustomContestSettings(maxEntries: 10),
                status: status
            )
            let data = try encoder.encode(draft)
            let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
            XCTAssertEqual(json["status"] as? String, status.rawValue)
        }
    }

    // MARK: - CreateContestRequest Tests

    func test_createRequest_buildsFromNameAndSettings() {
        let settings = CustomContestSettings(maxEntries: 30, entryFee: 15.00, isPrivate: false)
        let request = CreateContestRequest(name: "New Contest", settings: settings)

        XCTAssertEqual(request.name, "New Contest")
        XCTAssertEqual(request.maxEntries, 30)
        XCTAssertEqual(request.entryFee, 15.00)
        XCTAssertEqual(request.isPrivate, false)
    }

    func test_createRequest_encodesToExpectedShape() throws {
        let settings = CustomContestSettings(maxEntries: 10, entryFee: 0, isPrivate: true)
        let request = CreateContestRequest(name: "Test", settings: settings)

        let encoder = JSONEncoder()
        let data = try encoder.encode(request)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        // Verify expected JSON keys (snake_case)
        XCTAssertEqual(json["name"] as? String, "Test")
        XCTAssertEqual(json["max_entries"] as? Int, 10)
        XCTAssertEqual(json["is_private"] as? Bool, true)
        XCTAssertNotNil(json["entry_fee"])

        // Verify no unexpected keys
        let expectedKeys: Set<String> = ["name", "max_entries", "entry_fee", "is_private"]
        let actualKeys = Set(json.keys)
        XCTAssertEqual(actualKeys, expectedKeys)
    }

    // MARK: - PublishContestResult Tests

    func test_publishResult_decodesFromBackendResponse() throws {
        let json = """
        {
            "contestId": "12345678-1234-1234-1234-123456789012",
            "joinToken": "xyz789",
            "joinURL": "https://example.com/join/xyz789"
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let result = try decoder.decode(PublishContestResult.self, from: json)

        XCTAssertEqual(result.contestId.uuidString, "12345678-1234-1234-1234-123456789012")
        XCTAssertEqual(result.joinToken, "xyz789")
        XCTAssertEqual(result.joinURL.absoluteString, "https://example.com/join/xyz789")
        XCTAssertEqual(result.joinLink, "https://example.com/join/xyz789")
    }

    // MARK: - Equatable Tests

    func test_settings_equatable() {
        let settings1 = CustomContestSettings(maxEntries: 10, entryFee: 5, isPrivate: true)
        let settings2 = CustomContestSettings(maxEntries: 10, entryFee: 5, isPrivate: true)
        let settings3 = CustomContestSettings(maxEntries: 20, entryFee: 5, isPrivate: true)

        XCTAssertEqual(settings1, settings2)
        XCTAssertNotEqual(settings1, settings3)
    }

    func test_draft_equatable() {
        let id = UUID()
        let date = Date()
        let settings = CustomContestSettings(maxEntries: 10)

        let draft1 = CustomContestDraft(id: id, name: "Test", settings: settings, createdAt: date)
        let draft2 = CustomContestDraft(id: id, name: "Test", settings: settings, createdAt: date)
        let draft3 = CustomContestDraft(id: UUID(), name: "Test", settings: settings, createdAt: date)

        XCTAssertEqual(draft1, draft2)
        XCTAssertNotEqual(draft1, draft3)
    }
}
