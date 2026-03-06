//
//  ContestRulesView.swift
//  PlayoffChallenge
//
//  Generic rules renderer for any contest type
//

import SwiftUI

struct ContestRulesView: View {
    @StateObject private var viewModel: ContestRulesViewModel

    init(contestId: UUID) {
        _viewModel = StateObject(wrappedValue: ContestRulesViewModel(contestId: contestId))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.lg) {
                if viewModel.isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding()
                } else if let error = viewModel.errorMessage {
                    VStack(spacing: DesignTokens.Spacing.md) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.largeTitle)
                            .foregroundColor(.orange)

                        Text(error)
                            .foregroundColor(.red)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                } else if viewModel.sections.isEmpty {
                    VStack(spacing: DesignTokens.Spacing.md) {
                        Image(systemName: "book.circle")
                            .font(.largeTitle)
                            .foregroundColor(.gray)

                        Text("No rules available")
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                } else {
                    ForEach(viewModel.sections) { section in
                        ContestRuleSection(section: section)
                    }
                }
            }
            .padding()
        }
        .navigationTitle("Contest Rules")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.loadRules()
        }
    }
}

// MARK: - Rule Section Component

struct ContestRuleSection: View {
    let section: RulesSection

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
            Text(section.title)
                .font(.headline)
                .foregroundColor(DesignTokens.Color.Brand.primary)

            Text(section.contentDescription)
                .font(.body)
                .foregroundColor(DesignTokens.Color.Text.primary)
        }
        .padding(DesignTokens.Spacing.lg)
        .background(DesignTokens.Color.Surface.card)
        .cornerRadius(DesignTokens.Radius.lg)
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        ContestRulesView(contestId: UUID())
    }
}
