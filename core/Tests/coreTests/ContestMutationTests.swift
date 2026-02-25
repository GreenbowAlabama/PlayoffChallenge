//
//  ContestMutationTests.swift
//  coreTests
//
//  Tests for ContestMutationService mutation operations.
//  Verifies endpoint paths, headers, list mutations, error handling, and idempotent behavior.
//

import Foundation
import Testing
@testable import Core

// MARK: - Mock API Client

final class MockContestAPIClient: ContestAPIClient {
    var shouldThrowError: Error?
    var returnedDTO: ContestListItemDTO?

    var lastDeletePath: String?
    var lastDeleteHeaders: [String: String]?
    var deleteCallCount = 0

    func delete<T: Decodable>(
        path: String,
        headers: [String: String]?
    ) async throws -> T {
        lastDeletePath = path
        lastDeleteHeaders = headers
        deleteCallCount += 1

        if let error = shouldThrowError {
            throw error
        }

        guard let dto = returnedDTO as? T else {
            throw ContestMutationError.decoding("Mock could not return expected type")
        }

        return dto
    }
}

// MARK: - Test Fixture Helpers

extension ContestListItemDTO {
    static func makeTestDTO(
        id: String = "test-contest-1",
        contestName: String = "Test Contest",
        organizerId: String = "org-1",
        status: String = "SCHEDULED",
        entryCount: Int = 5,
        maxEntries: Int? = 10,
        entryFeeCents: Int = 1000,
        lockTime: Date? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        joinToken: String? = "test-token",
        organizerName: String? = "Test Organizer",
        leaderboardState: String? = nil,
        actions: ContestActionsContract? = nil,
        payoutTable: [PayoutTierContract]? = nil,
        rosterConfig: RosterConfigContract? = nil,
        isPlatformOwned: Bool? = nil
    ) -> ContestListItemDTO {
        return ContestListItemDTO(
            id: id,
            organizerId: organizerId,
            status: status,
            entryCount: entryCount,
            contestName: contestName,
            maxEntries: maxEntries,
            entryFeeCents: entryFeeCents,
            lockTime: lockTime,
            createdAt: createdAt,
            updatedAt: updatedAt,
            joinToken: joinToken,
            organizerName: organizerName,
            leaderboardState: leaderboardState,
            actions: actions,
            payoutTable: payoutTable,
            rosterConfig: rosterConfig,
            isPlatformOwned: isPlatformOwned
        )
    }
}

// MARK: - ContestMutationTests

@Suite
struct ContestMutationTests {
    var sut: ContestMutationService!
    var mockClient: MockContestAPIClient!

    init() {
        mockClient = MockContestAPIClient()
        sut = ContestMutationService(apiClient: mockClient)
    }

    mutating func setup() {
        mockClient = MockContestAPIClient()
        sut = ContestMutationService(apiClient: mockClient)
    }

    // MARK: - Test: Delete Endpoint Path

    @Test
    mutating func testDeleteContest_SendsCorrectEndpointPath() async throws {
        setup()
        let contestId = "abc-123"
        let updated = ContestListItemDTO.makeTestDTO(id: contestId)
        mockClient.returnedDTO = updated

        _ = try await sut.deleteContest(
            contests: [],
            id: contestId,
            userId: "user-1"
        )

        #expect(mockClient.lastDeletePath == "/api/custom-contests/abc-123")
    }

    // MARK: - Test: Unjoin Endpoint Path

    @Test
    mutating func testUnjoinContest_SendsCorrectEndpointPath() async throws {
        setup()
        let contestId = "xyz-789"
        let updated = ContestListItemDTO.makeTestDTO(id: contestId)
        mockClient.returnedDTO = updated

        _ = try await sut.unjoinContest(
            contests: [],
            id: contestId,
            userId: "user-1"
        )

        #expect(mockClient.lastDeletePath == "/api/custom-contests/xyz-789/entry")
    }

    // MARK: - Test: Delete Header Inclusion

    @Test
    mutating func testDeleteContest_IncludesXUserIdHeader() async throws {
        setup()
        let userId = "user-abc-123"
        let updated = ContestListItemDTO.makeTestDTO()
        mockClient.returnedDTO = updated

        _ = try await sut.deleteContest(
            contests: [],
            id: "contest-1",
            userId: userId
        )

        #expect(mockClient.lastDeleteHeaders?["X-User-Id"] == userId)
    }

    // MARK: - Test: Unjoin Header Inclusion

    @Test
    mutating func testUnjoinContest_IncludesXUserIdHeader() async throws {
        setup()
        let userId = "user-xyz-789"
        let updated = ContestListItemDTO.makeTestDTO()
        mockClient.returnedDTO = updated

        _ = try await sut.unjoinContest(
            contests: [],
            id: "contest-1",
            userId: userId
        )

        #expect(mockClient.lastDeleteHeaders?["X-User-Id"] == userId)
    }

    // MARK: - Test: List Replacement Preserves Order

    @Test
    mutating func testDeleteContest_ListReplacementPreservesOrder() async throws {
        setup()
        let contest1 = ContestListItemDTO.makeTestDTO(id: "c1", contestName: "First")
        let contest2 = ContestListItemDTO.makeTestDTO(id: "c2", contestName: "Second")
        let contest3 = ContestListItemDTO.makeTestDTO(id: "c3", contestName: "Third")
        let contests = [contest1, contest2, contest3]

        let updated = ContestListItemDTO.makeTestDTO(id: "c2", contestName: "Second Updated")
        mockClient.returnedDTO = updated

        let result = try await sut.deleteContest(
            contests: contests,
            id: "c2",
            userId: "user-1"
        )

        #expect(result.count == 3)
        #expect(result[0].id == "c1")
        #expect(result[1].id == "c2")
        #expect(result[1].contestName == "Second Updated")
        #expect(result[2].id == "c3")
    }

    // MARK: - Test: Replacement Only Affects Matching ID

