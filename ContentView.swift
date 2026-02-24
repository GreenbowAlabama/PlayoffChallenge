import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authService: AuthService
    @StateObject private var landingVM = LandingViewModel()

    var body: some View {
        Group {
            if authService.isAuthenticated,
               let userId = authService.currentUser?.id.uuidString {
                // User-scoped ViewModels created only after authentication
                AuthenticatedRootView(userId: userId, landingVM: landingVM)
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
    @ObservedObject var landingVM: LandingViewModel

    @StateObject private var availableVM = AvailableContestsViewModel()
    @StateObject private var myVM: MyContestsViewModel

    init(userId: String, landingVM: LandingViewModel) {
        self.userId = userId
        self.landingVM = landingVM
        _myVM = StateObject(
            wrappedValue: MyContestsViewModel(
                apiClient: APIService.shared,
                userId: userId
            )
        )
    }

    var body: some View {
        LandingView(viewModel: landingVM)
            .environmentObject(availableVM)
            .environmentObject(myVM)
            .environmentObject(landingVM)
            .onAppear { print("AuthenticatedRootView appear") }
            .task {
                await availableVM.loadContests()
            }
    }
}

#Preview {
    ContentView()
        .environmentObject(AuthService.shared)
}
