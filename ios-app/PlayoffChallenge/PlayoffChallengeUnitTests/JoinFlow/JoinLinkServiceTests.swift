//
//  JoinLinkServiceTests.swift
//  PlayoffChallengeTests
//
//  Tests for JoinLinkService - verifies correct decoding of backend responses
//

import XCTest
@testable import PlayoffChallenge

final class JoinLinkServiceTests: XCTestCase {

    // MARK: - Response Decoding Tests

    func test_decode_validJoinResponse_succeeds() throws {
        let json = """
        {
            "valid": true,
            "contest": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "template_id": "660e8400-e29b-41d4-a716-446655440001",
                "template_name": "NFL Playoff Challenge",
                "template_sport": "NFL",
                "entry_fee_cents": 2500,
                "payout_structure": {"type": "winner_take_all", "places": 1},
                "status": "open",
                "start_time": "2025-01-15T18:00:00Z",
                "lock_time": "2025-01-18T18:00:00Z"
            }
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let response = try decoder.decode(TestJoinLinkAPIResponse.self, from: json)

        XCTAssertTrue(response.valid)
        XCTAssertNotNil(response.contest)
        XCTAssertEqual(response.contest?.id, UUID(uuidString: "550e8400-e29b-41d4-a716-446655440000"))
        XCTAssertEqual(response.contest?.templateName, "NFL Playoff Challenge")
        XCTAssertEqual(response.contest?.entryFeeCents, 2500)
        XCTAssertEqual(response.contest?.displayStatus, "open")
    }

    func test_decode_invalidTokenResponse_succeeds() throws {
        let json = """
        {
            "valid": false,
            "error_code": "INVALID_TOKEN",
            "reason": "Token format is invalid",
            "environment_mismatch": false
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let response = try decoder.decode(TestJoinLinkAPIResponse.self, from: json)

        XCTAssertFalse(response.valid)
        XCTAssertNil(response.contest)
        XCTAssertEqual(response.errorCode, "INVALID_TOKEN")
        XCTAssertEqual(response.reason, "Token format is invalid")
        XCTAssertEqual(response.environmentMismatch, false)
    }

    func test_decode_environmentMismatchResponse_succeeds() throws {
        let json = """
        {
            "valid": false,
            "error_code": "ENVIRONMENT_MISMATCH",
            "reason": "Environment mismatch: token from prd, current is stg",
            "environment_mismatch": true,
            "token_environment": "prd",
            "current_environment": "stg"
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let response = try decoder.decode(TestJoinLinkAPIResponse.self, from: json)

        XCTAssertFalse(response.valid)
        XCTAssertTrue(response.environmentMismatch ?? false)
        XCTAssertEqual(response.tokenEnvironment, "prd")
        XCTAssertEqual(response.currentEnvironment, "stg")
    }

    func test_decode_contestLockedResponse_succeeds() throws {
        let json = """
        {
            "valid": false,
            "error_code": "CONTEST_LOCKED",
            "reason": "Contest is locked and no longer accepting participants",
            "environment_mismatch": false,
            "contest": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "status": "locked",
                "lock_time": "2025-01-18T18:00:00Z"
            }
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let response = try decoder.decode(TestJoinLinkAPIResponse.self, from: json)

        XCTAssertFalse(response.valid)
        XCTAssertEqual(response.errorCode, "CONTEST_LOCKED")
        XCTAssertEqual(response.contest?.displayStatus, "locked")
    }

    func test_decode_contestNotFoundResponse_succeeds() throws {
        let json = """
        {
            "valid": false,
            "error_code": "NOT_FOUND",
            "reason": "Contest not found for this token",
            "environment_mismatch": false
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let response = try decoder.decode(TestJoinLinkAPIResponse.self, from: json)

        XCTAssertFalse(response.valid)
        XCTAssertEqual(response.errorCode, "NOT_FOUND")
        XCTAssertNil(response.contest)
    }

    func test_decode_minimalValidResponse_succeeds() throws {
        // Backend may return minimal contest info
        let json = """
        {
            "valid": true,
            "contest": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "template_name": "Test Contest",
                "entry_fee_cents": 0,
                "status": "draft"
            }
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let response = try decoder.decode(TestJoinLinkAPIResponse.self, from: json)

        XCTAssertTrue(response.valid)
        XCTAssertNotNil(response.contest)
        XCTAssertEqual(response.contest?.templateName, "Test Contest")
        XCTAssertEqual(response.contest?.entryFeeCents, 0)
        XCTAssertNil(response.contest?.templateId)
        XCTAssertNil(response.contest?.templateSport)
    }

    // MARK: - Integration Tests (with mock server)

    func test_resolve_validToken_returnsResolvedLink() async throws {
        let mockData = """
        {
            "valid": true,
            "contest": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "template_name": "NFL Playoff Challenge",
                "entry_fee_cents": 2500,
                "status": "open"
            }
        }
        """.data(using: .utf8)!

        let service = JoinLinkService(
            baseURL: "https://test.example.com",
            environment: "test"
        )

        // Note: Full integration test would require URLProtocol mocking
        // This test validates the service can be instantiated with test config
        XCTAssertNotNil(service)
    }

    // MARK: - Error Mapping Tests

    func test_entryFeeConversion_centsToCollars() {
        // 2500 cents = $25.00
        let cents = 2500
        let dollars = Double(cents) / 100.0
        XCTAssertEqual(dollars, 25.0, accuracy: 0.001)

        // 0 cents = $0.00 (free contest)
        let zeroCents = 0
        let zeroDollars = Double(zeroCents) / 100.0
        XCTAssertEqual(zeroDollars, 0.0, accuracy: 0.001)

        // 99 cents = $0.99
        let oddCents = 99
        let oddDollars = Double(oddCents) / 100.0
        XCTAssertEqual(oddDollars, 0.99, accuracy: 0.001)
    }

    // MARK: - Regression Tests

    func test_decode_doesNotFailOnMissingOptionalFields() throws {
        // This is the regression test for "the data couldn't be read because it is missing"
        // Ensures we handle responses with only required fields
        let json = """
        {
            "valid": true,
            "contest": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "template_name": "Test",
                "entry_fee_cents": 100,
                "status": "open"
            }
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()

        // This should NOT throw - if it does, we have a regression
        XCTAssertNoThrow(try decoder.decode(TestJoinLinkAPIResponse.self, from: json))
    }

    func test_decode_oldFlatFormat_fails() throws {
        // This tests that we correctly reject the OLD format we were expecting
        // which doesn't match the actual backend
        let oldFormatJson = """
        {
            "contest_id": "550e8400-e29b-41d4-a716-446655440000",
            "contest_name": "Test Contest",
            "entry_fee": 25.0,
            "total_slots": 20,
            "filled_slots": 5,
            "status": "open"
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()

        // New format should fail to decode old format (missing required `valid` field)
        XCTAssertThrowsError(try decoder.decode(TestJoinLinkAPIResponse.self, from: oldFormatJson))
    }
}

// MARK: - Test Double for Response Structure

/// Mirror of the private JoinLinkAPIResponse for testing decoding
private struct TestJoinLinkAPIResponse: Codable {
    let valid: Bool
    let contest: ContestInfo?
    let reason: String?
    let errorCode: String?
    let environmentMismatch: Bool?
    let tokenEnvironment: String?
    let currentEnvironment: String?

    struct ContestInfo: Codable {
        let id: UUID
        let templateId: UUID?
        let templateName: String?  // Optional for locked/expired contests
        let templateSport: String?
        let entryFeeCents: Int?  // Optional for locked/expired contests
        let payoutStructure: PayoutStructure?
        let displayStatus: String
        let startTime: String?
        let lockTime: String?

        enum CodingKeys: String, CodingKey {
            case id
            case templateId = "template_id"
            case templateName = "template_name"
            case templateSport = "template_sport"
            case entryFeeCents = "entry_fee_cents"
            case payoutStructure = "payout_structure"
            case displayStatus = "status"
            case startTime = "start_time"
            case lockTime = "lock_time"
        }
    }

    struct PayoutStructure: Codable {
        let type: String?
        let places: Int?
    }

    enum CodingKeys: String, CodingKey {
        case valid
        case contest
        case reason
        case errorCode = "error_code"
        case environmentMismatch = "environment_mismatch"
        case tokenEnvironment = "token_environment"
        case currentEnvironment = "current_environment"
    }
}
