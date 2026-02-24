import XCTest
@testable import PlayoffChallenge

@MainActor
final class ContestsLandingViewModelTests: XCTestCase {

    private var mockPendingJoinChecker: MockPendingJoinChecker!
    private var sut: ContestsLandingViewModel!

    override func setUp() {
        super.setUp()
        mockPendingJoinChecker = MockPendingJoinChecker()
        sut = ContestsLandingViewModel(pendingJoinChecker: mockPendingJoinChecker)
    }

    override func tearDown() {
        sut = nil
        mockPendingJoinChecker = nil
        super.tearDown()
    }

    // MARK: - Initial State Tests

    func testInitialState_navigationIntentIsNil() {
        XCTAssertNil(sut.navigationIntent)
    }

    func testInitialState_noPendingJoin_showResumePendingJoinIsFalse() {
        mockPendingJoinChecker.setHasPendingJoin(false)

        XCTAssertFalse(sut.showResumePendingJoin)
    }

    func testInitialState_withPendingJoin_showResumePendingJoinIsTrue() {
        mockPendingJoinChecker.setHasPendingJoin(true)

        XCTAssertTrue(sut.showResumePendingJoin)
    }

    // MARK: - Resume Pending Join Visibility Tests

    func testShowResumePendingJoin_changesWhenPendingJoinChanges() {
        XCTAssertFalse(sut.showResumePendingJoin)

        mockPendingJoinChecker.setHasPendingJoin(true)
        XCTAssertTrue(sut.showResumePendingJoin)

        mockPendingJoinChecker.setHasPendingJoin(false)
        XCTAssertFalse(sut.showResumePendingJoin)
    }

    // MARK: - Create Custom Contest Navigation Tests

    func testSelectCreateCustomContest_emitsCreateNavigationIntent() {
        sut.selectCreateCustomContest()

        XCTAssertEqual(sut.navigationIntent, .createCustomContest)
    }

    func testSelectCreateCustomContest_overwritesPreviousIntent() {
        sut.selectJoinByLink()
        XCTAssertEqual(sut.navigationIntent, .joinByLink)

        sut.selectCreateCustomContest()
        XCTAssertEqual(sut.navigationIntent, .createCustomContest)
    }

    // MARK: - Join By Link Navigation Tests

    func testSelectJoinByLink_emitsJoinNavigationIntent() {
        sut.selectJoinByLink()

        XCTAssertEqual(sut.navigationIntent, .joinByLink)
    }

    func testSelectJoinByLink_overwritesPreviousIntent() {
        sut.selectCreateCustomContest()
        XCTAssertEqual(sut.navigationIntent, .createCustomContest)

        sut.selectJoinByLink()
        XCTAssertEqual(sut.navigationIntent, .joinByLink)
    }

    // MARK: - Resume Pending Join Navigation Tests

    func testSelectResumePendingJoin_emitsResumeNavigationIntent() {
        sut.selectResumePendingJoin()

        XCTAssertEqual(sut.navigationIntent, .resumePendingJoin)
    }

    func testSelectResumePendingJoin_overwritesPreviousIntent() {
        sut.selectJoinByLink()
        XCTAssertEqual(sut.navigationIntent, .joinByLink)

        sut.selectResumePendingJoin()
        XCTAssertEqual(sut.navigationIntent, .resumePendingJoin)
    }

    // MARK: - Clear Navigation Intent Tests

    func testClearNavigationIntent_setsIntentToNil() {
        sut.selectCreateCustomContest()
        XCTAssertNotNil(sut.navigationIntent)

        sut.clearNavigationIntent()
        XCTAssertNil(sut.navigationIntent)
    }

    func testClearNavigationIntent_whenAlreadyNil_remainsNil() {
        XCTAssertNil(sut.navigationIntent)

        sut.clearNavigationIntent()
        XCTAssertNil(sut.navigationIntent)
    }

    // MARK: - Navigation Emission Sequence Tests

    func testNavigationSequence_multipleSelections_emitsCorrectIntents() {
        XCTAssertNil(sut.navigationIntent)

        sut.selectCreateCustomContest()
        XCTAssertEqual(sut.navigationIntent, .createCustomContest)

        sut.clearNavigationIntent()
        XCTAssertNil(sut.navigationIntent)

        sut.selectJoinByLink()
        XCTAssertEqual(sut.navigationIntent, .joinByLink)

        sut.clearNavigationIntent()
        XCTAssertNil(sut.navigationIntent)

        sut.selectResumePendingJoin()
        XCTAssertEqual(sut.navigationIntent, .resumePendingJoin)
    }
}