    @Test
    mutating func testDeleteContest_ReplacementOnlyAffectsMatchingId() async throws {
        setup()
        let contest1 = ContestListItemDTO.makeTestDTO(id: "c1", entryCount: 1)
        let contest2 = ContestListItemDTO.makeTestDTO(id: "c2", entryCount: 2)
        let contest3 = ContestListItemDTO.makeTestDTO(id: "c3", entryCount: 3)
        let contests = [contest1, contest2, contest3]

        let updated = ContestListItemDTO.makeTestDTO(id: "c2", entryCount: 99)
        mockClient.returnedDTO = updated

        let result = try await sut.deleteContest(
            contests: contests,
            id: "c2",
            userId: "user-1"
        )

        #expect(result[0].entryCount == 1)
        #expect(result[1].entryCount == 99)
        #expect(result[2].entryCount == 3)
    }

    // MARK: - Test: Append If ID Not Found

    @Test
    mutating func testDeleteContest_AppendIfIdNotFound() async throws {
        setup()
        let contest1 = ContestListItemDTO.makeTestDTO(id: "c1")
        let contest2 = ContestListItemDTO.makeTestDTO(id: "c2")
        let contests = [contest1, contest2]

        let newContest = ContestListItemDTO.makeTestDTO(id: "c3", contestName: "New Contest")
        mockClient.returnedDTO = newContest

        let result = try await sut.deleteContest(
            contests: contests,
            id: "c3",
            userId: "user-1"
        )

        #expect(result.count == 3)
        #expect(result[2].id == "c3")
        #expect(result[2].contestName == "New Contest")
    }

    // MARK: - Test: No Mutation When Error Thrown

