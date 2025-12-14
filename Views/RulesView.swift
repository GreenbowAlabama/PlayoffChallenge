//
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
                    Text("Payouts").tag(2)
                }
                .pickerStyle(.segmented)
                .padding()
                
                TabView(selection: $selectedTab) {
                    RulesTab(viewModel: viewModel)
                        .tag(0)
                    
                    ScoringTab(viewModel: viewModel)
                        .tag(1)
                    
                    PayoutsTab(viewModel: viewModel)
                        .tag(2)
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
            VStack(alignment: .leading, spacing: 20) {
                if viewModel.isLoading {
                    ProgressView("Loading rules...")
                        .frame(maxWidth: .infinity)
                        .padding()
                } else if let error = viewModel.errorMessage {
                    ErrorView(message: error)
                } else if viewModel.rulesContent.isEmpty {
                    ErrorView(message: "No rules found. Check back later!")
                } else {
                    // Show Overview, Main Rules, Player Selection, and Deadlines sections
                    let allowedSections = ["overview", "main_rules", "player_selection", "deadlines"]
                    let filteredRules = viewModel.rulesContent.filter { allowedSections.contains($0.section) }

                    // Sort by custom order: overview, main_rules, player_selection, deadlines
                    let sortedRules = filteredRules.sorted { rule1, rule2 in
                        let order = ["overview": 0, "main_rules": 1, "player_selection": 2, "deadlines": 3]
                        return (order[rule1.section] ?? 99) < (order[rule2.section] ?? 99)
                    }

                    ForEach(sortedRules) { rule in
                        RuleCard(rule: rule, positionRequirements: viewModel.positionRequirements)
                    }

                    // Payment Handles Section at the bottom
                    PaymentHandlesSection(gameSettings: viewModel.gameSettings)
                }
            }
            .padding()
        }
    }
}

