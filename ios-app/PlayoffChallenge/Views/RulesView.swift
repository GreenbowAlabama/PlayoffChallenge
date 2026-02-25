//  RulesView.swift
//  PlayoffChallenge
//
//  Simplified with Better Error Handling
//

import SwiftUI
import Combine

struct RulesView: View {
    @StateObject private var viewModel = RulesViewModel()
    @State private var selectedTab = 0

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                Picker("", selection: $selectedTab) {
                    Text("Rules").tag(0)
                    Text("Scoring").tag(1)
                }
                .pickerStyle(.segmented)
                .padding()

                TabView(selection: $selectedTab) {
                    RulesTab(viewModel: viewModel)
                        .tag(0)

                    ScoringTab(viewModel: viewModel)
                        .tag(1)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            }
            .navigationTitle("Game Info")
            .task {
                await viewModel.loadAllData()
            }
            .refreshable {
                await viewModel.loadAllData()
            }
        }
    }
}

// MARK: - Rules Tab
struct RulesTab: View {
    @ObservedObject var viewModel: RulesViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.xl) {
                if viewModel.isLoading {
                    ProgressView("Loading rules...")
                        .frame(maxWidth: .infinity)
                        .padding()
                } else if let error = viewModel.errorMessage {
                    ErrorView(message: error)
                } else if viewModel.rulesContent.isEmpty {
                    ErrorView(message: "No rules found. Check back later!")
                } else {
                    let allowedSections = ["overview", "main_rules", "player_selection", "deadlines"]
                    let filteredRules = viewModel.rulesContent.filter {
                        allowedSections.contains($0.section)
                    }

                    let sortedRules = filteredRules.sorted { rule1, rule2 in
                        let order = [
                            "overview": 0,
                            "main_rules": 1,
                            "player_selection": 2,
                            "deadlines": 3
                        ]
                        return (order[rule1.section] ?? 99) < (order[rule2.section] ?? 99)
                    }

                    ForEach(sortedRules) { rule in
                        RuleCard(rule: rule, gameSettings: viewModel.gameSettings)
                    }
                }
            }
            .padding()
        }
    }
}

struct RuleCard: View {
    let rule: RulesContent
    var gameSettings: GameSettings?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(sectionTitle(for: rule.section))
                .font(.headline)
                .foregroundColor(.blue)

            Text(displayContent())
                .font(.body)
                .foregroundColor(.primary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding()
        .background(DesignTokens.Color.Surface.card)
        .cornerRadius(DesignTokens.Radius.lg)
    }

    func displayContent() -> String {
        if rule.section.lowercased() == "player_selection",
           let settings = gameSettings {

            let positions: [(Int?, String)] = [
                (settings.qbLimit, "QB"),
                (settings.rbLimit, "RB"),
                (settings.wrLimit, "WR"),
                (settings.teLimit, "TE"),
                (settings.kLimit, "K"),
                (settings.defLimit, "DEF")
            ]

            let positionList = positions.compactMap { limit, name -> String? in
                guard let count = limit, count > 0 else { return nil }
                return "\(count) \(name)"
            }
            .joined(separator: ", ")

            return "Select \(positionList) for each playoff week."
        }

        return rule.content
    }

    func sectionTitle(for section: String) -> String {
        switch section.lowercased() {
        case "overview": return "Overview"
        case "main_rules": return "How It Works"
        case "player_selection": return "Player Selection"
        case "scoring": return "Scoring"
        case "multipliers": return "Multipliers"
        case "payouts": return "Payouts"
        case "deadlines": return "Deadlines"
        default: return section.capitalized
        }
    }
}

// MARK: - Scoring Tab
struct ScoringTab: View {
    @ObservedObject var viewModel: RulesViewModel

