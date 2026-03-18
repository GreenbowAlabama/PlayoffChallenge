import XCTest
import Combine
@testable import PlayoffChallenge

@MainActor
final class StripeConnectViewModelTests: XCTestCase {

    var viewModel: StripeConnectViewModel!
    var mockService: MockStripeConnectService!
    var cancellables: Set<AnyCancellable>!

    override func setUp() {
        super.setUp()
        mockService = MockStripeConnectService()
        let authService = AuthService.shared
        authService.currentUser = User(
            id: UUID(),
            email: "test@example.com",
            username: "testuser",
            created_at: ISO8601DateFormatter().string(from: Date()),
            token: "mock_token"
        )
        viewModel = StripeConnectViewModel(stripeService: mockService, authService: authService)
        cancellables = []
    }

    override func tearDown() {
        super.tearDown()
        cancellables = []
    }

    // MARK: - checkStatus with force parameter

    func testCheckStatusWithForceBypassesGuard() async {
        mockService.statusToReturn = StripeAccountStatus(
            connected: false,
            payoutsEnabled: false,
            detailsSubmitted: false
        )

        await viewModel.checkStatus()

        let initialCallCount = mockService.getAccountStatusCallCount
        await viewModel.checkStatus()
        XCTAssertEqual(mockService.getAccountStatusCallCount, initialCallCount, "Second call should not execute without force=true")

        mockService.statusToReturn = StripeAccountStatus(
            connected: true,
            payoutsEnabled: true,
            detailsSubmitted: true
        )

        await viewModel.checkStatus(force: true)
        XCTAssertEqual(mockService.getAccountStatusCallCount, initialCallCount + 1, "Call with force=true should execute")
    }

    // MARK: - onboardingURL property

    func testInitiateOnboardingSetsURL() async {
        mockService.onboardingURLToReturn = "https://stripe.example.com/link"

        await viewModel.initiateOnboarding()

        XCTAssertEqual(viewModel.onboardingURL, "https://stripe.example.com/link")
        XCTAssertNil(viewModel.errorMessage)
    }

    // MARK: - refreshStatus method

    func testRefreshStatusResetsGuardAndForces() async {
        mockService.statusToReturn = StripeAccountStatus(
            connected: false,
            payoutsEnabled: false,
            detailsSubmitted: false
        )

        await viewModel.checkStatus()

        mockService.statusToReturn = StripeAccountStatus(
            connected: true,
            payoutsEnabled: true,
            detailsSubmitted: true
        )

        await viewModel.refreshStatus()

        XCTAssertTrue(viewModel.isReadyForWithdrawal, "refreshStatus should perform force check")
    }
}

// MARK: - Mock Service

class MockStripeConnectService: StripeConnectServicing {
    var statusToReturn: StripeAccountStatus?
    var onboardingURLToReturn: String = "https://stripe.example.com/mock"
    var getAccountStatusCallCount = 0
    var getOnboardingLinkCallCount = 0

    func getAccountStatus() async throws -> StripeAccountStatus {
        getAccountStatusCallCount += 1
        return statusToReturn ?? StripeAccountStatus(
            connected: false,
            payoutsEnabled: false,
            detailsSubmitted: false
        )
    }

    func getOnboardingLink() async throws -> String {
        getOnboardingLinkCallCount += 1
        return onboardingURLToReturn
    }
}
