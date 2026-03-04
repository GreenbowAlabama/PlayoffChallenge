//
//  CapacityBarView.swift
//  PlayoffChallenge
//
//  A progress bar showing contest entry capacity.
//

import SwiftUI

struct CapacityBarView: View {
    let entryCount: Int
    let maxEntries: Int?
    
    private var progress: Double? {
        guard let maxEntries = maxEntries, maxEntries > 0 else { return nil }
        return Double(entryCount) / Double(maxEntries)
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            if let progress = progress {
                HStack {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule()
                                .fill(DesignTokens.Color.Surface.elevated)

                            Capsule()
                                .fill(DesignTokens.Color.Brand.primary)
                                .frame(width: geo.size.width * CGFloat(min(1.0, max(0.0, progress))))
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: DesignTokens.Size.capacityBarHeight)
                }
            }

            if let maxEntries = maxEntries {
                Text("\(entryCount) / \(maxEntries)")
                    .font(.caption.monospacedDigit())
                    .foregroundColor(DesignTokens.Color.Text.secondary)
            } else {
                Text("\(entryCount) entered")
                    .font(.caption)
                    .foregroundColor(DesignTokens.Color.Text.secondary)
            }
        }
    }
}

#Preview {
    VStack(spacing: DesignTokens.Spacing.xl) {
        Text("Empty contest (0/20)")
            .font(.caption)
            .foregroundColor(.gray)
        CapacityBarView(entryCount: 0, maxEntries: 20)

        Text("Standard (16/20)")
            .font(.caption)
            .foregroundColor(.gray)
        CapacityBarView(entryCount: 16, maxEntries: 20)

        Text("Large capacity (5/100)")
            .font(.caption)
            .foregroundColor(.gray)
        CapacityBarView(entryCount: 5, maxEntries: 100)

        Text("Very large (3/500)")
            .font(.caption)
            .foregroundColor(.gray)
        CapacityBarView(entryCount: 3, maxEntries: 500)

        Text("Unlimited (42 entered)")
            .font(.caption)
            .foregroundColor(.gray)
        CapacityBarView(entryCount: 42, maxEntries: nil)

        Text("Full (20/20)")
            .font(.caption)
            .foregroundColor(.gray)
        CapacityBarView(entryCount: 20, maxEntries: 20)
    }
    .padding()
}