    var body: some View {
        ScrollView {
            VStack(spacing: DesignTokens.Spacing.xl) {
                if viewModel.isLoading {
                    ProgressView("Loading scoring rules...")
                        .frame(maxWidth: .infinity)
                        .padding()
                } else if viewModel.scoringRules.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "list.bullet")
                            .font(.largeTitle)
                            .foregroundColor(.orange)

                        Text("No scoring rules available")
                            .font(.body)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                } else {
                    Text("Playoff Challenge Scoring")
                        .font(.title2)
                        .fontWeight(.bold)
                        .padding(.top)

                    Text("Points are awarded based on player statistics")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(.bottom)

                    let categorizedRules = viewModel.scoringRules.map { rule -> ScoringRule in
                        if rule.category.lowercased() == "special" {
                            return ScoringRule(
                                id: rule.id,
                                category: "defense",
                                statName: rule.statName,
                                points: rule.points,
                                description: rule.description,
                                isActive: rule.isActive,
                                displayOrder: rule.displayOrder
                            )
                        }
                        return rule
                    }

                    let categories = Dictionary(grouping: categorizedRules, by: { $0.category })

                    let categoryOrder = ["passing", "rushing", "receiving", "kicking", "defense"]
                    let sortedCategories = categories.keys.sorted { cat1, cat2 in
                        let index1 = categoryOrder.firstIndex(of: cat1.lowercased()) ?? 999
                        let index2 = categoryOrder.firstIndex(of: cat2.lowercased()) ?? 999
                        return index1 < index2
                    }

                    ForEach(sortedCategories, id: \.self) { category in
                        VStack(alignment: .leading, spacing: 12) {
                            Text(friendlyCategoryName(category))
                                .font(.headline)
                                .foregroundColor(.blue)
                                .padding(.top, 8)

                            VStack(spacing: 8) {
                                ForEach(categories[category] ?? []) { rule in
                                    ScoringRuleRow(rule: rule)
                                }
                            }
                        }
                        .padding(.horizontal)
                    }
                }
            }
            .padding()
        }
    }

    private func friendlyCategoryName(_ category: String) -> String {
        switch category.lowercased() {
        case "passing": return "Passing"
        case "rushing": return "Rushing"
        case "receiving": return "Receiving"
        case "kicking": return "Kicking"
        case "defense", "special": return "Defense/Special Teams"
        default: return category.capitalized
        }
    }
}

struct ScoringRuleRow: View {
    let rule: ScoringRule

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(friendlyStatName(rule.statName))
                    .font(.body)
                    .fontWeight(.medium)

                if let description = rule.description {
                    Text(description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            Text(formatPoints(rule.points))
                .font(.body)
                .fontWeight(.semibold)
                .foregroundColor(rule.points >= 0 ? .green : .red)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
        .background(DesignTokens.Color.Surface.card)
        .cornerRadius(DesignTokens.Radius.md)
    }

    private func friendlyStatName(_ statName: String) -> String {
        let friendlyNames: [String: String] = [
            "pass_yd": "Passing Yards",
            "pass_td": "Passing TD",
            "pass_int": "Interceptions",
            "pass_2pt": "2-Point Conversion (Pass)",
            "rush_yd": "Rushing Yards",
            "rush_td": "Rushing TD",
            "rush_2pt": "2-Point Conversion (Rush)",
            "rec": "Receptions",
            "rec_yd": "Receiving Yards",
            "rec_td": "Receiving TD",
            "rec_2pt": "2-Point Conversion (Rec)",
            "fum_lost": "Fumbles Lost",
            "fum_rec_td": "Fumble Recovery TD",
            "fgm": "Field Goal Made",
            "fg_made": "Field Goal Made",
            "fg_miss": "Field Goal Missed",
            "xp_made": "Extra Point Made",
            "xp_miss": "Extra Point Missed",
            "def_td": "Defensive/ST TD",
            "def_int": "Interceptions",
            "def_fum_rec": "Fumble Recoveries",
            "def_sack": "Sacks",
            "def_safety": "Safeties",
            "def_block": "Blocked Kicks",
            "pts_allowed": "Points Allowed"
        ]

        return friendlyNames[statName] ?? statName.replacingOccurrences(of: "_", with: " ").capitalized
    }

    private func formatPoints(_ points: Double) -> String {
        if points >= 0 {
            return "+\(String(format: "%.2f", points))"
        } else {
            return String(format: "%.2f", points)
        }
    }
}


// MARK: - Error View
struct ErrorView: View {
    let message: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundColor(.orange)

            Text(message)
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding()
    }
}

// MARK: - View Model
@MainActor
class RulesViewModel: ObservableObject {
    @Published var rulesContent: [RulesContent] = []
    @Published var payoutResponse: PayoutResponse?
    @Published var scoringRules: [ScoringRule] = []
    @Published var positionRequirements: [PositionRequirement] = []
    @Published var gameSettings: GameSettings?
    @Published var isLoading = false
    @Published var errorMessage: String?

    func loadAllData() async {
        isLoading = true
        errorMessage = nil

        do {
            rulesContent = try await APIService.shared.getRules()
            payoutResponse = try await APIService.shared.getPayouts()
            scoringRules = try await APIService.shared.getScoringRules()
            gameSettings = try await APIService.shared.getSettings()
        } catch {
            errorMessage = "Failed to load game information"
        }

        isLoading = false
    }
}

#Preview {
    RulesView()
}
