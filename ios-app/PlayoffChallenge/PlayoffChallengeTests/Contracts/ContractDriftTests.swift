//
//  ContractDriftTests.swift
//  PlayoffChallengeTests
//
//  Fixture-based contract drift detection.
//  Verifies required fields are present and decode is strict.
//

import XCTest
@testable import PlayoffChallenge

final class ContractDriftTests: XCTestCase {

    // MARK: - ContestDetailResponseContract Required Fields

    @MainActor func testContestDetailContractValidFixtureDecodes() {
        let json = ContestDetailContractFixtures.validContractJSON.data(using: .utf8)!
        let decoder = JSONDecoder()

        let contract = try? decoder.decode(ContestDetailResponseContract.self, from: json)
        XCTAssertNotNil(contract, "Valid fixture must decode")
    }

    @MainActor func testContestDetailContractMissingActionsThrows() {
        let json = ContestDetailContractFixtures.missingActionsJSON.data(using: .utf8)!
        let decoder = JSONDecoder()

        var threwError = false
        do {
            _ = try decoder.decode(ContestDetailResponseContract.self, from: json)
        } catch {
            threwError = true
        }

        XCTAssertTrue(threwError, "Missing required 'actions' must fail decode")
    }

    @MainActor func testContestDetailContractMissingPayoutTableThrows() {
        let json = ContestDetailContractFixtures.missingPayoutTableJSON.data(using: .utf8)!
        let decoder = JSONDecoder()

        var threwError = false
        do {
            _ = try decoder.decode(ContestDetailResponseContract.self, from: json)
        } catch {
            threwError = true
        }

        XCTAssertTrue(threwError, "Missing required 'payout_table' must fail decode")
    }

    @MainActor func testContestDetailContractMissingRosterConfigThrows() {
        let json = ContestDetailContractFixtures.missingRosterConfigJSON.data(using: .utf8)!
        let decoder = JSONDecoder()

        var threwError = false
        do {
            _ = try decoder.decode(ContestDetailResponseContract.self, from: json)
        } catch {
            threwError = true
        }

        XCTAssertTrue(threwError, "Missing required 'roster_config' must fail decode")
    }

    // MARK: - LeaderboardResponseContract Required Fields

    @MainActor func testLeaderboardContractValidComputedFixtureDecodes() {
        let json = LeaderboardContractFixtures.validComputedJSON.data(using: .utf8)!
        let decoder = JSONDecoder()

        let contract = try? decoder.decode(LeaderboardResponseContract.self, from: json)
        XCTAssertNotNil(contract, "Valid computed fixture must decode")

        guard let contract = contract else { return }
        XCTAssertEqual(contract.leaderboard_state, .computed)
        XCTAssertEqual(contract.rows.count, 1)
    }

    @MainActor func testLeaderboardContractValidPendingFixtureDecodes() {
        let json = LeaderboardContractFixtures.validPendingJSON.data(using: .utf8)!
        let decoder = JSONDecoder()

        let contract = try? decoder.decode(LeaderboardResponseContract.self, from: json)
        XCTAssertNotNil(contract, "Valid pending fixture must decode")

        guard let contract = contract else { return }
        XCTAssertEqual(contract.leaderboard_state, .pending)
        XCTAssertEqual(contract.rows.count, 0)
    }

    @MainActor func testLeaderboardContractValidErrorFixtureDecodes() {
        let json = LeaderboardContractFixtures.validErrorJSON.data(using: .utf8)!
        let decoder = JSONDecoder()

        let contract = try? decoder.decode(LeaderboardResponseContract.self, from: json)
        XCTAssertNotNil(contract, "Valid error fixture must decode")

        guard let contract = contract else { return }
        XCTAssertEqual(contract.leaderboard_state, .error)
    }

    @MainActor func testLeaderboardContractMissingLeaderboardStateThrows() {
        let json = LeaderboardContractFixtures.missingLeaderboardStateJSON.data(using: .utf8)!
        let decoder = JSONDecoder()

        var threwError = false
        do {
            _ = try decoder.decode(LeaderboardResponseContract.self, from: json)
        } catch {
            threwError = true
        }

        XCTAssertTrue(threwError, "Missing required 'leaderboard_state' must fail decode")
    }

    @MainActor func testLeaderboardContractMissingColumnSchemaThrows() {
        let json = LeaderboardContractFixtures.missingColumnSchemaJSON.data(using: .utf8)!
        let decoder = JSONDecoder()

        var threwError = false
        do {
            _ = try decoder.decode(LeaderboardResponseContract.self, from: json)
        } catch {
            threwError = true
        }

        XCTAssertTrue(threwError, "Missing required 'column_schema' must fail decode")
    }

    @MainActor func testLeaderboardContractMissingRowsThrows() {
        let json = LeaderboardContractFixtures.missingRowsJSON.data(using: .utf8)!
        let decoder = JSONDecoder()

        var threwError = false
        do {
            _ = try decoder.decode(LeaderboardResponseContract.self, from: json)
        } catch {
            threwError = true
        }

        XCTAssertTrue(threwError, "Missing required 'rows' must fail decode")
    }

    // MARK: - State Is Source of Truth

    @MainActor func testLeaderboardStateIsSourceOfTruth() {
        let json = LeaderboardContractFixtures.validPendingJSON.data(using: .utf8)!
        let decoder = JSONDecoder()

        let contract = try? decoder.decode(LeaderboardResponseContract.self, from: json)
        guard let contract = contract else {
            XCTFail("Could not decode fixture")
            return
        }

        // State enum must drive UI, not row count
        XCTAssertEqual(contract.leaderboard_state, .pending, "State must be present and respected")
        XCTAssertTrue(contract.rows.isEmpty, "Pending state can have empty rows")
    }

    @MainActor func testContestDetailActionsMustBePresent() {
        let json = ContestDetailContractFixtures.validContractJSON.data(using: .utf8)!
        let decoder = JSONDecoder()

        let contract = try? decoder.decode(ContestDetailResponseContract.self, from: json)
        guard let contract = contract else {
            XCTFail("Could not decode fixture")
            return
        }

        XCTAssertNotNil(contract.actions, "actions must be present in contract")
        XCTAssertFalse(contract.actions.can_join, "can_join property accessible")
    }
}
