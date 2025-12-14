import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authService: AuthService
    
    var body: some View {
        Group {
            if authService.isAuthenticated {
                HomeView()
            } else {
                SignInView()
            }
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(AuthService())
}
