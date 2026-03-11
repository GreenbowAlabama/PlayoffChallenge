import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authService: AuthService

    var body: some View {
        Group {
            if authService.isAuthenticated,
               let userId = authService.currentUser?.id.uuidString {
                // User-scoped ViewModels created only after authentication
                AuthenticatedRootView(userId: userId)
                    .id(userId) // Stable ID based on userId
            } else {
                SignInView()
            }
        }
    }
}

// MARK: - Authenticated Root

/// Wrapper for authenticated content.
/// Uses ViewModels provided by PlayoffChallengeApp to ensure they're shared across all views,
/// including deep link sheets which exist outside the ContentView hierarchy.
struct AuthenticatedRootView: View {
    let userId: String

    @EnvironmentObject var availableVM: AvailableContestsViewModel
    @EnvironmentObject var myVM: MyContestsViewModel
    @EnvironmentObject var walletVM: UserWalletViewModel

    var body: some View {
        MainTabView()
            .onAppear { print("AuthenticatedRootView appear") }
            .task {
                // Load both contest sources in parallel
                async let availableContests = availableVM.loadContests()
                async let myContests = myVM.loadMyContests()
                _ = await (availableContests, myContests)  // Wait for both to complete
            }
    }
}

#Preview {
    ContentView()
        .environmentObject(AuthService.shared)
}
