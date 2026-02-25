//
//  JoinErrorView.swift
//  PlayoffChallenge
//
//  Error state display for join flow errors.
//

import SwiftUI

/// Error state display for join flow errors.
struct JoinErrorView: View {
    let error: JoinLinkError
    let onDismiss: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            // Error Icon
            Image(systemName: iconName)
                .font(.system(size: 60))
                .foregroundColor(iconColor)

            // Error Title
            Text(error.title)
                .font(.title2)
                .fontWeight(.bold)
                .multilineTextAlignment(.center)

            // Error Description
            if let description = error.errorDescription {
                Text(description)
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            Spacer()

            // Dismiss Button
            Button(action: onDismiss) {
                Text("OK")
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(DesignTokens.Color.Action.secondary)
                    .cornerRadius(DesignTokens.Radius.lg)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .background(Color(.systemGroupedBackground))
    }

    private var iconName: String {
        switch error {
        case .networkError:
            return "wifi.exclamationmark"
        case .environmentMismatch:
            return "exclamationmark.triangle"
        case .contestNotFound:
            return "magnifyingglass"
        case .contestUnavailable:
            return "exclamationmark.circle"
        case .contestCompleted:
            return "checkmark.seal"
        case .contestLocked:
            return "lock.fill"
        case .contestFull:
            return "person.3.fill"
        case .contestCancelled:
            return "xmark.circle"
        case .alreadyJoined:
            return "checkmark.circle"
        case .notAuthenticated:
            return "person.crop.circle.badge.exclamationmark"
        case .serverError:
            return "exclamationmark.icloud"
        }
    }

    private var iconColor: Color {
        switch error {
        case .alreadyJoined:
            return DesignTokens.Color.Action.primary
        case .contestFull, .contestLocked, .contestCancelled, .contestUnavailable, .contestCompleted:
            return DesignTokens.Color.Brand.primary
        default:
            return DesignTokens.Color.Action.destructive
        }
    }
}

// MARK: - Preview

#if DEBUG
struct JoinErrorView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            JoinErrorView(error: .contestNotFound) {}
                .previewDisplayName("Contest Not Found")

            JoinErrorView(error: .contestFull) {}
                .previewDisplayName("Contest Full")

            JoinErrorView(error: .alreadyJoined) {}
                .previewDisplayName("Already Joined")

            JoinErrorView(error: .environmentMismatch(expected: "production", actual: "staging")) {}
                .previewDisplayName("Environment Mismatch")
        }
    }
}
#endif
