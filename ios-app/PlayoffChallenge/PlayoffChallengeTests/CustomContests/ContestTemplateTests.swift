import XCTest
@testable import PlayoffChallenge

/// Tests for ContestTemplate model creation, validation, and encoding.
final class ContestTemplateTests: XCTestCase {

    // MARK: - ContestTemplate Creation Tests

    func test_template_creationWithRequiredFields() {
        let template = ContestTemplate(
            id: UUID(),
            name: "NFL Playoff Challenge",
            sportKey: "nfl",
            scoringStrategyKey: "nfl_playoff_standard",
            settlementStrategyKey: "winner_take_all"
        )

        XCTAssertEqual(template.name, "NFL Playoff Challenge")
        XCTAssertEqual(template.sportKey, "nfl")
        XCTAssertEqual(template.scoringStrategyKey, "nfl_playoff_standard")
        XCTAssertEqual(template.settlementStrategyKey, "winner_take_all")
        XCTAssertTrue(template.isActive)
    }

    func test_template_inactiveByDefault_whenSpecified() {
        let template = ContestTemplate(
            id: UUID(),
            name: "Disabled Template",
            sportKey: "nfl",
            scoringStrategyKey: "nfl_playoff_standard",
            settlementStrategyKey: "winner_take_all",
            isActive: false
        )

        XCTAssertFalse(template.isActive)
    }

    func test_template_withConstraints() {
        let constraints = TemplateConstraints(
            minEntries: 2,
            maxEntries: 100,
            allowedEntryFees: [0, 5, 10, 25]
        )
        let template = ContestTemplate(
            id: UUID(),
            name: "NFL Playoff Challenge",
            sportKey: "nfl",
            scoringStrategyKey: "nfl_playoff_standard",
            settlementStrategyKey: "winner_take_all",
            constraints: constraints
        )

        XCTAssertEqual(template.constraints.minEntries, 2)
        XCTAssertEqual(template.constraints.maxEntries, 100)
        XCTAssertEqual(template.constraints.allowedEntryFees, [0, 5, 10, 25])
    }

    // MARK: - TemplateConstraints Tests

    func test_constraints_defaultValues() {
        let constraints = TemplateConstraints()

        XCTAssertEqual(constraints.minEntries, 2)
        XCTAssertEqual(constraints.maxEntries, 1000)
        XCTAssertEqual(constraints.allowedEntryFees, [0])
    }

    func test_constraints_entryFeeIsAllowed_withAllowedFee() {
        let constraints = TemplateConstraints(allowedEntryFees: [0, 5, 10])

        XCTAssertTrue(constraints.isEntryFeeAllowed(5))
        XCTAssertTrue(constraints.isEntryFeeAllowed(0))
    }

    func test_constraints_entryFeeIsAllowed_withDisallowedFee() {
        let constraints = TemplateConstraints(allowedEntryFees: [0, 5, 10])

        XCTAssertFalse(constraints.isEntryFeeAllowed(25))
        XCTAssertFalse(constraints.isEntryFeeAllowed(7))
    }

    func test_constraints_maxEntriesIsWithinRange_valid() {
        let constraints = TemplateConstraints(minEntries: 2, maxEntries: 100)

        XCTAssertTrue(constraints.isMaxEntriesValid(2))
        XCTAssertTrue(constraints.isMaxEntriesValid(50))
        XCTAssertTrue(constraints.isMaxEntriesValid(100))
    }

    func test_constraints_maxEntriesIsWithinRange_invalid() {
        let constraints = TemplateConstraints(minEntries: 2, maxEntries: 100)

        XCTAssertFalse(constraints.isMaxEntriesValid(1))
        XCTAssertFalse(constraints.isMaxEntriesValid(101))
        XCTAssertFalse(constraints.isMaxEntriesValid(0))
    }

    // MARK: - ContestTemplate Encoding Tests

