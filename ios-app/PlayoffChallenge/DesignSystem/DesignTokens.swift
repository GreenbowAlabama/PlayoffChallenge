//
//  DesignTokens.swift
//  PlayoffChallenge
//
//  Centralized design tokens for the UI refresh.
//  Replaces ad-hoc styling with named constants.
//

import SwiftUI
import Core

enum DesignTokens {
    enum Color {
        enum Brand {
            static let primary = SwiftUI.Color("BrandOrange")
            static let secondary = SwiftUI.Color("BrandBlack")
            static let background = SwiftUI.Color("BrandCream")
            static let accent = SwiftUI.Color("AccentColor")
        }
        
        enum Status {
            static func forContestStatus(_ status: ContestStatus) -> SwiftUI.Color {
                switch status {
                case .scheduled: return .blue
                case .live: return .green
                case .locked: return .orange
                case .complete: return .gray
                case .cancelled: return .red
                case .error: return .red
                }
            }
        }
        
        enum Surface {
            static let card = SwiftUI.Color(.systemGray6)
            static let cardDisabled = SwiftUI.Color(.systemGray5)
            static let elevated = SwiftUI.Color(.systemGray5)
        }
        
        enum Action {
            static let primary = SwiftUI.Color.green
            static let secondary = SwiftUI.Color.blue
            static let destructive = SwiftUI.Color.red
            static let disabled = SwiftUI.Color.gray
        }
        
        enum Text {
            static let primary = SwiftUI.Color.primary
            static let secondary = SwiftUI.Color.secondary
            static let inverse = SwiftUI.Color.white
        }
    }
    
    enum Spacing {
        static let xxs: CGFloat = 4
        static let xs: CGFloat = 6
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 20
        static let xxl: CGFloat = 24
        static let section: CGFloat = 32
    }
    
    enum Radius {
        static let sm: CGFloat = 4
        static let md: CGFloat = 8
        static let lg: CGFloat = 12
        static let xl: CGFloat = 16
    }
    
    enum Size {
        static let cardMinHeight: CGFloat = 120
        static let heroMinHeight: CGFloat = 200
        static let iconSmall: CGFloat = 24
        static let iconMedium: CGFloat = 32
        static let iconLarge: CGFloat = 44
        static let capacityBarHeight: CGFloat = 8
        static let dotSmall: CGFloat = 6
    }
    
    enum Shadow {
        static let cardColor = SwiftUI.Color.black.opacity(0.08)
        static let cardRadius: CGFloat = 4
        static let cardY: CGFloat = 2
        
        static let elevatedColor = SwiftUI.Color.black.opacity(0.12)
        static let elevatedRadius: CGFloat = 8
        static let elevatedY: CGFloat = 4
    }
}