struct RuleCard: View {
    let rule: RulesContent
    var positionRequirements: [PositionRequirement] = []

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
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }

    func displayContent() -> String {
        // For player_selection section, generate dynamic content from API
        if rule.section.lowercased() == "player_selection" && !positionRequirements.isEmpty {
            let activeReqs = positionRequirements.filter { $0.isActive }
                .sorted { $0.displayOrder < $1.displayOrder }

            let positionList = activeReqs.map { req in
                let count = req.requiredCount
                let name = req.displayName
                return "\(count) \(name)\(count > 1 ? "s" : "")"
            }.joined(separator: ", ")

            // Remove the hardcoded "Choose wisely" part and just return the first sentence
            let parts = rule.content.components(separatedBy: ". ")
            if let firstPart = parts.first {
                // Replace the hardcoded positions with dynamic ones
                return "Select \(positionList) for each playoff week."
            }
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
            VStack(spacing: 20) {
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

                    // Group scoring rules by category, combining defense and special
                    let categorizedRules = viewModel.scoringRules.map { rule -> ScoringRule in
                        var modifiedRule = rule
                        // Combine defense and special into "defense"
                        if rule.category.lowercased() == "special" {
                            var mutableRule = rule
                            // Create a new ScoringRule with modified category
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

                    // Custom sort order: Passing, Rushing, Receiving, Kicking, Defense/Special Teams
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
        case "defense": return "Defense/Special Teams"
        case "special": return "Defense/Special Teams"
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
        .background(Color(.systemGray6))
        .cornerRadius(8)
    }

    private func friendlyStatName(_ statName: String) -> String {
        let friendlyNames: [String: String] = [
            // Passing
            "pass_yd": "Passing Yards",
            "pass_td": "Passing TD",
            "pass_int": "Interceptions",
            "pass_2pt": "2-Point Conversion (Pass)",

            // Rushing
            "rush_yd": "Rushing Yards",
            "rush_td": "Rushing TD",
            "rush_2pt": "2-Point Conversion (Rush)",

            // Receiving
            "rec": "Receptions",
            "rec_yd": "Receiving Yards",
            "rec_td": "Receiving TD",
            "rec_2pt": "2-Point Conversion (Rec)",

            // Other offense
            "fum_lost": "Fumbles Lost",
            "fum_rec_td": "Fumble Recovery TD",

            // Kicking
            "fgm_0_19": "Field Goal Made 0-19 Yards",
            "fgm_20_29": "Field Goal Made 20-29 Yards",
            "fgm_30_39": "Field Goal Made 30-39 Yards",
            "fgm_40_49": "Field Goal Made 40-49 Yards",
            "fgm_50p": "Field Goal Made 50+ Yards",
            "fgmiss": "Field Goal Missed",
            "xpm": "Extra Point Made",
            "xpmiss": "Extra Point Missed",
            "fgm": "Field Goal Made",
            "fg_made": "Field Goal Made",
            "fg_miss": "Field Goal Missed",
            "xp_made": "Extra Point Made",
            "xp_miss": "Extra Point Missed",

            // Defense
            "def_td": "Defensive/ST TD",
            "def_int": "Interceptions",
            "def_fum_rec": "Fumble Recoveries",
            "def_sack": "Sacks",
            "def_safety": "Safeties",
            "def_block": "Blocked Kicks",
            "pts_allowed": "Points Allowed",

            // Bonus
            "bonus_pass_yd_300": "300+ Passing Yards Bonus",
            "bonus_pass_yd_400": "400+ Passing Yards Bonus",
            "bonus_rush_yd_100": "100+ Rushing Yards Bonus",
            "bonus_rush_yd_200": "200+ Rushing Yards Bonus",
            "bonus_rec_yd_100": "100+ Receiving Yards Bonus",
            "bonus_rec_yd_200": "200+ Receiving Yards Bonus"
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

// MARK: - Payouts Tab
struct PayoutsTab: View {
    @ObservedObject var viewModel: RulesViewModel
    
    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                if viewModel.isLoading {
                    ProgressView("Loading payouts...")
                        .frame(maxWidth: .infinity)
                        .padding()
                } else if let error = viewModel.errorMessage {
                    ErrorView(message: error)
                } else if let payoutResponse = viewModel.payoutResponse {
                    PrizePoolCard(
                        totalPot: String(format: "$%.0f", payoutResponse.totalPot),
                        entryAmount: payoutResponse.entryAmount,
                        paidUsers: payoutResponse.paidUsers
                    )
                    
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Prize Distribution")
                            .font(.title2)
                            .fontWeight(.bold)
                        
                        ForEach(payoutResponse.payouts) { payout in
                            PayoutRow(payout: payout)
                        }
                    }
                    .padding()
                } else {
                    ErrorView(message: "No payout information available")
                }
            }
            .padding()
        }
    }
}

struct PrizePoolCard: View {
    let totalPot: String
    let entryAmount: Double
    let paidUsers: Int
    
    var body: some View {
        VStack(spacing: 16) {
            Text("Total Prize Pool")
                .font(.headline)
                .foregroundColor(.secondary)
            
            Text(totalPot)
                .font(.system(size: 48, weight: .bold))
                .foregroundColor(.green)
            
            HStack(spacing: 24) {
                VStack {
                    Text("Entry")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text("$\(String(format: "%.0f", entryAmount))")
                        .font(.title3)
                        .fontWeight(.semibold)
                }
                
                Divider()
                    .frame(height: 40)
                
                VStack {
                    Text("Paid Users")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text("\(paidUsers)")
                        .font(.title3)
                        .fontWeight(.semibold)
                }
            }
        }
        .padding()
        .background(
            LinearGradient(
                gradient: Gradient(colors: [Color.blue.opacity(0.1), Color.green.opacity(0.1)]),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .cornerRadius(16)
    }
}

struct PayoutRow: View {
    let payout: Payout
    
    var body: some View {
        HStack {
            Circle()
                .fill(placeColor)
                .frame(width: 40, height: 40)
                .overlay(
                    Text(ordinal(payout.place))
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                )
            
            VStack(alignment: .leading, spacing: 4) {
                Text("\(ordinal(payout.place)) Place")
                    .font(.body)
                    .fontWeight(.semibold)
                
                Text("\(String(format: "%.0f", payout.percentage))%")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
            
            Text("$\(String(format: "%.0f", payout.amount))")
                .font(.title3)
                .fontWeight(.bold)
                .foregroundColor(.green)
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
    
    private var placeColor: Color {
        switch payout.place {
        case 1: return .yellow
        case 2: return .gray
        case 3: return Color.orange
        default: return .blue
        }
    }
    
    private func ordinal(_ n: Int) -> String {
        switch n {
        case 1: return "1st"
        case 2: return "2nd"
        case 3: return "3rd"
        default: return "\(n)th"
        }
    }
}

// MARK: - Payment Handles Section
struct PaymentHandlesSection: View {
    let gameSettings: GameSettings?

    var body: some View {
        if let settings = gameSettings, hasAnyHandle(settings) {
            VStack(alignment: .leading, spacing: 16) {
                Text("Payment Information")
                    .font(.headline)
                    .foregroundColor(.blue)

                Text("Payments should be made to ONE of the following handles for the entry amount:")
                    .font(.body)
                    .foregroundColor(.primary)

                VStack(spacing: 12) {
                    if let venmo = settings.venmoHandle, !venmo.isEmpty {
                        PaymentHandleRow(platform: "Venmo", handle: venmo, icon: "dollarsign.circle.fill", color: .blue)
                    }

                    if let cashapp = settings.cashappHandle, !cashapp.isEmpty {
                        PaymentHandleRow(platform: "Cash App", handle: cashapp, icon: "dollarsign.square.fill", color: .green)
                    }

                    if let zelle = settings.zelleHandle, !zelle.isEmpty {
                        PaymentHandleRow(platform: "Zelle", handle: zelle, icon: "banknote.fill", color: .purple)
                    }
                }

                Text("Entry Amount: $\(String(format: "%.0f", settings.entryAmount))")
                    .font(.callout)
                    .fontWeight(.semibold)
                    .foregroundColor(.green)
                    .padding(.top, 8)
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(12)
        }
    }

    private func hasAnyHandle(_ settings: GameSettings) -> Bool {
        return (settings.venmoHandle != nil && !settings.venmoHandle!.isEmpty) ||
               (settings.cashappHandle != nil && !settings.cashappHandle!.isEmpty) ||
               (settings.zelleHandle != nil && !settings.zelleHandle!.isEmpty)
    }
}

struct PaymentHandleRow: View {
    let platform: String
    let handle: String
    let icon: String
    let color: Color

    @State private var showCopiedMessage = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(color)
                .frame(width: 30)

            VStack(alignment: .leading, spacing: 4) {
                Text(platform)
                    .font(.caption)
                    .foregroundColor(.secondary)

                Text(handle)
                    .font(.body)
                    .fontWeight(.medium)
                    .foregroundColor(.primary)
            }

            Spacer()

            Button(action: {
                UIPasteboard.general.string = handle
                showCopiedMessage = true

                // Hide message after 2 seconds
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                    showCopiedMessage = false
                }
            }) {
                HStack(spacing: 4) {
                    Image(systemName: showCopiedMessage ? "checkmark.circle.fill" : "doc.on.doc")
                        .foregroundColor(showCopiedMessage ? .green : .blue)

                    if showCopiedMessage {
                        Text("Copied")
                            .font(.caption)
                            .foregroundColor(.green)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Color(.systemGray5))
                .cornerRadius(8)
            }
        }
        .padding(12)
        .background(Color(.systemBackground))
        .cornerRadius(8)
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
            // Load rules
            do {
                rulesContent = try await APIService.shared.getRules()
            } catch {
                print("Rules load error: \(error)")
            }

            // Load payouts
            do {
                payoutResponse = try await APIService.shared.getPayouts()
            } catch {
                print("Payouts load error: \(error)")
            }

            // Load scoring rules
            do {
                scoringRules = try await APIService.shared.getScoringRules()
                print("DEBUG: Loaded \(scoringRules.count) scoring rules")
            } catch {
                print("Scoring rules load error: \(error)")
            }

            // Load position requirements
            do {
                positionRequirements = try await APIService.shared.getPositionRequirements()
                print("DEBUG: Loaded \(positionRequirements.count) position requirements")
            } catch {
                print("Position requirements load error: \(error)")
            }

            // Load game settings (for payment handles)
            do {
                gameSettings = try await APIService.shared.getSettings()
                print("DEBUG: Loaded game settings with payment handles")
            } catch {
                print("Game settings load error: \(error)")
            }

            // If all failed, show error
            if rulesContent.isEmpty && payoutResponse == nil && scoringRules.isEmpty {
                errorMessage = "Failed to load game information"
            }

        }

        isLoading = false
    }
}

#Preview {
    RulesView()
}