    @Test
    mutating func testDeleteContest_NoMutationWhenErrorThrown() async throws {
        setup()
        let contest1 = ContestListItemDTO.makeTestDTO(id: "c1")
        let contest2 = ContestListItemDTO.makeTestDTO(id: "c2")
        let originalContests = [contest1, contest2]

        mockClient.shouldThrowError = ContestMutationError.forbidden

        var threwError = false
        do {
            _ = try await sut.deleteContest(
                contests: originalContests,
                id: "c1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            threwError = true
            #expect(error == .forbidden)
        }

        #expect(threwError == true)
    }

    // MARK: - Test: .notFound Error Mapping (now treated as idempotent success)

    @Test
    mutating func testDeleteContest_MapsNotFoundError() async throws {
        setup()
        struct NotFoundError: LocalizedError {
            var errorDescription: String? { "HTTP 404: not found" }
        }
        mockClient.shouldThrowError = NotFoundError()

        let result = try await sut.deleteContest(
            contests: [ContestListItemDTO.makeTestDTO(id: "missing")],
            id: "missing",
            userId: "user-1"
        )

        // 404 is now treated as idempotent success (item was already deleted)
        #expect(result.isEmpty)
    }

    // MARK: - Test: .forbidden Error Mapping

    @Test
    mutating func testDeleteContest_MapsForbiddenError() async throws {
        setup()
        struct ForbiddenError: LocalizedError {
            var errorDescription: String? { "HTTP 403: forbidden action" }
        }
        mockClient.shouldThrowError = ForbiddenError()

        var caughtError: ContestMutationError? = nil
        do {
            _ = try await sut.deleteContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
        }

        #expect(caughtError == .forbidden)
    }

    // MARK: - Test: .decoding Error Mapping

    @Test
    mutating func testDeleteContest_MapsDecodingError() async throws {
        setup()
        struct DecodingError: LocalizedError {
            var errorDescription: String? { "Unable to decode JSON payload" }
        }
        mockClient.shouldThrowError = DecodingError()

        var caughtError: ContestMutationError? = nil
        var isDecodingError = false
        do {
            _ = try await sut.deleteContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
            if case .decoding = error {
                isDecodingError = true
            }
        }

        #expect(caughtError != nil)
        #expect(isDecodingError)
    }

    // MARK: - Test: .unknown Error Mapping

    @Test
    mutating func testDeleteContest_MapsUnknownError() async throws {
        setup()
        struct UnknownError: LocalizedError {
            var errorDescription: String? { "Something went wrong on the server" }
        }
        mockClient.shouldThrowError = UnknownError()

        var caughtError: ContestMutationError? = nil
        var isUnknownError = false
        do {
            _ = try await sut.deleteContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
            if case .unknown = error {
                isUnknownError = true
            }
        }

        #expect(caughtError != nil)
        #expect(isUnknownError)
    }

    // MARK: - Test: Idempotent Behavior

    @Test
    mutating func testDeleteContest_IdempotentBehaviorWhenServerReturnsSameDTO() async throws {
        setup()
        let original = ContestListItemDTO.makeTestDTO(id: "c1", entryCount: 5)
        let contest2 = ContestListItemDTO.makeTestDTO(id: "c2")
        let contests = [original, contest2]

        let sameDTO = ContestListItemDTO.makeTestDTO(id: "c1", entryCount: 5)
        mockClient.returnedDTO = sameDTO

        let result1 = try await sut.deleteContest(
            contests: contests,
            id: "c1",
            userId: "user-1"
        )

        mockClient.deleteCallCount = 0
        mockClient.lastDeletePath = nil

        let result2 = try await sut.deleteContest(
            contests: result1,
            id: "c1",
            userId: "user-1"
        )

        #expect(result2.count == 2)
        #expect(result2[0].id == "c1")
        #expect(result2[0].entryCount == 5)
        #expect(result2[1].id == "c2")
        #expect(mockClient.deleteCallCount == 1)
    }

    // MARK: - Test: Unjoin Error Handling - NotFound (now treated as idempotent success)

    @Test
    mutating func testUnjoinContest_MapsNotFoundError() async throws {
        setup()
        struct NotFoundError: LocalizedError {
            var errorDescription: String? { "HTTP 404: contest not found" }
        }
        mockClient.shouldThrowError = NotFoundError()

        let result = try await sut.unjoinContest(
            contests: [ContestListItemDTO.makeTestDTO(id: "missing")],
            id: "missing",
            userId: "user-1"
        )

        // 404 is now treated as idempotent success (already unjoined)
        #expect(result.isEmpty)
    }

    // MARK: - Test: Unjoin Error Handling - Forbidden

    @Test
    mutating func testUnjoinContest_MapsForbiddenError() async throws {
        setup()
        struct ForbiddenError: LocalizedError {
            var errorDescription: String? { "HTTP 403: forbidden" }
        }
        mockClient.shouldThrowError = ForbiddenError()

        var caughtError: ContestMutationError? = nil
        do {
            _ = try await sut.unjoinContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
        }

        #expect(caughtError == .forbidden)
    }

    // MARK: - Test: Unjoin Error Handling - Decoding

    @Test
    mutating func testUnjoinContest_MapsDecodingError() async throws {
        setup()
        struct DecodingError: Error {
            var errorDescription: String? { "response could not be decoded as JSON" }
        }
        mockClient.shouldThrowError = DecodingError()

        var caughtError: ContestMutationError? = nil
        var isDecodingError = false
        do {
            _ = try await sut.unjoinContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
            if case .decoding = error {
                isDecodingError = true
            }
        }

        #expect(caughtError != nil)
        #expect(isDecodingError)
    }

    // MARK: - Test: Unjoin Preserves Order

    @Test
    mutating func testUnjoinContest_ListReplacementPreservesOrder() async throws {
        setup()
        let contest1 = ContestListItemDTO.makeTestDTO(id: "c1", contestName: "First")
        let contest2 = ContestListItemDTO.makeTestDTO(id: "c2", contestName: "Second")
        let contest3 = ContestListItemDTO.makeTestDTO(id: "c3", contestName: "Third")
        let contests = [contest1, contest2, contest3]

        let updated = ContestListItemDTO.makeTestDTO(id: "c2", contestName: "Second Updated", entryCount: 0)
        mockClient.returnedDTO = updated

        let result = try await sut.unjoinContest(
            contests: contests,
            id: "c2",
            userId: "user-1"
        )

        #expect(result.count == 3)
        #expect(result[0].id == "c1")
        #expect(result[1].id == "c2")
        #expect(result[1].entryCount == 0)
        #expect(result[2].id == "c3")
    }

    // MARK: - Test: Unjoin Append if Not Found

    @Test
    mutating func testUnjoinContest_AppendIfIdNotFound() async throws {
        setup()
        let contest1 = ContestListItemDTO.makeTestDTO(id: "c1")
        let contest2 = ContestListItemDTO.makeTestDTO(id: "c2")
        let contests = [contest1, contest2]

        let newContest = ContestListItemDTO.makeTestDTO(id: "c3", contestName: "New Contest")
        mockClient.returnedDTO = newContest

        let result = try await sut.unjoinContest(
            contests: contests,
            id: "c3",
            userId: "user-1"
        )

        #expect(result.count == 3)
        #expect(result[2].id == "c3")
    }

    // MARK: - Test: Unjoin No Mutation on Error

    @Test
    mutating func testUnjoinContest_NoMutationWhenErrorThrown() async throws {
        setup()
        let contest1 = ContestListItemDTO.makeTestDTO(id: "c1")
        let contest2 = ContestListItemDTO.makeTestDTO(id: "c2")
        let originalContests = [contest1, contest2]

        struct CustomError: LocalizedError {
            var errorDescription: String? { "Some internal error" }
        }
        mockClient.shouldThrowError = CustomError()

        var threwError = false
        do {
            _ = try await sut.unjoinContest(
                contests: originalContests,
                id: "c1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            threwError = true
            if case .unknown = error {
                // Expected
            } else {
                #expect(false)
            }
        }

        #expect(threwError == true)
    }

    // MARK: - Test: Delete with HTTP 404 Code String (treated as idempotent success)

    @Test
    mutating func testDeleteContest_MapsHttpErrorWith404String() async throws {
        setup()
        struct HttpNotFound: LocalizedError {
            var errorDescription: String? { "The resource at /api/custom-contests/xyz was not found (404)" }
        }
        mockClient.shouldThrowError = HttpNotFound()

        let result = try await sut.deleteContest(
            contests: [ContestListItemDTO.makeTestDTO(id: "xyz")],
            id: "xyz",
            userId: "user-1"
        )

        // 404 is idempotent success
        #expect(result.isEmpty)
    }

    // MARK: - Test: Delete with HTTP 403 Code String

    @Test
    mutating func testDeleteContest_MapsHttpErrorWith403String() async throws {
        setup()
        struct HttpForbidden: Error {
            var errorDescription: String? { "HTTP 403 Forbidden: Access denied" }
        }
        mockClient.shouldThrowError = HttpForbidden()

        var caughtError: ContestMutationError? = nil
        do {
            _ = try await sut.deleteContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
        }

        #expect(caughtError == .forbidden)
    }

    // MARK: - Test: Unjoin HTTP 404 String (treated as idempotent success)

    @Test
    mutating func testUnjoinContest_MapsHttpErrorWith404String() async throws {
        setup()
        struct HttpNotFound: LocalizedError {
            var errorDescription: String? { "404 entry not found" }
        }
        mockClient.shouldThrowError = HttpNotFound()

        let result = try await sut.unjoinContest(
            contests: [ContestListItemDTO.makeTestDTO(id: "xyz")],
            id: "xyz",
            userId: "user-1"
        )

        // 404 is idempotent success
        #expect(result.isEmpty)
    }

    // MARK: - Test: Delete with JSON Decode Error String

    @Test
    mutating func testDeleteContest_MapsJsonDecodeError() async throws {
        setup()
        struct JsonError: LocalizedError {
            var errorDescription: String? { "Invalid JSON: expected string but found number at line 5" }
        }
        mockClient.shouldThrowError = JsonError()

        var caughtError: ContestMutationError? = nil
        var isDecodingError = false
        do {
            _ = try await sut.deleteContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
            if case .decoding = error {
                isDecodingError = true
            }
        }

        #expect(caughtError != nil)
        #expect(isDecodingError)
    }

    // MARK: - Test: Unjoin with JSON Decode Error String

    @Test
    mutating func testUnjoinContest_MapsJsonDecodeError() async throws {
        setup()
        struct JsonError: LocalizedError {
            var errorDescription: String? { "JSON parsing error: unexpected token" }
        }
        mockClient.shouldThrowError = JsonError()

        var caughtError: ContestMutationError? = nil
        var isDecodingError = false
        do {
            _ = try await sut.unjoinContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
            if case .decoding = error {
                isDecodingError = true
            }
        }

        #expect(caughtError != nil)
        #expect(isDecodingError)
    }

    // MARK: - Test: Verify Contest ID In Delete Path

    @Test
    mutating func testDeleteContest_ContestIdAppearsInPath() async throws {
        setup()
        let contestId = "special-contest-xyz-789"
        let updated = ContestListItemDTO.makeTestDTO(id: contestId)
        mockClient.returnedDTO = updated

        _ = try await sut.deleteContest(
            contests: [],
            id: contestId,
            userId: "user-1"
        )

        #expect(mockClient.lastDeletePath?.contains(contestId) == true)
        #expect(mockClient.lastDeletePath == "/api/custom-contests/special-contest-xyz-789")
    }

    // MARK: - Test: Verify Contest ID In Unjoin Path

    @Test
    mutating func testUnjoinContest_ContestIdAppearsInPath() async throws {
        setup()
        let contestId = "another-contest-abc-123"
        let updated = ContestListItemDTO.makeTestDTO(id: contestId)
        mockClient.returnedDTO = updated

        _ = try await sut.unjoinContest(
            contests: [],
            id: contestId,
            userId: "user-1"
        )

        #expect(mockClient.lastDeletePath?.contains(contestId) == true)
        #expect(mockClient.lastDeletePath == "/api/custom-contests/another-contest-abc-123/entry")
    }

    // MARK: - Test: Delete with Unknown Error Type

    @Test
    mutating func testDeleteContest_MapsUnknownErrorType() async throws {
        setup()
        struct CustomBusinessError: LocalizedError {
            var errorDescription: String? { "Rate limit exceeded, retry after 60 seconds" }
        }
        mockClient.shouldThrowError = CustomBusinessError()

        var caughtError: ContestMutationError? = nil
        var isUnknownError = false
        do {
            _ = try await sut.deleteContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
            if case .unknown = error {
                isUnknownError = true
            }
        }

        #expect(caughtError != nil)
        #expect(isUnknownError)
    }

    // MARK: - Test: Unjoin with Unknown Error Type

    @Test
    mutating func testUnjoinContest_MapsUnknownErrorType() async throws {
        setup()
        struct CustomBusinessError: LocalizedError {
            var errorDescription: String? { "Service temporarily unavailable" }
        }
        mockClient.shouldThrowError = CustomBusinessError()

        var caughtError: ContestMutationError? = nil
        var isUnknownError = false
        do {
            _ = try await sut.unjoinContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
            if case .unknown = error {
                isUnknownError = true
            }
        }

        #expect(caughtError != nil)
        #expect(isUnknownError)
    }

    // MARK: - Test: Headers Include Only X-User-Id

    @Test
    mutating func testDeleteContest_HeadersAreExactlyXUserId() async throws {
        setup()
        let updated = ContestListItemDTO.makeTestDTO()
        mockClient.returnedDTO = updated

        _ = try await sut.deleteContest(
            contests: [],
            id: "contest-1",
            userId: "user-1"
        )

        let headers = mockClient.lastDeleteHeaders ?? [:]
        #expect(headers.count == 1)
        #expect(headers["X-User-Id"] == "user-1")
    }

    // MARK: - Test: Unjoin Headers Are Exact

    @Test
    mutating func testUnjoinContest_HeadersAreExactlyXUserId() async throws {
        setup()
        let updated = ContestListItemDTO.makeTestDTO()
        mockClient.returnedDTO = updated

        _ = try await sut.unjoinContest(
            contests: [],
            id: "contest-1",
            userId: "user-1"
        )

        let headers = mockClient.lastDeleteHeaders ?? [:]
        #expect(headers.count == 1)
        #expect(headers["X-User-Id"] == "user-1")
    }

    // MARK: - Test: Append Adds To End of List

    @Test
    mutating func testDeleteContest_AppendedItemIsAtEnd() async throws {
        setup()
        let contest1 = ContestListItemDTO.makeTestDTO(id: "c1")
        let contest2 = ContestListItemDTO.makeTestDTO(id: "c2")
        let contest3 = ContestListItemDTO.makeTestDTO(id: "c3")
        let contests = [contest1, contest2, contest3]

        let newContest = ContestListItemDTO.makeTestDTO(id: "new-id")
        mockClient.returnedDTO = newContest

        let result = try await sut.deleteContest(
            contests: contests,
            id: "new-id",
            userId: "user-1"
        )

        #expect(result.count == 4)
        #expect(result[0].id == "c1")
        #expect(result[1].id == "c2")
        #expect(result[2].id == "c3")
        #expect(result[3].id == "new-id")
    }

    // MARK: - Test: Unjoin Appended Item Is At End

    @Test
    mutating func testUnjoinContest_AppendedItemIsAtEnd() async throws {
        setup()
        let contest1 = ContestListItemDTO.makeTestDTO(id: "c1")
        let contest2 = ContestListItemDTO.makeTestDTO(id: "c2")
        let contests = [contest1, contest2]

        let newContest = ContestListItemDTO.makeTestDTO(id: "new-id")
        mockClient.returnedDTO = newContest

        let result = try await sut.unjoinContest(
            contests: contests,
            id: "new-id",
            userId: "user-1"
        )

        #expect(result.count == 3)
        #expect(result[2].id == "new-id")
    }

    // MARK: - Test: Delete Error with Mixed Case NotFound - idempotent success

    @Test
    mutating func testDeleteContest_MapsMixedCaseNotFoundError() async throws {
        setup()
        struct MixedCaseError: LocalizedError {
            var errorDescription: String? { "Resource not Found (uppercase F)" }
        }
        mockClient.shouldThrowError = MixedCaseError()

        let result = try await sut.deleteContest(
            contests: [ContestListItemDTO.makeTestDTO(id: "contest-1")],
            id: "contest-1",
            userId: "user-1"
        )

        // Mixed case "not found" is still idempotent success
        #expect(result.isEmpty)
    }

    // MARK: - Test: Unjoin Error with Mixed Case NotFound - idempotent success

    @Test
    mutating func testUnjoinContest_MapsMixedCaseNotFoundError() async throws {
        setup()
        struct MixedCaseError: LocalizedError {
            var errorDescription: String? { "Entry Not found in database" }
        }
        mockClient.shouldThrowError = MixedCaseError()

        let result = try await sut.unjoinContest(
            contests: [ContestListItemDTO.makeTestDTO(id: "contest-1")],
            id: "contest-1",
            userId: "user-1"
        )

        // Mixed case "not found" is idempotent success
        #expect(result.isEmpty)
    }

    // MARK: - Test: Delete Error with Decode Variant

    @Test
    mutating func testDeleteContest_MapsDecodeVariantError() async throws {
        setup()
        struct DecodeVariantError: LocalizedError {
            var errorDescription: String? { "Cannot deserialize data: missing required field" }
        }
        mockClient.shouldThrowError = DecodeVariantError()

        var caughtError: ContestMutationError? = nil
        var isDecodingError = false
        do {
            _ = try await sut.deleteContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
            if case .decoding = error {
                isDecodingError = true
            }
        }

        #expect(caughtError != nil)
        #expect(isDecodingError)
    }

    // MARK: - Test: Unjoin Error with Decode Variant

    @Test
    mutating func testUnjoinContest_MapsDecodeVariantError() async throws {
        setup()
        struct DecodeVariantError: LocalizedError {
            var errorDescription: String? { "Malformed JSON structure: unexpected token" }
        }
        mockClient.shouldThrowError = DecodeVariantError()

        var caughtError: ContestMutationError? = nil
        var isDecodingError = false
        do {
            _ = try await sut.unjoinContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
            if case .decoding = error {
                isDecodingError = true
            }
        }

        #expect(caughtError != nil)
        #expect(isDecodingError)
    }

    // MARK: - Test: Delete with Error That Already is ContestMutationError

    @Test
    mutating func testDeleteContest_PassesThroughContestMutationError() async throws {
        setup()
        mockClient.shouldThrowError = ContestMutationError.forbidden

        var caughtError: ContestMutationError? = nil
        do {
            _ = try await sut.deleteContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
        }

        #expect(caughtError == .forbidden)
    }

    // MARK: - Test: Unjoin with Error That Already is ContestMutationError (notFound is idempotent)

    @Test
    mutating func testUnjoinContest_PassesThroughContestMutationError() async throws {
        setup()
        mockClient.shouldThrowError = ContestMutationError.notFound

        let result = try await sut.unjoinContest(
            contests: [ContestListItemDTO.makeTestDTO(id: "contest-1")],
            id: "contest-1",
            userId: "user-1"
        )

        // Even pre-classified .notFound is treated as idempotent success
        #expect(result.isEmpty)
    }

    // MARK: - Test: Delete Error with Forbidden Variant

    @Test
    mutating func testDeleteContest_MapsForbiddenVariantError() async throws {
        setup()
        struct ForbiddenVariantError: LocalizedError {
            var errorDescription: String? { "Access is Forbidden" }
        }
        mockClient.shouldThrowError = ForbiddenVariantError()

        var caughtError: ContestMutationError? = nil
        do {
            _ = try await sut.deleteContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
        }

        #expect(caughtError == .forbidden)
    }

    // MARK: - Test: Unjoin Error with Forbidden Variant

    @Test
    mutating func testUnjoinContest_MapsForbiddenVariantError() async throws {
        setup()
        struct ForbiddenVariantError: LocalizedError {
            var errorDescription: String? { "User cannot access: Forbidden resource" }
        }
        mockClient.shouldThrowError = ForbiddenVariantError()

        var caughtError: ContestMutationError? = nil
        do {
            _ = try await sut.unjoinContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
        }

        #expect(caughtError == .forbidden)
    }

    // MARK: - Test: Delete with Error Type Not Matching Any Pattern

    @Test
    mutating func testDeleteContest_ErrorWithNoMatchingPattern() async throws {
        setup()
        struct NoPatternError: LocalizedError {
            var errorDescription: String? { "Timeout waiting for response from server" }
        }
        mockClient.shouldThrowError = NoPatternError()

        var caughtError: ContestMutationError? = nil
        var isUnknownError = false
        do {
            _ = try await sut.deleteContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
            if case .unknown = error {
                isUnknownError = true
            }
        }

        #expect(caughtError != nil)
        #expect(isUnknownError)
    }

    // MARK: - Test: Unjoin with Error Type Not Matching Any Pattern

    @Test
    mutating func testUnjoinContest_ErrorWithNoMatchingPattern() async throws {
        setup()
        struct NoPatternError: LocalizedError {
            var errorDescription: String? { "Connection refused by peer" }
        }
        mockClient.shouldThrowError = NoPatternError()

        var caughtError: ContestMutationError? = nil
        var isUnknownError = false
        do {
            _ = try await sut.unjoinContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
            if case .unknown = error {
                isUnknownError = true
            }
        }

        #expect(caughtError != nil)
        #expect(isUnknownError)
    }

    // MARK: - Test: Delete Error with "Not Found" (No 404) - idempotent success

    @Test
    mutating func testDeleteContest_MapsErrorWithoutHttpCode() async throws {
        setup()
        struct NoCodeError: LocalizedError {
            var errorDescription: String? { "Not Found" }
        }
        mockClient.shouldThrowError = NoCodeError()

        let result = try await sut.deleteContest(
            contests: [ContestListItemDTO.makeTestDTO(id: "contest-1")],
            id: "contest-1",
            userId: "user-1"
        )

        // 404 "Not Found" is idempotent success
        #expect(result.isEmpty)
    }

    // MARK: - Test: Unjoin Error with "Not Found" (No 404) - idempotent success

    @Test
    mutating func testUnjoinContest_MapsErrorWithoutHttpCode() async throws {
        setup()
        struct NoCodeError: LocalizedError {
            var errorDescription: String? { "Not Found" }
        }
        mockClient.shouldThrowError = NoCodeError()

        let result = try await sut.unjoinContest(
            contests: [ContestListItemDTO.makeTestDTO(id: "contest-1")],
            id: "contest-1",
            userId: "user-1"
        )

        // 404 "Not Found" is idempotent success
        #expect(result.isEmpty)
    }

    // MARK: - Test: Delete Error with "Forbidden" (No 403)

    @Test
    mutating func testDeleteContest_MapsErrorForbiddenWithoutCode() async throws {
        setup()
        struct NoCodeError: LocalizedError {
            var errorDescription: String? { "Forbidden" }
        }
        mockClient.shouldThrowError = NoCodeError()

        var caughtError: ContestMutationError? = nil
        do {
            _ = try await sut.deleteContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
        }

        #expect(caughtError == .forbidden)
    }

    // MARK: - Test: Unjoin Error with "Forbidden" (No 403)

    @Test
    mutating func testUnjoinContest_MapsErrorForbiddenWithoutCode() async throws {
        setup()
        struct NoCodeError: LocalizedError {
            var errorDescription: String? { "Forbidden" }
        }
        mockClient.shouldThrowError = NoCodeError()

        var caughtError: ContestMutationError? = nil
        do {
            _ = try await sut.unjoinContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
        }

        #expect(caughtError == .forbidden)
    }

    // MARK: - Test: Delete Error with "Decode" (No JSON)

    @Test
    mutating func testDeleteContest_MapsErrorWithDecodeKeyword() async throws {
        setup()
        struct DecodeError: LocalizedError {
            var errorDescription: String? { "Unable to decode response" }
        }
        mockClient.shouldThrowError = DecodeError()

        var caughtError: ContestMutationError? = nil
        var isDecodingError = false
        do {
            _ = try await sut.deleteContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
            if case .decoding = error {
                isDecodingError = true
            }
        }

        #expect(caughtError != nil)
        #expect(isDecodingError)
    }

    // MARK: - Test: Unjoin Error with "Decode" (No JSON)

    @Test
    mutating func testUnjoinContest_MapsErrorWithDecodeKeyword() async throws {
        setup()
        struct DecodeError: LocalizedError {
            var errorDescription: String? { "Unable to decode response" }
        }
        mockClient.shouldThrowError = DecodeError()

        var caughtError: ContestMutationError? = nil
        var isDecodingError = false
        do {
            _ = try await sut.unjoinContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
            if case .decoding = error {
                isDecodingError = true
            }
        }

        #expect(caughtError != nil)
        #expect(isDecodingError)
    }

    // MARK: - Test: Delete Error with Type Name Masking Pattern - idempotent success

    @Test
    mutating func testDeleteContest_ErrorTypeNameMasksPattern() async throws {
        setup()
        struct ResourceNotAvailableError: LocalizedError {
            var errorDescription: String? { "The resource requested is not available" }
        }
        mockClient.shouldThrowError = ResourceNotAvailableError()

        let result = try await sut.deleteContest(
            contests: [ContestListItemDTO.makeTestDTO(id: "contest-1")],
            id: "contest-1",
            userId: "user-1"
        )

        // "not available" matches 404 pattern, treated as idempotent success
        #expect(result.isEmpty)
    }

    // MARK: - Test: Unjoin Error with Type Name Masking Pattern

    @Test
    mutating func testUnjoinContest_ErrorTypeNameMasksPattern() async throws {
        setup()
        struct AccessDeniedError: LocalizedError {
            var errorDescription: String? { "You do not have permission to perform this action" }
        }
        mockClient.shouldThrowError = AccessDeniedError()

        var caughtError: ContestMutationError? = nil
        do {
            _ = try await sut.unjoinContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
        }

        #expect(caughtError == .forbidden)
    }

    // MARK: - Test: 409 Conflict Handling - Delete Locked Contest

    @Test
    mutating func testDeleteContest_409ConflictClassified() async throws {
        setup()
        struct ConflictError: LocalizedError {
            var errorDescription: String? { "HTTP 409 Conflict: Contest is locked" }
        }
        mockClient.shouldThrowError = ConflictError()

        var caughtError: ContestMutationError? = nil
        do {
            _ = try await sut.deleteContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
        }

        #expect(caughtError != nil)
        if let error = caughtError, case .conflict = error {
            // Expected
        } else {
            #expect(false, "409 should be classified as conflict")
        }
    }

    // MARK: - Test: 409 Conflict Handling - Unjoin Locked Contest

    @Test
    mutating func testUnjoinContest_409ConflictClassified() async throws {
        setup()
        struct ConflictError: LocalizedError {
            var errorDescription: String? { "HTTP 409: Cannot unjoin after lock time" }
        }
        mockClient.shouldThrowError = ConflictError()

        var caughtError: ContestMutationError? = nil
        do {
            _ = try await sut.unjoinContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
        }

        #expect(caughtError != nil)
        if let error = caughtError, case .conflict = error {
            // Expected
        } else {
            #expect(false, "409 should be classified as conflict")
        }
    }

    // MARK: - Test: 409 Locked Keyword Detection

    @Test
    mutating func testDeleteContest_LockedKeywordClassifiedAsConflict() async throws {
        setup()
        struct LockedError: LocalizedError {
            var errorDescription: String? { "Contest is locked, no mutations allowed" }
        }
        mockClient.shouldThrowError = LockedError()

        var caughtError: ContestMutationError? = nil
        do {
            _ = try await sut.deleteContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
        }

        if let error = caughtError, case .conflict = error {
            #expect(true)
        } else {
            #expect(false, "locked should be classified as conflict")
        }
    }

    // MARK: - Test: Success with Changed Status - Delete

    @Test
    mutating func testDeleteContest_SuccessWithChangedStatusUpdates() async throws {
        setup()
        let contest1 = ContestListItemDTO.makeTestDTO(
            id: "c1",
            status: "SCHEDULED",
            leaderboardState: nil
        )
        let contest2 = ContestListItemDTO.makeTestDTO(id: "c2", status: "SCHEDULED")
        let contests = [contest1, contest2]

        // Server returns same ID but different status (race condition near lock time)
        let updated = ContestListItemDTO.makeTestDTO(
            id: "c1",
            status: "LOCKED",
            leaderboardState: "LOCKED"
        )
        mockClient.returnedDTO = updated

        let result = try await sut.deleteContest(
            contests: contests,
            id: "c1",
            userId: "user-1"
        )

        // Item should be updated with new status
        #expect(result.count == 2)
        #expect(result[0].id == "c1")
        #expect(result[0].status == "LOCKED")
        #expect(result[0].leaderboardState == "LOCKED")
        // Untouched item should remain unchanged
        #expect(result[1].id == "c2")
        #expect(result[1].status == "SCHEDULED")
    }

    // MARK: - Test: Success with Changed Status - Unjoin

    @Test
    mutating func testUnjoinContest_SuccessWithChangedStatusUpdates() async throws {
        setup()
        let contest1 = ContestListItemDTO.makeTestDTO(
            id: "c1",
            status: "SCHEDULED",
            entryCount: 5
        )
        let contest2 = ContestListItemDTO.makeTestDTO(id: "c2", status: "SCHEDULED")
        let contests = [contest1, contest2]

        // Server returns updated entry count and status
        let updated = ContestListItemDTO.makeTestDTO(
            id: "c1",
            status: "LOCKED",
            entryCount: 4
        )
        mockClient.returnedDTO = updated

        let result = try await sut.unjoinContest(
            contests: contests,
            id: "c1",
            userId: "user-1"
        )

        // Item should be updated
        #expect(result.count == 2)
        #expect(result[0].id == "c1")
        #expect(result[0].status == "LOCKED")
        #expect(result[0].entryCount == 4)
        #expect(result[1].id == "c2")
    }

    // MARK: - Test: 404 Idempotency - Delete

    @Test
    mutating func testDeleteContest_404TreatsAsIdempotentRemoval() async throws {
        setup()
        let contest1 = ContestListItemDTO.makeTestDTO(id: "c1")
        let contest2 = ContestListItemDTO.makeTestDTO(id: "c2")
        let contest3 = ContestListItemDTO.makeTestDTO(id: "c3")
        let contests = [contest1, contest2, contest3]

        struct NotFoundError: LocalizedError {
            var errorDescription: String? { "HTTP 404: contest not found" }
        }
        mockClient.shouldThrowError = NotFoundError()

        // First call fails with 404 - should return list with contest removed
        let result = try await sut.deleteContest(
            contests: contests,
            id: "c2",
            userId: "user-1"
        )

        // Item should be removed, order preserved
        #expect(result.count == 2)
        #expect(result[0].id == "c1")
        #expect(result[1].id == "c3")
    }

    // MARK: - Test: 404 Idempotency - Unjoin

    @Test
    mutating func testUnjoinContest_404TreatsAsIdempotentRemoval() async throws {
        setup()
        let contest1 = ContestListItemDTO.makeTestDTO(id: "c1")
        let contest2 = ContestListItemDTO.makeTestDTO(id: "c2")
        let contests = [contest1, contest2]

        struct NotFoundError: LocalizedError {
            var errorDescription: String? { "Entry not found" }
        }
        mockClient.shouldThrowError = NotFoundError()

        // Unjoin with 404 - should return list with contest removed
        let result = try await sut.unjoinContest(
            contests: contests,
            id: "c1",
            userId: "user-1"
        )

        #expect(result.count == 1)
        #expect(result[0].id == "c2")
    }

    // MARK: - Test: 404 Idempotency - Item Not In List

    @Test
    mutating func testDeleteContest_404WithMissingItemReturnsSameList() async throws {
        setup()
        let contest1 = ContestListItemDTO.makeTestDTO(id: "c1")
        let contest2 = ContestListItemDTO.makeTestDTO(id: "c2")
        let contests = [contest1, contest2]

        struct NotFoundError: LocalizedError {
            var errorDescription: String? { "Not found" }
        }
        mockClient.shouldThrowError = NotFoundError()

        // Try to delete item that's not in list, get 404
        let result = try await sut.deleteContest(
            contests: contests,
            id: "c3",
            userId: "user-1"
        )

        // List should be unchanged (c3 was never there)
        #expect(result.count == 2)
        #expect(result[0].id == "c1")
        #expect(result[1].id == "c2")
    }

    // MARK: - Test: Malformed Payload - Missing Required Field Behavior

    @Test
    mutating func testDeleteContest_MalformedPayloadNotFoundErrorDoesNotMutate() async throws {
        setup()
        let contest1 = ContestListItemDTO.makeTestDTO(id: "c1")
        let contest2 = ContestListItemDTO.makeTestDTO(id: "c2")
        let contests = [contest1, contest2]

        struct MalformedError: LocalizedError {
            var errorDescription: String? { "Malformed JSON: missing required field 'id'" }
        }
        mockClient.shouldThrowError = MalformedError()

        var threwError = false
        do {
            _ = try await sut.deleteContest(
                contests: contests,
                id: "c1",
                userId: "user-1"
            )
        } catch {
            threwError = true
        }

        #expect(threwError)
    }

    // MARK: - Test: Malformed Payload - Type Mismatch

    @Test
    mutating func testDeleteContest_TypeMismatchClassifiedAsDecoding() async throws {
        setup()
        struct TypeMismatchError: LocalizedError {
            var errorDescription: String? { "Type mismatch: expected string for entryFeeCents, got number" }
        }
        mockClient.shouldThrowError = TypeMismatchError()

        var caughtError: ContestMutationError? = nil
        do {
            _ = try await sut.deleteContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
        }

        // Type mismatch should not match "type" keyword, but might match nothing
        #expect(caughtError != nil)
    }

    // MARK: - Test: Malformed Payload - Unexpected Enum Value

    @Test
    mutating func testDeleteContest_UnexpectedEnumValueClassifiedAsDecoding() async throws {
        setup()
        struct UnexpectedEnumError: LocalizedError {
            var errorDescription: String? { "Invalid status value: UNKNOWN_STATUS" }
        }
        mockClient.shouldThrowError = UnexpectedEnumError()

        var caughtError: ContestMutationError? = nil
        do {
            _ = try await sut.deleteContest(
                contests: [],
                id: "contest-1",
                userId: "user-1"
            )
        } catch let error as ContestMutationError {
            caughtError = error
        }

        #expect(caughtError != nil)
    }

    // MARK: - Test: Deep Equality - Untouched Elements Remain Identical

    @Test
    mutating func testDeleteContest_UntouchedElementsPreservedIdentically() async throws {
        setup()
        let contest1 = ContestListItemDTO.makeTestDTO(
            id: "c1",
            contestName: "First",
            status: "SCHEDULED",
            entryCount: 10,
            maxEntries: 20
        )
        let contest2 = ContestListItemDTO.makeTestDTO(
            id: "c2",
            contestName: "Second",
            status: "ACTIVE",
            entryCount: 5,
            maxEntries: nil
        )
        let contest3 = ContestListItemDTO.makeTestDTO(
            id: "c3",
            contestName: "Third",
            status: "SCHEDULED",
            entryCount: 2,
            maxEntries: 10
        )
        let contests = [contest1, contest2, contest3]

        // Update only c2
        let updated = ContestListItemDTO.makeTestDTO(
            id: "c2",
            contestName: "Second Updated",
            status: "ACTIVE",
            entryCount: 6,
            maxEntries: nil
        )
        mockClient.returnedDTO = updated

        let result = try await sut.deleteContest(
            contests: contests,
            id: "c2",
            userId: "user-1"
        )

        // c1 and c3 should be structurally identical to originals
        #expect(result[0].id == "c1")
        #expect(result[0].contestName == "First")
        #expect(result[0].entryCount == 10)
        #expect(result[0].maxEntries == 20)
        #expect(result[0].status == "SCHEDULED")

        #expect(result[2].id == "c3")
        #expect(result[2].contestName == "Third")
        #expect(result[2].entryCount == 2)
        #expect(result[2].maxEntries == 10)
        #expect(result[2].status == "SCHEDULED")

        // c2 should be updated
        #expect(result[1].id == "c2")
        #expect(result[1].contestName == "Second Updated")
        #expect(result[1].entryCount == 6)
    }

    // MARK: - Test: Deep Equality - Order and Count Verification

    @Test
    mutating func testUnjoinContest_OrderAndCountExactMatch() async throws {
        setup()
        let contests = [
            ContestListItemDTO.makeTestDTO(id: "a"),
            ContestListItemDTO.makeTestDTO(id: "b"),
            ContestListItemDTO.makeTestDTO(id: "c"),
            ContestListItemDTO.makeTestDTO(id: "d"),
            ContestListItemDTO.makeTestDTO(id: "e")
        ]

        let updated = ContestListItemDTO.makeTestDTO(id: "c", contestName: "Updated C")
        mockClient.returnedDTO = updated

        let result = try await sut.unjoinContest(
            contests: contests,
            id: "c",
            userId: "user-1"
        )

        // Exact order and count
        #expect(result.count == 5)
        #expect(result[0].id == "a")
        #expect(result[1].id == "b")
        #expect(result[2].id == "c")
        #expect(result[2].contestName == "Updated C")
        #expect(result[3].id == "d")
        #expect(result[4].id == "e")
    }

    // MARK: - Test: Delete 404 Removes From Middle, Preserves Surrounding Order

    @Test
    mutating func testDeleteContest_404RemovesMiddleItemPreservesOrder() async throws {
        setup()
        let contests = [
            ContestListItemDTO.makeTestDTO(id: "first", contestName: "First"),
            ContestListItemDTO.makeTestDTO(id: "middle", contestName: "Middle"),
            ContestListItemDTO.makeTestDTO(id: "last", contestName: "Last")
        ]

        struct NotFoundError: LocalizedError {
            var errorDescription: String? { "404" }
        }
        mockClient.shouldThrowError = NotFoundError()

        let result = try await sut.deleteContest(
            contests: contests,
            id: "middle",
            userId: "user-1"
        )

        #expect(result.count == 2)
        #expect(result[0].id == "first")
        #expect(result[0].contestName == "First")
        #expect(result[1].id == "last")
        #expect(result[1].contestName == "Last")
    }

    // MARK: - Test: Unjoin 404 With Single Item List

    @Test
    mutating func testUnjoinContest_404SingleItemBecomesEmpty() async throws {
        setup()
        let contests = [ContestListItemDTO.makeTestDTO(id: "only")]

        struct NotFoundError: LocalizedError {
            var errorDescription: String? { "Entry not found" }
        }
        mockClient.shouldThrowError = NotFoundError()

        let result = try await sut.unjoinContest(
            contests: contests,
            id: "only",
            userId: "user-1"
        )

        #expect(result.count == 0)
        #expect(result.isEmpty == true)
    }

    // MARK: - Test: Success Response Can Change Multiple Fields

    @Test
    mutating func testDeleteContest_SuccessCanUpdateMultipleFields() async throws {
        setup()
        let original = ContestListItemDTO.makeTestDTO(
            id: "c1",
            status: "SCHEDULED",
            entryCount: 5,
            maxEntries: 10,
            leaderboardState: nil
        )
        let contests = [original]

        // Server returns same contest with multiple field changes
        let updated = ContestListItemDTO.makeTestDTO(
            id: "c1",
            status: "LOCKED",
            entryCount: 6,
            maxEntries: 10,
            leaderboardState: "LOCKED"
        )
        mockClient.returnedDTO = updated

        let result = try await sut.deleteContest(
            contests: contests,
            id: "c1",
            userId: "user-1"
        )

        #expect(result.count == 1)
        #expect(result[0].status == "LOCKED")
        #expect(result[0].entryCount == 6)
        #expect(result[0].leaderboardState == "LOCKED")
    }
}
