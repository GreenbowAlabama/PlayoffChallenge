import SwiftUI
import AuthenticationServices

struct SignInView: View {
    @EnvironmentObject var authService: AuthService
    
    var body: some View {
        VStack(spacing: 30) {
            Spacer()

            // Logo area with brand colors
            VStack(spacing: 12) {
                Image("AppLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 90, height: 90)

                Text("PLAYOFF CHALLENGE")
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .foregroundColor(Color("BrandBlack"))
                    .tracking(1.2)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)

                Text("'67 Enterprises")
                    .font(.system(size: 18, weight: .semibold, design: .rounded))
                    .foregroundColor(Color("BrandOrange"))
                    .tracking(0.5)
            }

            Text("Pick your players and compete with friends")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
                .padding(.top, 10)

            Spacer()

            SignInWithAppleButton()
                .signInWithAppleButtonStyle(.black)
                .frame(height: 50)
                .padding(.horizontal, 40)

            #if DEBUG
            VStack(spacing: 10) {
                Text("OR")
                    .font(.caption)
                    .foregroundColor(.secondary)

                EmailSignInView()
                    .environmentObject(authService)
                    .padding(.horizontal, 40)

                Text("Debug Only - Email/Password sign in for easier testing")
                    .font(.caption2)
                    .foregroundColor(Color("BrandOrange"))
                    .padding(.horizontal, 20)
                    .multilineTextAlignment(.center)
            }
            #endif

            Text("Sign in to save your picks and compete")
                .font(.caption)
                .foregroundColor(.secondary)
                .padding(.bottom, 40)
        }
        .padding()
    }
}

#Preview {
    SignInView()
        .environmentObject(AuthService())
}
