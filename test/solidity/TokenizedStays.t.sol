// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {TokenizedStays} from "../../src/village/stays/TokenizedStays.sol";
import {VillageRoles} from "../../src/village/access/VillageRoles.sol";
import {RoleAuthorityHarness, TestCommunityToken, TestBase} from "./TestBase.sol";

contract ReentrantPermitToken is ERC20 {
    TokenizedStays public target;
    bool public lastReentrySucceeded;
    bytes4 public lastReentrySelector;

    constructor() ERC20("Reentrant Permit Token", "RPT") {}

    function setTarget(TokenizedStays target_) external {
        target = target_;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function permit(address owner, address spender, uint256 value, uint256, uint8, bytes32, bytes32) external {
        (bool success, bytes memory returndata) = address(target).call(abi.encodeCall(TokenizedStays.deposit, (0)));
        lastReentrySucceeded = success;
        lastReentrySelector = bytes4(0);
        if (returndata.length >= 4) {
            bytes4 selector;
            // solhint-disable-next-line no-inline-assembly
            assembly ("memory-safe") {
                selector := mload(add(returndata, 0x20))
            }
            lastReentrySelector = selector;
        }
        _approve(owner, spender, value);
    }
}

contract TokenizedStaysTest is TestBase {
    TokenizedStays internal stays;
    TestCommunityToken internal token;
    RoleAuthorityHarness internal authority;

    address internal member = makeAddr("member");
    address internal other = makeAddr("other");
    address internal manager = makeAddr("manager");
    address internal roleAdmin = makeAddr("roleAdmin");
    address internal outsider = makeAddr("outsider");

    function setUp() public {
        vm.warp(20_000 days);
        token = new TestCommunityToken();
        authority = new RoleAuthorityHarness(address(this));
        authority.grantRole(VillageRoles.BOOKING_MANAGER_ROLE, manager);
        authority.grantRole(bytes32(0), roleAdmin);

        TokenizedStays implementation = new TokenizedStays();
        stays = TokenizedStays(
            _proxy(
                address(implementation),
                abi.encodeCall(TokenizedStays.initialize, (address(token), address(authority), address(this)))
            )
        );

        token.mint(member, 1_000_000 ether);
        token.mint(other, 1_000_000 ether);
        vm.prank(member);
        token.approve(address(stays), type(uint256).max);
        vm.prank(other);
        token.approve(address(stays), type(uint256).max);
    }

    function testFuzz_GregorianDatesRoundTrip(uint16 rawYear, uint16 rawDay) public view {
        uint16 year = uint16(bound(rawYear, 1970, type(uint16).max));
        uint16 day = uint16(bound(rawDay, 1, stays.daysInYear(year)));
        uint32 dayId = stays.toDayId(year, day);
        (uint16 decodedYear, uint16 decodedDay) = stays.fromDayId(dayId);
        assertEq(decodedYear, year);
        assertEq(decodedDay, day);
    }

    function test_LeapCenturyAndInvalidDateBoundaries() public {
        assertEq(stays.daysInYear(2000), 366);
        assertEq(stays.daysInYear(2100), 365);
        (uint16 leapYear, uint16 leapDay) = stays.fromDayId(stays.toDayId(2000, 366));
        assertEq(leapYear, 2000);
        assertEq(leapDay, 366);

        vm.expectPartialRevert(TokenizedStays.InvalidDate.selector);
        stays.toDayId(1969, 1);
        vm.expectPartialRevert(TokenizedStays.InvalidDate.selector);
        stays.toDayId(2100, 366);
        vm.expectPartialRevert(TokenizedStays.InvalidDate.selector);
        stays.toDayId(2024, 0);
        vm.expectPartialRevert(TokenizedStays.InvalidDate.selector);
        stays.getYearExposureSummary(member, 1969);
    }

    function test_PermitEntryPointsRejectTokenCallbacksBeforeAccountingChanges() public {
        ReentrantPermitToken reentrantToken = new ReentrantPermitToken();
        TokenizedStays implementation = new TokenizedStays();
        TokenizedStays guardedStays = TokenizedStays(
            _proxy(
                address(implementation),
                abi.encodeCall(TokenizedStays.initialize, (address(reentrantToken), address(authority), address(this)))
            )
        );
        reentrantToken.setTarget(guardedStays);
        reentrantToken.mint(member, 10 ether);

        vm.prank(member);
        guardedStays.depositWithPermit(2 ether, type(uint256).max, 0, bytes32(0), bytes32(0));

        assertFalse(reentrantToken.lastReentrySucceeded());
        assertEq(reentrantToken.lastReentrySelector(), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        assertEq(guardedStays.depositedBalanceOf(member), 2 ether);
        assertEq(reentrantToken.balanceOf(address(guardedStays)), 2 ether);

        (uint16 year, uint16 dayOfYear) = guardedStays.fromDayId(guardedStays.currentDayId() + 30);
        TokenizedStays.BookingInput[] memory bookings = new TokenizedStays.BookingInput[](1);
        bookings[0] = TokenizedStays.BookingInput(year, dayOfYear, 5 ether);
        vm.prank(member);
        guardedStays.createBookingsWithPermit(bookings, 3 ether, type(uint256).max, 0, bytes32(0), bytes32(0));

        assertFalse(reentrantToken.lastReentrySucceeded());
        assertEq(reentrantToken.lastReentrySelector(), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        assertEq(guardedStays.depositedBalanceOf(member), 5 ether);
        assertEq(guardedStays.requiredLockedBalance(member), 5 ether);
        assertEq(guardedStays.totalDepositedBalance(), 5 ether);
        assertEq(reentrantToken.balanceOf(address(guardedStays)), 5 ether);
        (bool exists, TokenizedStays.BookingView memory stored) = guardedStays.getBooking(member, year, dayOfYear);
        assertTrue(exists);
        assertEq(stored.pricePerDate, 5 ether);
    }

    function test_CreatesVariableAndZeroPriceBookingsAndUpdatesAccounting() public {
        TokenizedStays.BookingInput[] memory bookings = new TokenizedStays.BookingInput[](3);
        bookings[0] = _bookingAt(10, 2 ether);
        bookings[1] = _bookingAt(11, 0);
        bookings[2] = _bookingAt(12, 3 ether);

        vm.prank(member);
        stays.createBookings(bookings);

        assertEq(stays.requiredLockedBalance(member), 5 ether);
        assertEq(stays.depositedBalanceOf(member), 5 ether);
        assertEq(stays.lockedBalanceOf(member), 5 ether);
        assertEq(stays.unlockedBalanceOf(member), 0);
        assertEq(token.balanceOf(address(stays)), 5 ether);

        (bool exists, TokenizedStays.BookingView memory stored) = stays.getBooking(
            member,
            bookings[1].year,
            bookings[1].dayOfYear
        );
        assertTrue(exists);
        assertEq(stored.pricePerDate, 0);
        assertEq(stays.bookingCountForYear(member, bookings[0].year), 3);
        assertEq(stays.latestBookedYear(member), bookings[2].year);
    }

    function test_BatchFailuresRollBackEveryBookingAndDepositChange() public {
        TokenizedStays.BookingInput memory valid = _bookingAt(10, 2 ether);
        TokenizedStays.BookingInput[] memory duplicate = new TokenizedStays.BookingInput[](2);
        duplicate[0] = valid;
        duplicate[1] = valid;

        vm.prank(member);
        vm.expectPartialRevert(TokenizedStays.BookingConflict.selector);
        stays.createBookings(duplicate);
        assertEq(stays.depositedBalanceOf(member), 0);
        (bool exists, ) = stays.getBooking(member, valid.year, valid.dayOfYear);
        assertFalse(exists);

        TokenizedStays.BookingInput[] memory empty = new TokenizedStays.BookingInput[](0);
        vm.prank(member);
        vm.expectRevert(TokenizedStays.EmptyBookingBatch.selector);
        stays.createBookings(empty);
    }

    function test_RejectsPastBeyondHorizonAndOversizedBookingInputs() public {
        (uint16 pastYear, uint16 pastDay) = stays.fromDayId(stays.currentDayId() - 1);
        TokenizedStays.BookingInput memory past = TokenizedStays.BookingInput(pastYear, pastDay, 1);
        vm.prank(member);
        vm.expectPartialRevert(TokenizedStays.BookingDateInPast.selector);
        stays.createBookings(_singleBooking(past));

        uint16 maximumYear = stays.currentMaximumBookingYear();
        TokenizedStays.BookingInput memory beyond = TokenizedStays.BookingInput(maximumYear + 1, 1, 1);
        vm.prank(member);
        vm.expectPartialRevert(TokenizedStays.BookingBeyondHorizon.selector);
        stays.createBookings(_singleBooking(beyond));

        uint256 maximumPrice = uint256(type(int256).max) / uint256(stays.LOCK_DAYS());
        TokenizedStays.BookingInput memory oversized = _bookingAt(1, maximumPrice + 1);
        vm.prank(member);
        vm.expectPartialRevert(TokenizedStays.InvalidPricePerDate.selector);
        stays.createBookings(_singleBooking(oversized));
        assertEq(stays.depositedBalanceOf(member), 0);
    }

    function test_AcceptsMaximumOverflowSafePrice() public {
        uint256 maximumPrice = uint256(type(int256).max) / uint256(stays.LOCK_DAYS());
        token.mint(member, maximumPrice);
        TokenizedStays.BookingInput memory booking = _bookingAt(1, maximumPrice);

        vm.prank(member);
        stays.createBookings(_singleBooking(booking));

        assertEq(stays.requiredLockedBalance(member), maximumPrice);
        assertEq(stays.depositedBalanceOf(member), maximumPrice);
    }

    function test_UsesExact365DayOverlapSemantics() public {
        TokenizedStays.BookingInput[] memory overlap = new TokenizedStays.BookingInput[](2);
        overlap[0] = _bookingAt(10, 2 ether);
        overlap[1] = _bookingAt(374, 3 ether);
        vm.prank(member);
        stays.createBookings(overlap);
        assertEq(stays.requiredLockedBalance(member), 5 ether);

        TokenizedStays.BookingInput[] memory adjacent = new TokenizedStays.BookingInput[](2);
        adjacent[0] = _bookingAt(10, 2 ether);
        adjacent[1] = _bookingAt(375, 3 ether);
        vm.prank(other);
        stays.createBookings(adjacent);
        assertEq(stays.requiredLockedBalance(other), 3 ether);
    }

    function test_YearAndLeapBoundariesPreserveFixed365DayLocks() public {
        (uint16 currentYear, ) = stays.fromDayId(stays.currentDayId());
        uint16 year = currentYear + 1;
        TokenizedStays.BookingInput[] memory yearBoundary = new TokenizedStays.BookingInput[](2);
        yearBoundary[0] = TokenizedStays.BookingInput(year, stays.daysInYear(year), 1 ether);
        yearBoundary[1] = TokenizedStays.BookingInput(year + 1, 1, 1 ether);
        vm.prank(member);
        stays.createBookings(yearBoundary);
        assertEq(stays.requiredLockedBalance(member), 2 ether);

        uint16 leapYear = year + 1;
        while (stays.daysInYear(leapYear) != 366) ++leapYear;
        uint32 leapDayId = stays.toDayId(leapYear, 60);
        (uint16 unlockYear, uint16 unlockDay) = stays.fromDayId(leapDayId + 365);
        assertEq(unlockYear, leapYear + 1);
        assertEq(unlockDay, 59);

        TokenizedStays.BookingInput[] memory adjacentAcrossLeapDay = new TokenizedStays.BookingInput[](2);
        adjacentAcrossLeapDay[0] = TokenizedStays.BookingInput(leapYear, 60, 1 ether);
        adjacentAcrossLeapDay[1] = TokenizedStays.BookingInput(unlockYear, unlockDay, 1 ether);
        vm.prank(other);
        stays.createBookings(adjacentAcrossLeapDay);
        assertEq(stays.requiredLockedBalance(other), 1 ether);
    }

    function test_UserAndManagerCancellationUpdateAllDerivedState() public {
        TokenizedStays.BookingInput[] memory bookings = new TokenizedStays.BookingInput[](2);
        bookings[0] = _bookingAt(30, 2 ether);
        bookings[1] = _bookingAt(400, 3 ether);
        vm.prank(member);
        stays.createBookings(bookings);

        TokenizedStays.DateInput[] memory dates = new TokenizedStays.DateInput[](1);
        dates[0] = TokenizedStays.DateInput(bookings[1].year, bookings[1].dayOfYear);
        vm.expectEmit(true, true, true, true, address(stays));
        emit TokenizedStays.BookingCanceled(member, bookings[1].year, bookings[1].dayOfYear, 3 ether);
        vm.prank(manager);
        stays.cancelBookingsFor(member, dates);
        assertEq(stays.requiredLockedBalance(member), 2 ether);
        assertEq(stays.unlockedBalanceOf(member), 1 ether);
        assertEq(stays.latestBookedYear(member), bookings[0].year);

        dates[0] = TokenizedStays.DateInput(bookings[0].year, bookings[0].dayOfYear);
        vm.expectEmit(true, true, true, true, address(stays));
        emit TokenizedStays.BookingCanceled(member, bookings[0].year, bookings[0].dayOfYear, 2 ether);
        vm.prank(member);
        stays.cancelBookings(dates);
        assertEq(stays.latestBookedYear(member), 0);
        assertEq(stays.requiredLockedBalance(member), 0);

        vm.prank(outsider);
        vm.expectRevert();
        stays.cancelBookingsFor(member, dates);
    }

    function test_CancellationFailuresRollBackTheEntireBatch() public {
        TokenizedStays.BookingInput[] memory bookings = new TokenizedStays.BookingInput[](2);
        bookings[0] = _bookingAt(30, 2 ether);
        bookings[1] = _bookingAt(40, 3 ether);
        vm.prank(member);
        stays.createBookings(bookings);

        TokenizedStays.BookingInput memory missing = _bookingAt(50, 1 ether);
        TokenizedStays.DateInput[] memory dates = new TokenizedStays.DateInput[](2);
        dates[0] = TokenizedStays.DateInput(bookings[0].year, bookings[0].dayOfYear);
        dates[1] = TokenizedStays.DateInput(missing.year, missing.dayOfYear);
        vm.prank(member);
        vm.expectRevert(
            abi.encodeWithSelector(TokenizedStays.BookingNotFound.selector, missing.year, missing.dayOfYear)
        );
        stays.cancelBookings(dates);

        assertEq(stays.requiredLockedBalance(member), 5 ether);
        assertEq(stays.depositedBalanceOf(member), 5 ether);
        (bool firstExists, ) = stays.getBooking(member, bookings[0].year, bookings[0].dayOfYear);
        (bool secondExists, ) = stays.getBooking(member, bookings[1].year, bookings[1].dayOfYear);
        assertTrue(firstExists);
        assertTrue(secondExists);

        TokenizedStays.BookingInput memory today = _bookingAt(0, 1 ether);
        vm.prank(other);
        stays.createBookings(_singleBooking(today));
        dates = new TokenizedStays.DateInput[](1);
        dates[0] = TokenizedStays.DateInput(today.year, today.dayOfYear);
        vm.prank(other);
        vm.expectRevert(
            abi.encodeWithSelector(TokenizedStays.BookingNotCancelable.selector, today.year, today.dayOfYear)
        );
        stays.cancelBookings(dates);
    }

    function test_LockedDepositsCannotBeWithdrawn() public {
        TokenizedStays.BookingInput memory booking = _bookingAt(30, 5 ether);
        vm.prank(member);
        stays.createBookings(_singleBooking(booking));
        uint256 contractBalanceBefore = token.balanceOf(address(stays));

        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(TokenizedStays.WithdrawalAmountExceedsUnlockedBalance.selector, 1, 0));
        stays.withdraw(1);

        assertEq(stays.depositedBalanceOf(member), 5 ether);
        assertEq(stays.totalDepositedBalance(), 5 ether);
        assertEq(stays.lockedBalanceOf(member), 5 ether);
        assertEq(stays.unlockedBalanceOf(member), 0);
        assertEq(token.balanceOf(address(stays)), contractBalanceBefore);
    }

    function test_DepositWithdrawalOrphanRecoveryAndInsolvencyDetection() public {
        vm.prank(member);
        stays.deposit(10 ether);
        vm.expectEmit(true, false, false, true, address(stays));
        emit TokenizedStays.Withdrawal(member, 3 ether);
        vm.prank(member);
        stays.withdraw(3 ether);
        assertEq(stays.depositedBalanceOf(member), 7 ether);
        assertEq(stays.totalDepositedBalance(), 7 ether);

        vm.prank(other);
        token.transfer(address(stays), 5 ether);
        assertEq(stays.orphanedTokenBalance(), 5 ether);
        vm.expectEmit(true, false, false, true, address(stays));
        emit TokenizedStays.OrphanedTokensRecovered(other, 2 ether);
        stays.recoverOrphanedTokens(other, 2 ether);
        assertEq(stays.orphanedTokenBalance(), 3 ether);

        vm.expectPartialRevert(TokenizedStays.RecoveryAmountExceedsOrphanedTokenBalance.selector);
        stays.recoverOrphanedTokens(other, 4 ether);
        vm.expectPartialRevert(TokenizedStays.InvalidRecoveryRecipient.selector);
        stays.recoverOrphanedTokens(address(stays), 1);

        token.forceBurn(address(stays), 4 ether);
        vm.expectPartialRevert(TokenizedStays.DepositedBalanceInvariantViolation.selector);
        stays.orphanedTokenBalance();
    }

    function test_PrunesOnlyFullyExpiredRecordsWithoutChangingDeposits() public {
        TokenizedStays.BookingInput memory booking = _bookingAt(5, 2 ether);
        TokenizedStays.BookingInput[] memory bookings = new TokenizedStays.BookingInput[](1);
        bookings[0] = booking;
        vm.prank(member);
        stays.createBookings(bookings);

        TokenizedStays.DateInput[] memory dates = new TokenizedStays.DateInput[](1);
        dates[0] = TokenizedStays.DateInput(booking.year, booking.dayOfYear);
        uint32 dayId = stays.toDayId(booking.year, booking.dayOfYear);
        vm.warp(uint256(dayId + 364) * 1 days);
        vm.expectPartialRevert(TokenizedStays.BookingNotExpired.selector);
        stays.pruneExpiredBookings(member, dates);

        vm.warp(uint256(dayId + 365) * 1 days);
        vm.expectEmit(true, true, true, true, address(stays));
        emit TokenizedStays.BookingPruned(member, booking.year, booking.dayOfYear, 2 ether);
        stays.pruneExpiredBookings(member, dates);
        (bool exists, ) = stays.getBooking(member, booking.year, booking.dayOfYear);
        assertFalse(exists);
        assertEq(stays.depositedBalanceOf(member), 2 ether);
        assertEq(stays.unlockedBalanceOf(member), 2 ether);
    }

    function test_PauseAndAuthorityReplacementProtectOurMutations() public {
        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(TokenizedStays.Unauthorized.selector, outsider, VillageRoles.DEFAULT_ADMIN_ROLE)
        );
        stays.pause();

        stays.pause();
        TokenizedStays.BookingInput memory pausedBooking = _bookingAt(10, 1 ether);
        vm.prank(member);
        vm.expectRevert();
        stays.deposit(1 ether);
        vm.prank(member);
        vm.expectRevert();
        stays.createBookings(_singleBooking(pausedBooking));

        vm.prank(roleAdmin);
        stays.unpause();
        vm.prank(member);
        stays.deposit(1 ether);

        RoleAuthorityHarness replacement = new RoleAuthorityHarness(address(this));
        replacement.grantRole(VillageRoles.BOOKING_MANAGER_ROLE, other);
        stays.setRoleAuthority(address(replacement));
        TokenizedStays.BookingInput memory booking = _bookingAt(20, 1 ether);
        vm.prank(member);
        stays.createBookings(_singleBooking(booking));
        TokenizedStays.DateInput[] memory dates = new TokenizedStays.DateInput[](1);
        dates[0] = TokenizedStays.DateInput(booking.year, booking.dayOfYear);

        vm.prank(manager);
        vm.expectRevert();
        stays.cancelBookingsFor(member, dates);
        vm.prank(other);
        stays.cancelBookingsFor(member, dates);
    }

    function test_PaginatesOnlyTheRequestedCalendarWindow() public {
        TokenizedStays.BookingInput[] memory bookings = new TokenizedStays.BookingInput[](2);
        bookings[0] = _bookingAt(10, 1 ether);
        bookings[1] = _bookingAt(12, 2 ether);
        vm.prank(member);
        stays.createBookings(bookings);

        (TokenizedStays.BookingView[] memory page, uint16 nextDay) = stays.getBookings(
            member,
            bookings[0].year,
            bookings[0].dayOfYear,
            3
        );
        assertEq(page.length, 2);
        assertEq(page[0].pricePerDate, 1 ether);
        assertEq(page[1].pricePerDate, 2 ether);
        assertEq(nextDay, bookings[0].dayOfYear + 3);

        uint16 finalPageYear = bookings[0].year + 1;
        uint16 finalDay = stays.daysInYear(finalPageYear);
        TokenizedStays.BookingInput memory finalBooking = TokenizedStays.BookingInput(finalPageYear, finalDay, 4 ether);
        vm.prank(member);
        stays.createBookings(_singleBooking(finalBooking));
        (page, nextDay) = stays.getBookings(member, finalPageYear, finalDay - 1, 10);
        assertEq(page.length, 1);
        assertEq(page[0].dayOfYear, finalDay);
        assertEq(page[0].pricePerDate, 4 ether);
        assertEq(nextDay, 0);

        vm.expectPartialRevert(TokenizedStays.InvalidBookingPage.selector);
        stays.getBookings(member, bookings[0].year, 0, 3);
        vm.expectPartialRevert(TokenizedStays.InvalidBookingPage.selector);
        stays.getBookings(member, bookings[0].year, 1, 0);
        vm.expectPartialRevert(TokenizedStays.InvalidBookingPage.selector);
        stays.getBookings(member, bookings[0].year, 1, 367);
    }

    function test_DepositStateAndYearSummaryMatchIndependentModels() public {
        uint32 today = stays.currentDayId();
        uint32[3] memory dayIds = [today + 30, today + 400, today + 430];
        uint256[3] memory prices = [uint256(2 ether), uint256(3 ether), uint256(4 ether)];
        bool[3] memory active = [true, true, true];
        TokenizedStays.BookingInput[] memory bookings = new TokenizedStays.BookingInput[](3);
        for (uint256 i = 0; i < 3; ++i) {
            (uint16 year, uint16 dayOfYear) = stays.fromDayId(dayIds[i]);
            bookings[i] = TokenizedStays.BookingInput(year, dayOfYear, prices[i]);
        }
        vm.prank(member);
        stays.createBookings(bookings);

        TokenizedStays.DepositState memory state = stays.getDepositState(member);
        assertEq(state.depositedBalance, stays.depositedBalanceOf(member));
        assertEq(state.requiredLockedBalance, stays.requiredLockedBalance(member));
        assertEq(state.lockedBalance, stays.lockedBalanceOf(member));
        assertEq(state.unlockedBalance, stays.unlockedBalanceOf(member));
        assertEq(state.latestBookedYear, stays.latestBookedYear(member));
        assertEq(state.maximumBookingYear, stays.currentMaximumBookingYear());

        uint16 targetYear = bookings[1].year;
        TokenizedStays.YearSummary memory expected = _bruteForceYearSummary(targetYear, dayIds, prices, active);
        TokenizedStays.YearSummary memory actual = stays.getYearExposureSummary(member, targetYear);
        assertEq(actual.totalDelta, expected.totalDelta);
        assertEq(actual.maxPrefix, expected.maxPrefix);

        TokenizedStays.DateInput[] memory dates = new TokenizedStays.DateInput[](1);
        dates[0] = TokenizedStays.DateInput(bookings[1].year, bookings[1].dayOfYear);
        vm.prank(member);
        stays.cancelBookings(dates);
        active[1] = false;
        expected = _bruteForceYearSummary(targetYear, dayIds, prices, active);
        actual = stays.getYearExposureSummary(member, targetYear);
        assertEq(actual.totalDelta, expected.totalDelta);
        assertEq(actual.maxPrefix, expected.maxPrefix);
    }

    function test_CurrentYearSummaryIsCalculatedButNotCached() public {
        TokenizedStays.BookingInput memory booking = _bookingAt(10, 2 ether);
        vm.prank(member);
        stays.createBookings(_singleBooking(booking));

        (bytes32 cachedTotalDelta, bytes32 cachedMaxPrefix) = _cachedYearSummarySlots(member, booking.year);
        assertEq(cachedTotalDelta, bytes32(0));
        assertEq(cachedMaxPrefix, bytes32(0));

        TokenizedStays.YearSummary memory calculated = stays.getYearExposureSummary(member, booking.year);
        assertEq(calculated.maxPrefix, int256(2 ether));
    }

    function test_RequiredBalanceQueriesAreExactAndBoundedToRetainedData() public {
        TokenizedStays.BookingInput memory booking = _bookingAt(30, 2 ether);
        vm.prank(member);
        stays.createBookings(_singleBooking(booking));
        uint32 bookedDayId = stays.toDayId(booking.year, booking.dayOfYear);

        (uint16 lastLockedYear, uint16 lastLockedDay) = stays.fromDayId(bookedDayId + 364);
        assertEq(stays.requiredLockedBalanceAt(member, lastLockedYear, lastLockedDay), 2 ether);
        (uint16 firstUnlockedYear, uint16 firstUnlockedDay) = stays.fromDayId(bookedDayId + 365);
        assertEq(stays.requiredLockedBalanceAt(member, firstUnlockedYear, firstUnlockedDay), 0);

        (uint16 pastYear, uint16 pastDay) = stays.fromDayId(stays.currentDayId() - 1);
        vm.expectPartialRevert(TokenizedStays.RequiredBalanceQueryInPast.selector);
        stays.requiredLockedBalanceAt(member, pastYear, pastDay);

        uint16 maximumYear = stays.currentMaximumBookingYear();
        uint32 lastBookingDay = stays.toDayId(maximumYear, stays.daysInYear(maximumYear));
        (uint16 beyondYear, uint16 beyondDay) = stays.fromDayId(lastBookingDay + 366);
        vm.expectPartialRevert(TokenizedStays.RequiredBalanceQueryBeyondHorizon.selector);
        stays.requiredLockedBalanceAt(member, beyondYear, beyondDay);
    }

    function test_InitializerRejectsInvalidDependenciesAndOwner() public {
        TokenizedStays implementation = new TokenizedStays();

        vm.expectPartialRevert(TokenizedStays.InvalidCommunityToken.selector);
        _proxy(
            address(implementation),
            abi.encodeCall(TokenizedStays.initialize, (outsider, address(authority), address(this)))
        );
        vm.expectPartialRevert(TokenizedStays.InvalidRoleAuthority.selector);
        _proxy(
            address(implementation),
            abi.encodeCall(TokenizedStays.initialize, (address(token), outsider, address(this)))
        );
        vm.expectPartialRevert(TokenizedStays.InvalidOwner.selector);
        _proxy(
            address(implementation),
            abi.encodeCall(TokenizedStays.initialize, (address(token), address(authority), address(0)))
        );
    }

    function testFuzz_RequiredBalanceMatchesABruteForceSparseModel(
        uint16 offsetA,
        uint16 offsetB,
        uint16 offsetC,
        uint96 rawPriceA,
        uint96 rawPriceB,
        uint96 rawPriceC
    ) public {
        uint32 today = stays.currentDayId();
        uint32 dayA = today + uint32(bound(offsetA, 1, 30));
        uint32 dayB = dayA + 1 + uint32(bound(offsetB, 0, 30));
        uint32 dayC = dayB + 1 + uint32(bound(offsetC, 0, 30));
        uint256[3] memory prices = [
            bound(uint256(rawPriceA), 0, 100 ether),
            bound(uint256(rawPriceB), 0, 100 ether),
            bound(uint256(rawPriceC), 0, 100 ether)
        ];
        uint32[3] memory dayIds = [dayA, dayB, dayC];
        TokenizedStays.BookingInput[] memory bookings = new TokenizedStays.BookingInput[](3);
        for (uint256 i = 0; i < 3; ++i) {
            (uint16 year, uint16 dayOfYear) = stays.fromDayId(dayIds[i]);
            bookings[i] = TokenizedStays.BookingInput(year, dayOfYear, prices[i]);
        }

        vm.prank(member);
        stays.createBookings(bookings);
        assertEq(stays.requiredLockedBalance(member), _bruteForce(today, dayIds, prices));
    }

    function _bruteForce(
        uint32 today,
        uint32[3] memory dayIds,
        uint256[3] memory prices
    ) private pure returns (uint256 maximum) {
        for (uint32 candidate = today; candidate <= dayIds[2] + 365; ++candidate) {
            uint256 exposure;
            for (uint256 i = 0; i < 3; ++i) {
                if (candidate >= dayIds[i] && candidate < dayIds[i] + 365) exposure += prices[i];
            }
            if (exposure > maximum) maximum = exposure;
        }
    }

    function _bruteForceYearSummary(
        uint16 year,
        uint32[3] memory dayIds,
        uint256[3] memory prices,
        bool[3] memory active
    ) private view returns (TokenizedStays.YearSummary memory summary) {
        uint32 firstDayId = stays.toDayId(year, 1);
        uint16 yearDays = stays.daysInYear(year);
        int256 prefix;
        int256 maximum;
        for (uint32 dayId = firstDayId; dayId < firstDayId + yearDays; ++dayId) {
            for (uint256 i = 0; i < 3; ++i) {
                if (!active[i]) continue;
                if (dayIds[i] == dayId) prefix += int256(prices[i]);
                if (dayIds[i] + 365 == dayId) prefix -= int256(prices[i]);
            }
            if (prefix > maximum) maximum = prefix;
        }
        summary = TokenizedStays.YearSummary(prefix, maximum);
    }

    function _cachedYearSummarySlots(
        address account,
        uint16 year
    ) private view returns (bytes32 totalDelta, bytes32 maxPrefix) {
        uint256 yearSummariesSlot = erc7201("closer.storage.TokenizedStays") + 3;
        bytes32 accountSlot = keccak256(abi.encode(account, yearSummariesSlot));
        bytes32 summarySlot = keccak256(abi.encode(uint256(year), accountSlot));
        totalDelta = vm.load(address(stays), summarySlot);
        maxPrefix = vm.load(address(stays), bytes32(uint256(summarySlot) + 1));
    }

    function _bookingAt(uint32 offset, uint256 price) private view returns (TokenizedStays.BookingInput memory) {
        (uint16 year, uint16 dayOfYear) = stays.fromDayId(stays.currentDayId() + offset);
        return TokenizedStays.BookingInput(year, dayOfYear, price);
    }

    function _singleBooking(
        TokenizedStays.BookingInput memory booking
    ) private pure returns (TokenizedStays.BookingInput[] memory bookings) {
        bookings = new TokenizedStays.BookingInput[](1);
        bookings[0] = booking;
    }
}

contract TokenizedStaysHandler is TestBase {
    TokenizedStays public immutable stays;
    TestCommunityToken public immutable token;
    address[3] public actors;
    mapping(uint256 actorIndex => uint32[]) internal _knownDays;
    mapping(uint256 actorIndex => mapping(uint32 dayId => bool)) internal _known;
    mapping(uint256 actorIndex => mapping(uint32 dayId => bool)) public exists;
    mapping(uint256 actorIndex => mapping(uint32 dayId => uint256)) public price;
    mapping(uint256 actorIndex => uint16 year) public referenceLatestYear;

    constructor(TokenizedStays stays_, TestCommunityToken token_) {
        stays = stays_;
        token = token_;
        actors[0] = makeAddr("stay-actor-0");
        actors[1] = makeAddr("stay-actor-1");
        actors[2] = makeAddr("stay-actor-2");
    }

    function deposit(uint8 rawActor, uint96 rawAmount) external {
        address actor = actors[uint256(rawActor) % actors.length];
        uint256 amount = bound(uint256(rawAmount), 0, 100 ether);
        vm.prank(actor);
        stays.deposit(amount);
    }

    function create(uint8 rawActor, uint16 rawOffset, uint96 rawPrice) external {
        uint256 actorIndex = uint256(rawActor) % actors.length;
        address actor = actors[actorIndex];
        uint32 dayId = stays.currentDayId() + uint32(bound(rawOffset, 0, 730));
        if (exists[actorIndex][dayId]) return;
        (uint16 year, uint16 dayOfYear) = stays.fromDayId(dayId);
        uint256 boundedPrice = bound(uint256(rawPrice), 0, 10 ether);
        TokenizedStays.BookingInput[] memory bookings = new TokenizedStays.BookingInput[](1);
        bookings[0] = TokenizedStays.BookingInput(year, dayOfYear, boundedPrice);

        vm.prank(actor);
        stays.createBookings(bookings);
        exists[actorIndex][dayId] = true;
        price[actorIndex][dayId] = boundedPrice;
        if (!_known[actorIndex][dayId]) {
            _known[actorIndex][dayId] = true;
            _knownDays[actorIndex].push(dayId);
        }
        if (year > referenceLatestYear[actorIndex]) referenceLatestYear[actorIndex] = year;
    }

    function cancel(uint8 rawActor, uint16 rawIndex) external {
        uint256 actorIndex = uint256(rawActor) % actors.length;
        uint32[] storage knownDays = _knownDays[actorIndex];
        if (knownDays.length == 0) return;
        uint32 dayId = knownDays[uint256(rawIndex) % knownDays.length];
        if (!exists[actorIndex][dayId] || dayId <= stays.currentDayId()) return;
        (uint16 year, uint16 dayOfYear) = stays.fromDayId(dayId);
        TokenizedStays.DateInput[] memory dates = new TokenizedStays.DateInput[](1);
        dates[0] = TokenizedStays.DateInput(year, dayOfYear);

        vm.prank(actors[actorIndex]);
        stays.cancelBookings(dates);
        exists[actorIndex][dayId] = false;
        _refreshReferenceLatestYear(actorIndex);
    }

    function prune(uint8 rawActor, uint16 rawIndex) external {
        uint256 actorIndex = uint256(rawActor) % actors.length;
        uint32[] storage knownDays = _knownDays[actorIndex];
        if (knownDays.length == 0) return;
        uint32 dayId = knownDays[uint256(rawIndex) % knownDays.length];
        if (!exists[actorIndex][dayId] || dayId + 365 > stays.currentDayId()) return;
        (uint16 year, uint16 dayOfYear) = stays.fromDayId(dayId);
        TokenizedStays.DateInput[] memory dates = new TokenizedStays.DateInput[](1);
        dates[0] = TokenizedStays.DateInput(year, dayOfYear);

        stays.pruneExpiredBookings(actors[actorIndex], dates);
        exists[actorIndex][dayId] = false;
        _refreshReferenceLatestYear(actorIndex);
    }

    function withdrawMax(uint8 rawActor) external {
        address actor = actors[uint256(rawActor) % actors.length];
        vm.prank(actor);
        stays.withdrawMax();
    }

    function transferOrphan(uint8 rawActor, uint96 rawAmount) external {
        address actor = actors[uint256(rawActor) % actors.length];
        uint256 amount = bound(uint256(rawAmount), 0, 10 ether);
        vm.prank(actor);
        token.transfer(address(stays), amount);
    }

    function advanceTime(uint16 rawDays) external {
        vm.warp(block.timestamp + bound(uint256(rawDays), 0, 30) * 1 days);
    }

    function knownDayCount(uint256 actorIndex) external view returns (uint256) {
        return _knownDays[actorIndex].length;
    }

    function knownDay(uint256 actorIndex, uint256 index) external view returns (uint32) {
        return _knownDays[actorIndex][index];
    }

    function referenceRequired(uint256 actorIndex) external view returns (uint256 maximum) {
        uint32 today = stays.currentDayId();
        uint32[] storage knownDays = _knownDays[actorIndex];
        maximum = _exposureAt(actorIndex, today, today);
        for (uint256 i = 0; i < knownDays.length; ++i) {
            if (knownDays[i] >= today) {
                uint256 exposure = _exposureAt(actorIndex, knownDays[i], today);
                if (exposure > maximum) maximum = exposure;
            }
        }
    }

    function _exposureAt(uint256 actorIndex, uint32 candidate, uint32 today) private view returns (uint256 exposure) {
        if (candidate < today) return 0;
        uint32[] storage knownDays = _knownDays[actorIndex];
        for (uint256 i = 0; i < knownDays.length; ++i) {
            uint32 dayId = knownDays[i];
            if (exists[actorIndex][dayId] && candidate >= dayId && candidate < dayId + 365) {
                exposure += price[actorIndex][dayId];
            }
        }
    }

    function _refreshReferenceLatestYear(uint256 actorIndex) private {
        (uint16 currentYear, ) = stays.fromDayId(stays.currentDayId());
        uint16 latest;
        uint32[] storage knownDays = _knownDays[actorIndex];
        for (uint256 i = 0; i < knownDays.length; ++i) {
            uint32 dayId = knownDays[i];
            if (!exists[actorIndex][dayId]) continue;
            (uint16 year, ) = stays.fromDayId(dayId);
            if (year >= currentYear && year > latest) latest = year;
        }
        referenceLatestYear[actorIndex] = latest;
    }
}

contract TokenizedStaysInvariantTest is TestBase {
    TokenizedStays internal stays;
    TestCommunityToken internal token;
    TokenizedStaysHandler internal handler;

    function setUp() public {
        vm.warp(20_000 days);
        token = new TestCommunityToken();
        RoleAuthorityHarness authority = new RoleAuthorityHarness(address(this));
        TokenizedStays implementation = new TokenizedStays();
        stays = TokenizedStays(
            _proxy(
                address(implementation),
                abi.encodeCall(TokenizedStays.initialize, (address(token), address(authority), address(this)))
            )
        );
        handler = new TokenizedStaysHandler(stays, token);
        for (uint256 i = 0; i < 3; ++i) {
            address actor = handler.actors(i);
            token.mint(actor, 1e30);
            vm.prank(actor);
            token.approve(address(stays), type(uint256).max);
        }
        targetContract(address(handler));
    }

    function invariant_DepositAndBookingAccountingMatchesTheReferenceModel() public view {
        uint256 depositedSum;
        for (uint256 actorIndex = 0; actorIndex < 3; ++actorIndex) {
            address actor = handler.actors(actorIndex);
            uint256 deposited = stays.depositedBalanceOf(actor);
            uint256 locked = stays.lockedBalanceOf(actor);
            uint256 unlocked = stays.unlockedBalanceOf(actor);
            assertEq(deposited, locked + unlocked);
            assertEq(stays.requiredLockedBalance(actor), handler.referenceRequired(actorIndex));
            depositedSum += deposited;

            _assertKnownBookingsMatch(actorIndex, actor);
            uint16 recordedLatestYear = stays.latestBookedYear(actor);
            assertEq(recordedLatestYear, handler.referenceLatestYear(actorIndex));
            if (recordedLatestYear != 0) {
                assertGt(stays.bookingCountForYear(actor, recordedLatestYear), 0);
            }
        }

        assertEq(stays.totalDepositedBalance(), depositedSum);
        assertGe(token.balanceOf(address(stays)), depositedSum);
    }

    function _assertKnownBookingsMatch(uint256 actorIndex, address actor) private view {
        uint256 knownDays = handler.knownDayCount(actorIndex);
        for (uint256 i = 0; i < knownDays; ++i) {
            uint32 dayId = handler.knownDay(actorIndex, i);
            (uint16 year, uint16 dayOfYear) = stays.fromDayId(dayId);
            (bool actualExists, TokenizedStays.BookingView memory booking) = stays.getBooking(actor, year, dayOfYear);
            bool expectedExists = handler.exists(actorIndex, dayId);
            assertEq(actualExists, expectedExists);
            if (actualExists) assertEq(booking.pricePerDate, handler.price(actorIndex, dayId));
        }
    }
}
