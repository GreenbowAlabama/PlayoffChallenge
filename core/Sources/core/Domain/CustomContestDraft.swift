//
//  CustomContestDraft.swift
//  core
//
//  Domain model for a custom contest draft.
//

import Foundation

/// CustomContestDraft domain model representing an in-progress custom contest creation.
/// Immutable, Codable, Hashable, Equatable, and Sendable.
public struct CustomContestDraft: Codable, Hashable, Equatable, Sendable {
    public let id: UUID
    public let name: String
    public let templateId: String
    public let settings: CustomContestSettings
    public let payoutStructure: PayoutStructure
    
    public init(id: UUID, name: String, templateId: String, settings: CustomContestSettings, payoutStructure: PayoutStructure) {
        self.id = id
        self.name = name
        self.templateId = templateId
        self.settings = settings
        self.payoutStructure = payoutStructure
    }
    
    enum CodingKeys: String, CodingKey {
        case id
        case name
        case templateId = "template_id"
        case settings
        case payoutStructure = "payout_structure"
    }
    
    // MARK: - Testing Factory
    /// Stub factory for testing.
    public static func stub(
        id: UUID = UUID(),
        name: String = "My Draft",
        templateId: String = "template-1",
        settings: CustomContestSettings = CustomContestSettings.stub(),
        payoutStructure: PayoutStructure = PayoutStructure.stub()
    ) -> CustomContestDraft {
        return CustomContestDraft(
            id: id,
            name: name,
            templateId: templateId,
            settings: settings,
            payoutStructure: payoutStructure
        )
    }
}
