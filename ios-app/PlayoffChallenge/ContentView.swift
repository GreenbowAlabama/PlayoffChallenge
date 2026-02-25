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
/// Creates user-scoped ViewModels only after identity is confirmed.
/// Ensures ViewModels are destroyed when user logs out or identity changes.
struct AuthenticatedRootView: View {
    let userId: String

    @StateObject private var availableVM = AvailableContestsViewModel()
    @StateObject private var myVM: MyContestsViewModel

    init(userId: String) {
        self.userId = userId
        _myVM = StateObject(
            wrappedValue: MyContestsViewModel()
        )
    }

    var body: some View {
        MainTabView()
            .environmentObject(availableVM)
            .environmentObject(myVM)
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
