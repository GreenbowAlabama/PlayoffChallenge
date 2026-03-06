//
//  ContestRulesViewModel.swift
//  PlayoffChallenge
//
//  Generic rules state management for any contest type
//

import Foundation
import Combine

// MARK: - Rules Section Model

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

// MARK: - View Model

@MainActor
final class ContestRulesViewModel: ObservableObject {
    @Published var rulesData: [String: Any]?
    @Published var sections: [RulesSection] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    let contestId: UUID

    init(contestId: UUID) {
        self.contestId = contestId
    }

    func loadRules() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let data = try await APIService.shared.getContestRules(contestId: contestId)
            self.rulesData = data
            self.sections = parseRulesData(data)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func parseRulesData(_ data: [String: Any]) -> [RulesSection] {
        // Convert backend JSON to generic sections for display
        // Sort keys alphabetically for consistent ordering
        let sortedKeys = data.keys.sorted()

        return sortedKeys.map { key in
            let value = data[key] ?? ""
            let contentDescription = formatValue(value)
            return RulesSection(title: humanize(key), contentDescription: contentDescription)
        }
    }

    private func formatValue(_ value: Any) -> String {
        if let string = value as? String {
            return string
        } else if let number = value as? NSNumber {
            return "\(number)"
        } else if let dict = value as? [String: Any] {
            return dict
                .sorted(by: { $0.key < $1.key })
                .map { "\($0.key): \(formatValue($0.value))" }
                .joined(separator: "; ")
        } else if let array = value as? [Any] {
            return array.map { formatValue($0) }.joined(separator: ", ")
        } else {
            return "\(value)"
        }
    }

    private func humanize(_ text: String) -> String {
        return text
            .replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { word in String(word).prefix(1).uppercased() + String(word).dropFirst() }
            .joined(separator: " ")
    }
}
