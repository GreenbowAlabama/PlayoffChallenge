//
//  DynamicLeaderboardTableView.swift
//  PlayoffChallenge
//
//  Renders leaderboards dynamically based on column schema.
//  Contract-compliant and contest-type-agnostic.
//

import SwiftUI

struct DynamicLeaderboardTableView: View {
    let columnSchema: [LeaderboardColumn]
    let rows: [Standing]
    var isCurrentUserRow: (Standing) -> Bool = { _ in false }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Header row
                HStack(spacing: 12) {
                    ForEach(columnSchema, id: \.key) { column in
                        Text(column.label)
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(DesignTokens.Color.Surface.card)

                Divider()

                // Data rows
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    HStack(spacing: 12) {
                        ForEach(columnSchema, id: \.key) { column in
                            let value = row.values[column.key]?.value ?? "—"
                            let displayValue = formatValue(value, columnType: column.type)

                            Text(displayValue)
                                .font(.body)
                                .lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(
                        isCurrentUserRow(row) ? DesignTokens.Color.Action.secondary.opacity(0.08) : DesignTokens.Color.Surface.elevated
                    )

                    if index < rows.count - 1 {
                        Divider()
                            .padding(.horizontal, 16)
                    }
                }
            }
        }
    }

    // MARK: - Formatting

    private func formatValue(_ value: Any, columnType: String?) -> String {
        switch columnType {
        case "currency":
            return formatCurrency(value)
        case "number":
            return formatNumber(value)
        default:
            return String(describing: value)
        }
    }

    private func formatCurrency(_ value: Any) -> String {
        if let num = value as? NSNumber {
            let formatter = NumberFormatter()
            formatter.numberStyle = .currency
            formatter.locale = Locale.current
            return formatter.string(from: num) ?? String(describing: value)
        }
        if let str = value as? String, let num = Double(str) {
            let formatter = NumberFormatter()
            formatter.numberStyle = .currency
            formatter.locale = Locale.current
            return formatter.string(from: NSNumber(value: num)) ?? String(describing: value)
        }
        return String(describing: value)
    }

    private func formatNumber(_ value: Any) -> String {
        if let num = value as? NSNumber {
            let formatter = NumberFormatter()
            formatter.numberStyle = .decimal
            return formatter.string(from: num) ?? String(describing: value)
        }
        if let str = value as? String, let num = Double(str) {
            let formatter = NumberFormatter()
            formatter.numberStyle = .decimal
            return formatter.string(from: NSNumber(value: num)) ?? String(describing: value)
        }
        return String(describing: value)
    }
}

#Preview {
    let schema: [LeaderboardColumn] = []
    let rows: [Standing] = []

    NavigationStack {
        DynamicLeaderboardTableView(columnSchema: schema, rows: rows)
            .navigationTitle("Leaderboard")
    }
}
