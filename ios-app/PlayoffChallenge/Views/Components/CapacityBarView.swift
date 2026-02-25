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
        HStack(spacing: DesignTokens.Spacing.sm) {
            if let progress = progress {
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(DesignTokens.Color.Surface.elevated)
                        .frame(height: DesignTokens.Size.capacityBarHeight)
                    
                    GeometryReader { geo in
                        Capsule()
                            .fill(DesignTokens.Color.Brand.primary)
                            .frame(width: geo.size.width * CGFloat(min(1.0, max(0.0, progress))), height: DesignTokens.Size.capacityBarHeight)
                    }
                    .frame(height: DesignTokens.Size.capacityBarHeight)
                }
            }
            
            if let maxEntries = maxEntries {
                Text("\(entryCount)/\(maxEntries)")
                    .font(.caption.monospacedDigit())
                    .foregroundColor(DesignTokens.Color.Text.secondary)
                    .layoutPriority(1)
            } else {
                Text("\(entryCount) entered")
                    .font(.caption)
                    .foregroundColor(DesignTokens.Color.Text.secondary)
                    .layoutPriority(1)
            }
        }
    }
}

#Preview {
    VStack(spacing: 20) {
        CapacityBarView(entryCount: 16, maxEntries: 20)
        CapacityBarView(entryCount: 5, maxEntries: 100)
        CapacityBarView(entryCount: 42, maxEntries: nil)
        CapacityBarView(entryCount: 20, maxEntries: 20)
    }
    .padding()
}
