import SwiftUI
import AuthenticationServices

struct SignInView: View {
    @EnvironmentObject var authService: AuthService
    
    var body: some View {
        VStack(spacing: 30) {
            Spacer()
            
            Image(systemName: "football.fill")
                .font(.system(size: 100))
                .foregroundColor(.orange)
            
            Text("Playoff Challenge")
                .font(.largeTitle)
                .fontWeight(.bold)
            
            Text("Pick your players and compete with friends")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
            
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

                Text("TestFlight Only - Email/Password sign in for easier testing")
                    .font(.caption2)
                    .foregroundColor(.orange)
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
