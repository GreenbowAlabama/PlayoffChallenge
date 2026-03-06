//
//  RulesSection.swift
//  PlayoffChallenge
//
//  Data model for contest rules sections
//

import Foundation

struct RulesSection: Identifiable, Hashable {
    let id: UUID
    let title: String
    let contentDescription: String

    init(title: String, contentDescription: String) {
        self.id = UUID()
        self.title = title
        self.contentDescription = contentDescription
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: RulesSection, rhs: RulesSection) -> Bool {
        lhs.id == rhs.id
    }
}