    func test_template_encodesToSnakeCaseJSON() throws {
        let fixedId = UUID(uuidString: "12345678-1234-1234-1234-123456789012")!
        let fixedDate = Date(timeIntervalSince1970: 1704067200)

        let template = ContestTemplate(
            id: fixedId,
            name: "NFL Playoff Challenge",
            sportKey: "nfl",
            scoringStrategyKey: "nfl_playoff_standard",
            settlementStrategyKey: "winner_take_all",
            isActive: true,
            createdAt: fixedDate
        )

        let encoder = JSONEncoder()
        let data = try encoder.encode(template)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(json["id"] as? String, "12345678-1234-1234-1234-123456789012")
        XCTAssertEqual(json["name"] as? String, "NFL Playoff Challenge")
        XCTAssertEqual(json["sport_key"] as? String, "nfl")
        XCTAssertEqual(json["scoring_strategy_key"] as? String, "nfl_playoff_standard")
        XCTAssertEqual(json["settlement_strategy_key"] as? String, "winner_take_all")
        XCTAssertEqual(json["is_active"] as? Bool, true)
    }

    func test_template_decodesFromSnakeCaseJSON() throws {
        let json = """
        {
            "id": "ABCD1234-ABCD-ABCD-ABCD-ABCD12345678",
            "name": "NFL Playoff Challenge",
            "sport_key": "nfl",
            "scoring_strategy_key": "nfl_playoff_standard",
            "settlement_strategy_key": "winner_take_all",
            "constraints": {
                "min_entries": 2,
                "max_entries": 50,
                "allowed_entry_fees": [0, 5, 10]
            },
            "is_active": true,
            "created_at": 1704067200
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        let template = try decoder.decode(ContestTemplate.self, from: json)

        XCTAssertEqual(template.id.uuidString, "ABCD1234-ABCD-ABCD-ABCD-ABCD12345678")
        XCTAssertEqual(template.name, "NFL Playoff Challenge")
        XCTAssertEqual(template.sportKey, "nfl")
        XCTAssertEqual(template.scoringStrategyKey, "nfl_playoff_standard")
        XCTAssertEqual(template.settlementStrategyKey, "winner_take_all")
        XCTAssertEqual(template.constraints.minEntries, 2)
        XCTAssertEqual(template.constraints.maxEntries, 50)
        XCTAssertEqual(template.constraints.allowedEntryFees, [0, 5, 10])
        XCTAssertTrue(template.isActive)
    }

    // MARK: - Equatable Tests

    func test_template_equatable() {
        let id = UUID()
        let date = Date()

        let template1 = ContestTemplate(
            id: id,
            name: "Test",
            sportKey: "nfl",
            scoringStrategyKey: "standard",
            settlementStrategyKey: "winner_take_all",
            createdAt: date
        )
        let template2 = ContestTemplate(
            id: id,
            name: "Test",
            sportKey: "nfl",
            scoringStrategyKey: "standard",
            settlementStrategyKey: "winner_take_all",
            createdAt: date
        )
        let template3 = ContestTemplate(
            id: UUID(),
            name: "Test",
            sportKey: "nfl",
            scoringStrategyKey: "standard",
            settlementStrategyKey: "winner_take_all",
            createdAt: date
        )

        XCTAssertEqual(template1, template2)
        XCTAssertNotEqual(template1, template3)
    }

    func test_constraints_equatable() {
        let constraints1 = TemplateConstraints(minEntries: 2, maxEntries: 100)
        let constraints2 = TemplateConstraints(minEntries: 2, maxEntries: 100)
        let constraints3 = TemplateConstraints(minEntries: 5, maxEntries: 100)

        XCTAssertEqual(constraints1, constraints2)
        XCTAssertNotEqual(constraints1, constraints3)
    }
}

// MARK: - ContestTemplateValidation Tests

final class ContestTemplateValidationTests: XCTestCase {

    // MARK: - Template Validation

    func test_validateTemplate_withValidTemplate_returnsNil() {
        let template = ContestTemplate(
            id: UUID(),
            name: "Valid Template",
            sportKey: "nfl",
            scoringStrategyKey: "standard",
            settlementStrategyKey: "winner_take_all"
        )

        let result = ContestTemplateValidation.validateTemplate(template)
        XCTAssertNil(result)
    }

    func test_validateTemplate_withEmptyName_returnsError() {
        let template = ContestTemplate(
            id: UUID(),
            name: "",
            sportKey: "nfl",
            scoringStrategyKey: "standard",
            settlementStrategyKey: "winner_take_all"
        )

        let result = ContestTemplateValidation.validateTemplate(template)
        XCTAssertEqual(result, .templateNameRequired)
    }

    func test_validateTemplate_withEmptySportKey_returnsError() {
        let template = ContestTemplate(
            id: UUID(),
            name: "Valid Name",
            sportKey: "",
            scoringStrategyKey: "standard",
            settlementStrategyKey: "winner_take_all"
        )

        let result = ContestTemplateValidation.validateTemplate(template)
        XCTAssertEqual(result, .sportKeyRequired)
    }

    func test_validateTemplate_withEmptyScoringKey_returnsError() {
        let template = ContestTemplate(
            id: UUID(),
            name: "Valid Name",
            sportKey: "nfl",
            scoringStrategyKey: "",
            settlementStrategyKey: "winner_take_all"
        )

        let result = ContestTemplateValidation.validateTemplate(template)
        XCTAssertEqual(result, .scoringStrategyKeyRequired)
    }

    func test_validateTemplate_withEmptySettlementKey_returnsError() {
        let template = ContestTemplate(
            id: UUID(),
            name: "Valid Name",
            sportKey: "nfl",
            scoringStrategyKey: "standard",
            settlementStrategyKey: ""
        )

        let result = ContestTemplateValidation.validateTemplate(template)
        XCTAssertEqual(result, .settlementStrategyKeyRequired)
    }

    // MARK: - Instance Against Template Validation

    func test_validateInstanceAgainstTemplate_withValidSettings_returnsNil() {
        let template = ContestTemplate(
            id: UUID(),
            name: "NFL Template",
            sportKey: "nfl",
            scoringStrategyKey: "standard",
            settlementStrategyKey: "winner_take_all",
            constraints: TemplateConstraints(
                minEntries: 2,
                maxEntries: 100,
                allowedEntryFees: [0, 5, 10]
            )
        )

        let result = ContestTemplateValidation.validateInstanceSettings(
            maxEntries: 50,
            entryFee: 5,
            against: template
        )
        XCTAssertNil(result)
    }

    func test_validateInstanceAgainstTemplate_withMaxEntriesTooLow_returnsError() {
        let template = ContestTemplate(
            id: UUID(),
            name: "NFL Template",
            sportKey: "nfl",
            scoringStrategyKey: "standard",
            settlementStrategyKey: "winner_take_all",
            constraints: TemplateConstraints(minEntries: 10, maxEntries: 100)
        )

        let result = ContestTemplateValidation.validateInstanceSettings(
            maxEntries: 5,
            entryFee: 0,
            against: template
        )
        XCTAssertEqual(result, .maxEntriesBelowTemplateMinimum(minimum: 10))
    }

    func test_validateInstanceAgainstTemplate_withMaxEntriesTooHigh_returnsError() {
        let template = ContestTemplate(
            id: UUID(),
            name: "NFL Template",
            sportKey: "nfl",
            scoringStrategyKey: "standard",
            settlementStrategyKey: "winner_take_all",
            constraints: TemplateConstraints(minEntries: 2, maxEntries: 50)
        )

        let result = ContestTemplateValidation.validateInstanceSettings(
            maxEntries: 100,
            entryFee: 0,
            against: template
        )
        XCTAssertEqual(result, .maxEntriesAboveTemplateMaximum(maximum: 50))
    }

    func test_validateInstanceAgainstTemplate_withDisallowedEntryFee_returnsError() {
        let template = ContestTemplate(
            id: UUID(),
            name: "NFL Template",
            sportKey: "nfl",
            scoringStrategyKey: "standard",
            settlementStrategyKey: "winner_take_all",
            constraints: TemplateConstraints(allowedEntryFees: [0, 5, 10])
        )

        let result = ContestTemplateValidation.validateInstanceSettings(
            maxEntries: 50,
            entryFee: 25,
            against: template
        )
        XCTAssertEqual(result, .entryFeeNotAllowed(allowed: [0, 5, 10]))
    }

    func test_validateInstanceAgainstTemplate_withInactiveTemplate_returnsError() {
        let template = ContestTemplate(
            id: UUID(),
            name: "Inactive Template",
            sportKey: "nfl",
            scoringStrategyKey: "standard",
            settlementStrategyKey: "winner_take_all",
            isActive: false
        )

        let result = ContestTemplateValidation.validateInstanceSettings(
            maxEntries: 50,
            entryFee: 0,
            against: template
        )
        XCTAssertEqual(result, .templateNotActive)
    }
}
