// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {GregorianDateMath} from "../../src/village/libraries/GregorianDateMath.sol";
import {TokenizedStaysExposure} from "../../src/village/libraries/TokenizedStaysExposure.sol";

contract GregorianDateMathHarness {
    uint16 internal constant EPOCH_YEAR = 1970;

    function daysInYear(uint16 year) external pure returns (uint16) {
        return GregorianDateMath.daysInYear(year);
    }

    function toDayId(uint16 year, uint16 dayOfYear) external pure returns (uint32) {
        return uint32(GregorianDateMath.toDayId(EPOCH_YEAR, year, dayOfYear));
    }

    function fromDayId(uint32 dayId) external pure returns (uint16 year, uint16 dayOfYear) {
        return GregorianDateMath.fromDayId(EPOCH_YEAR, dayId);
    }
}

contract TokenizedStaysExposureHarness {
    mapping(uint32 dayId => uint256 encodedPrice) internal _bookingPricePlusOne;

    function setPrice(uint32 dayId, uint256 price) external {
        _bookingPricePlusOne[dayId] = price + 1;
    }

    function decodePrice(uint256 encodedPrice) external pure returns (uint256) {
        return TokenizedStaysExposure.decodePrice(encodedPrice);
    }

    function activeExposure(uint32 dayId, uint32 lockDays) external view returns (int256) {
        return TokenizedStaysExposure.activeExposure(_bookingPricePlusOne, dayId, lockDays);
    }

    function dailyDelta(uint32 dayId, uint32 lockDays) external view returns (int256) {
        return TokenizedStaysExposure.dailyDelta(_bookingPricePlusOne, dayId, lockDays);
    }

    function scanRange(
        uint32 firstDay,
        uint32 lastDay,
        uint32 lockDays,
        int256 enteringExposure
    ) external view returns (int256 endingExposure, int256 maximum) {
        return TokenizedStaysExposure.scanRange(_bookingPricePlusOne, firstDay, lastDay, lockDays, enteringExposure);
    }

    function summarizeYear(
        uint32 firstDayId,
        uint16 yearDays,
        uint32 lockDays
    ) external view returns (int256 totalDelta, int256 maxPrefix) {
        return TokenizedStaysExposure.summarizeYear(_bookingPricePlusOne, firstDayId, yearDays, lockDays);
    }

    function applyYearSummary(
        int256 exposure,
        int256 maximum,
        int256 totalDelta,
        int256 maxPrefix
    ) external pure returns (int256 endingExposure, int256 updatedMaximum) {
        return TokenizedStaysExposure.applyYearSummary(exposure, maximum, totalDelta, maxPrefix);
    }

    function expiryYear(
        uint16 bookingYear,
        uint32 bookingDayId,
        uint32 firstDayOfNextYear,
        uint32 lockDays
    ) external pure returns (uint16) {
        return TokenizedStaysExposure.expiryYear(bookingYear, bookingDayId, firstDayOfNextYear, lockDays);
    }

    function markSummaryYear(uint256 mask, uint16 baseYear, uint16 year) external pure returns (uint256) {
        return TokenizedStaysExposure.markSummaryYear(mask, baseYear, year);
    }
}

contract TokenizedStaysMathTest is Test {
    uint32 internal constant LOCK_DAYS = 365;
    GregorianDateMathHarness internal dates;
    TokenizedStaysExposureHarness internal exposure;

    function setUp() public {
        dates = new GregorianDateMathHarness();
        exposure = new TokenizedStaysExposureHarness();
    }

    function testFuzz_GregorianLibraryRoundTrips(uint16 rawYear, uint16 rawDay) public view {
        uint16 year = uint16(bound(rawYear, 1970, type(uint16).max));
        uint16 dayOfYear = uint16(bound(rawDay, 1, dates.daysInYear(year)));
        uint32 dayId = dates.toDayId(year, dayOfYear);

        (uint16 decodedYear, uint16 decodedDay) = dates.fromDayId(dayId);
        assertEq(decodedYear, year);
        assertEq(decodedDay, dayOfYear);
    }

    function test_GregorianLibraryHandlesCenturyBoundaries() public view {
        assertEq(dates.daysInYear(2000), 366);
        assertEq(dates.daysInYear(2100), 365);
        assertEq(dates.daysInYear(2400), 366);
    }

    function test_PlusOneEncodingPreservesZeroPriceBooking() public view {
        assertEq(exposure.decodePrice(0), 0);
        assertEq(exposure.decodePrice(1), 0);
        assertEq(exposure.decodePrice(8), 7);
    }

    function test_ExposureLibraryPreservesExact365DayWindow() public {
        exposure.setPrice(10, 2 ether);
        exposure.setPrice(374, 3 ether);

        assertEq(exposure.activeExposure(374, LOCK_DAYS), 5 ether);
        assertEq(exposure.activeExposure(375, LOCK_DAYS), 3 ether);
        assertEq(exposure.dailyDelta(374, LOCK_DAYS), 3 ether);
        assertEq(exposure.dailyDelta(375, LOCK_DAYS), -2 ether);
    }

    function test_EmptyExposureAndZeroDaySummaryReturnZero() public view {
        assertEq(exposure.activeExposure(100, LOCK_DAYS), 0);
        assertEq(exposure.activeExposure(100, 0), 0);

        (int256 totalDelta, int256 maxPrefix) = exposure.summarizeYear(10, 0, LOCK_DAYS);
        assertEq(totalDelta, 0);
        assertEq(maxPrefix, 0);
    }

    function test_RangeScanAndYearSummaryUseTheSamePrefixModel() public {
        exposure.setPrice(10, 2 ether);
        exposure.setPrice(374, 3 ether);

        (int256 endingExposure, int256 maximum) = exposure.scanRange(11, 375, LOCK_DAYS, 2 ether);
        assertEq(endingExposure, 3 ether);
        assertEq(maximum, 5 ether);

        (int256 totalDelta, int256 maxPrefix) = exposure.summarizeYear(10, 366, LOCK_DAYS);
        assertEq(totalDelta, 3 ether);
        assertEq(maxPrefix, 5 ether);
    }

    function test_AppliesCachedSummaryAndMarksOnlyFutureYears() public view {
        (int256 endingExposure, int256 maximum) = exposure.applyYearSummary(7, 7, -2, 3);
        assertEq(endingExposure, 5);
        assertEq(maximum, 10);

        assertEq(exposure.markSummaryYear(4, 2026, 2026), 4);
        assertEq(exposure.markSummaryYear(4, 2026, 2028), 4 | (uint256(1) << 2));
    }

    function test_ExpiryYearUsesTheHalfOpenLockEnd() public view {
        assertEq(exposure.expiryYear(2028, 0, 366, LOCK_DAYS), 2028);
        assertEq(exposure.expiryYear(2027, 0, 365, LOCK_DAYS), 2028);
    }
}
