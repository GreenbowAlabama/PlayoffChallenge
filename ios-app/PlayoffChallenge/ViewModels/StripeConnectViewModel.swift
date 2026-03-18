//
//  StripeConnectViewModel.swift
//  PlayoffChallenge
//
//  ViewModel for Stripe Connect account management.
//  Manages onboarding flow and account status.
//

import Foundation
import Combine

/// State machine for Stripe Connect flow.
enum StripeConnectState: Equatable {
    case checking           // Initial status check in progress
    case notConnected       // No account linked
    case incomplete         // Account linked but not ready
    case ready              // Account ready for payouts
    case onboarding         // Onboarding link loading
    case error(String)      // Error state

    static func == (lhs: StripeConnectState, rhs: StripeConnectState) -> Bool {
        switch (lhs, rhs) {
        case (.checking, .checking): return true
        case (.notConnected, .notConnected): return true
        case (.incomplete, .incomplete): return true
        case (.ready, .ready): return true
        case (.onboarding, .onboarding): return true
        case (.error(let lhsMsg), .error(let rhsMsg)): return lhsMsg == rhsMsg
        default: return false
        }
    }
}

/// ViewModel for Stripe Connect account management.
/// Sole owner of Stripe connection state.
/// All Service calls originate here.
@MainActor
final class StripeConnectViewModel: ObservableObject {

    // MARK: - Published State

    /// Current state of Stripe connection
    @Published private(set) var state: StripeConnectState = .checking

    /// Loading indicator for async operations
    @Published private(set) var isLoading: Bool = false

    /// Error message (if in error state)
    @Published private(set) var errorMessage: String? = nil

    /// Currently fetched account status
    @Published private(set) var accountStatus: StripeAccountStatus? = nil

    /// Onboarding URL (set when initiateOnboarding succeeds)
    @Published private(set) var onboardingURL: String? = nil

    // MARK: - Dependencies

    private let stripeService: StripeConnectServicing
    private let authService: AuthService

    // MARK: - Load Guard

    private var hasChecked = false

    // MARK: - Initialization

    init(stripeService: StripeConnectServicing? = nil, authService: AuthService = .shared) {
        self.authService = authService
        self.stripeService = stripeService ?? StripeConnectService(authService: authService)
    }

    // MARK: - Public Actions

    /// Check current Stripe account status.
    /// Fetches live status from backend.
    func checkStatus(force: Bool = false) async {
        // Guard against duplicate checks (unless force=true)
        if hasChecked && !force {
            return
        }

        hasChecked = true
        isLoading = true
        defer { isLoading = false }
        errorMessage = nil

        print("[StripeConnectViewModel] checkStatus() ENTERED")

        // Guard that user is authenticated
        guard let userId = authService.currentUser?.id else {
            print("[StripeConnectViewModel] No authenticated user - cannot check status")
            await MainActor.run {
                self.state = .error("Please sign in")
            }
            return
        }

        print("[StripeConnectViewModel] Checking status for userId: \(userId.uuidString)")

        do {
            let status = try await stripeService.getAccountStatus()

            await MainActor.run {
                self.accountStatus = status

                // Determine state based on status flags
                if !status.connected {
                    self.state = .notConnected
                } else if status.payoutsEnabled && status.detailsSubmitted {
                    self.state = .ready
                } else {
                    self.state = .incomplete
                }

                self.errorMessage = nil

                print("[StripeConnectViewModel] Status check succeeded: state=\(self.state)")
            }
        } catch APIError.unauthorized {
            await MainActor.run {
                self.state = .error("Please sign in")
                self.errorMessage = "Authentication required"
            }
        } catch {
            await MainActor.run {
                let errorMsg = error.localizedDescription
                self.state = .error(errorMsg)
                self.errorMessage = errorMsg
                print("[StripeConnectViewModel] Status check failed: \(error)")
            }
        }
    }

    /// Initiate Stripe Connect onboarding.
    /// Retrieves onboarding link for user to open.
    func initiateOnboarding() async {
        isLoading = true
        errorMessage = nil
        state = .onboarding

        print("[StripeConnectViewModel] initiateOnboarding() ENTERED")

        guard let userId = authService.currentUser?.id else {
            await MainActor.run {
                self.state = .error("Please sign in")
                self.errorMessage = "Authentication required"
                self.isLoading = false
            }
            return
        }

        print("[StripeConnectViewModel] Getting onboarding link for userId: \(userId.uuidString)")

        do {
            let url = try await stripeService.getOnboardingLink()

            await MainActor.run {
                print("[StripeConnectViewModel] Onboarding link retrieved: \(url.prefix(50))...")
                self.onboardingURL = url
                self.errorMessage = nil
                self.isLoading = false
            }
        } catch APIError.unauthorized {
            await MainActor.run {
                self.state = .error("Please sign in")
                self.errorMessage = "Authentication required"
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                let errorMsg = error.localizedDescription
                self.state = .error(errorMsg)
                self.errorMessage = errorMsg
                self.isLoading = false
                print("[StripeConnectViewModel] Onboarding failed: \(error)")
            }
        }
    }

    /// Called when user returns from Stripe onboarding.
    /// Re-checks account status.
    func onOnboardingCompleted() async {
        print("[StripeConnectViewModel] onOnboardingCompleted() - rechecking status")
        await checkStatus()
    }

    /// Refresh Stripe account status (bypasses guard).
    /// Resets hasChecked and forces a new check.
    func refreshStatus() async {
        hasChecked = false
        await checkStatus(force: true)
    }

    /// Clear error message.
    func clearError() {
        errorMessage = nil
    }

    /// Computed: Is account ready for withdrawal?
    var isReadyForWithdrawal: Bool {
        guard case .ready = state else { return false }
        return true
    }

    /// Computed: Should show connect button?
    var shouldShowConnectButton: Bool {
        guard case .notConnected = state else { return false }
        return true
    }

    /// Computed: Should show incomplete banner?
    var shouldShowIncompleteBanner: Bool {
        guard case .incomplete = state else { return false }
        return true
    }
}
