import SwiftUI
import AuthenticationServices

struct SignInView: View {
    @EnvironmentObject var authService: AuthService

    var body: some View {
        ZStack {
            // Subtle background
            Color(.systemBackground)
                .ignoresSafeArea()

            VStack(spacing: DesignTokens.Spacing.xxl) {
                Spacer()

                // Logo & Branding Card
                VStack(spacing: DesignTokens.Spacing.md) {
                    Image("AppLogo")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 90, height: 90)

                    VStack(spacing: DesignTokens.Spacing.xs) {
                        Text("67 Games")
                            .font(.system(size: 28, weight: .black, design: .rounded))
                            .foregroundColor(DesignTokens.Color.Text.primary)
                            .tracking(1.2)
                            .minimumScaleFactor(0.5)
                            .lineLimit(1)

                        Text("'67 Enterprises")
                            .font(.system(size: 18, weight: .semibold, design: .rounded))
                            .foregroundColor(DesignTokens.Color.Brand.primary)
                            .tracking(0.5)
                    }

                    // Brand accent divider
                    RoundedRectangle(cornerRadius: DesignTokens.Radius.sm)
                        .fill(DesignTokens.Color.Brand.primary)
                        .frame(width: 50, height: 3)
                        .padding(.top, DesignTokens.Spacing.sm)
                }
                .frame(maxWidth: .infinity)
                .padding(DesignTokens.Spacing.lg)
                .background(DesignTokens.Color.Surface.card)
                .cornerRadius(DesignTokens.Radius.lg)
                .padding(.horizontal, DesignTokens.Spacing.lg)

                // Tagline with icon
                HStack(spacing: DesignTokens.Spacing.md) {
                    Image(systemName: "sparkles")
                        .font(.headline)
                        .foregroundColor(DesignTokens.Color.Brand.primary)

                    Text("Pick your players and compete with friends")
                        .font(.subheadline)
                        .foregroundColor(DesignTokens.Color.Text.secondary)
                        .multilineTextAlignment(.center)

                    Image(systemName: "sparkles")
                        .font(.headline)
                        .foregroundColor(DesignTokens.Color.Brand.primary)
                }
                .frame(maxWidth: .infinity)
                .padding(DesignTokens.Spacing.lg)
                .background(DesignTokens.Color.Surface.elevated)
                .cornerRadius(DesignTokens.Radius.md)
                .padding(.horizontal, DesignTokens.Spacing.lg)

                Spacer()

                // Sign In Section
                VStack(spacing: DesignTokens.Spacing.lg) {
                    SignInWithAppleButton()
                        .signInWithAppleButtonStyle(.black)
                        .frame(height: 50)

                    #if DEBUG
                    VStack(spacing: DesignTokens.Spacing.md) {
                        HStack {
                            Rectangle()
                                .fill(DesignTokens.Color.Text.secondary)
                                .frame(height: 1)
                            Text("Debug")
                                .font(.caption2)
                                .foregroundColor(DesignTokens.Color.Text.secondary)
                            Rectangle()
                                .fill(DesignTokens.Color.Text.secondary)
                                .frame(height: 1)
                        }

                        EmailSignInView()
                            .environmentObject(authService)

                        Text("Email/Password sign in (testing only)")
                            .font(.caption2)
                            .foregroundColor(DesignTokens.Color.Brand.primary)
                            .multilineTextAlignment(.center)
                    }
                    #endif
                }
                .padding(DesignTokens.Spacing.lg)
                .frame(maxWidth: .infinity)
                .background(DesignTokens.Color.Surface.card)
                .cornerRadius(DesignTokens.Radius.lg)
                .padding(.horizontal, DesignTokens.Spacing.lg)

                // Footer text
                HStack(spacing: DesignTokens.Spacing.sm) {
                    Image(systemName: "info.circle")
                        .font(.caption)
                        .foregroundColor(DesignTokens.Color.Text.secondary)

                    Text("Sign in to save your picks and compete")
                        .font(.caption)
                        .foregroundColor(DesignTokens.Color.Text.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.horizontal, DesignTokens.Spacing.lg)
                .padding(.bottom, DesignTokens.Spacing.lg)
            }
            .padding(.vertical, DesignTokens.Spacing.lg)
        }
    }
}

#Preview {
    SignInView()
        .environmentObject(AuthService())
}
