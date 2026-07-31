// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {GregorianDateMath} from "../../src/village/libraries/GregorianDateMath.sol";
import {TokenizedStaysExposure} from "../../src/village/libraries/TokenizedStaysExposure.sol";

/// @notice SMTChecker assertions for the pure calendar operations used by TokenizedStays.
contract GregorianDateMathSMT {
    uint16 internal constant EPOCH_YEAR = 1970;

    function proveLeapYearRules(uint16 year) external pure {
        require(year >= EPOCH_YEAR);
        uint16 yearDays = GregorianDateMath.daysInYear(year);
        assert(yearDays == 365 || yearDays == 366); // SMT: DATE-DAYS-RANGE
        if (year % 400 == 0) assert(yearDays == 366); // SMT: DATE-LEAP-400
        if (year % 100 == 0 && year % 400 != 0) assert(yearDays == 365); // SMT: DATE-COMMON-100
        if (year % 4 == 0 && year % 100 != 0) assert(yearDays == 366); // SMT: DATE-LEAP-4
    }

    function proveRoundTrip(uint16 year, uint16 dayOfYear) external pure {
        require(year >= EPOCH_YEAR);
        require(dayOfYear > 0 && dayOfYear <= GregorianDateMath.daysInYear(year));
        uint256 rawDayId = GregorianDateMath.toDayId(EPOCH_YEAR, year, dayOfYear);
        assert(rawDayId <= type(uint32).max); // SMT: DATE-DAY-ID-RANGE
        (uint16 decodedYear, uint16 decodedDay) = GregorianDateMath.fromDayId(EPOCH_YEAR, uint32(rawDayId));
        assert(decodedYear == year); // SMT: DATE-ROUNDTRIP-YEAR
        assert(decodedDay == dayOfYear); // SMT: DATE-ROUNDTRIP-DAY
    }

    function proveConsecutiveDays(uint16 year, uint16 dayOfYear) external pure {
        require(year >= EPOCH_YEAR);
        require(dayOfYear > 0 && dayOfYear < GregorianDateMath.daysInYear(year));
        uint256 current = GregorianDateMath.toDayId(EPOCH_YEAR, year, dayOfYear);
        uint256 next = GregorianDateMath.toDayId(EPOCH_YEAR, year, dayOfYear + 1);
        assert(next == current + 1); // SMT: DATE-CONSECUTIVE
    }
}

/// @notice SMTChecker assertions for the pure exposure operations used by TokenizedStays.
contract TokenizedStaysExposureSMT {
    uint32 internal constant LOCK_DAYS = 365;
    uint256 internal constant MAX_PRICE_PER_DATE = uint256(type(int256).max) / uint256(LOCK_DAYS);

    function provePriceBound(uint256 price, uint16 overlapCount) external pure {
        require(price <= MAX_PRICE_PER_DATE);
        require(overlapCount <= LOCK_DAYS);
        assert(MAX_PRICE_PER_DATE * LOCK_DAYS <= uint256(type(int256).max)); // SMT: EXPOSURE-MAX-BOUND
        assert((MAX_PRICE_PER_DATE + 1) * LOCK_DAYS > uint256(type(int256).max)); // SMT: EXPOSURE-MAX-TIGHT
        assert(price * overlapCount <= uint256(type(int256).max)); // SMT: EXPOSURE-INPUT-BOUND
    }

    function provePlusOneEncoding(uint256 price) external pure {
        require(price <= MAX_PRICE_PER_DATE);
        uint256 encodedPrice = price + 1;
        assert(encodedPrice != 0); // SMT: ENCODING-PRESENT
        assert(TokenizedStaysExposure.decodePrice(encodedPrice) == price); // SMT: ENCODING-ROUNDTRIP
        assert(TokenizedStaysExposure.decodePrice(0) == 0); // SMT: ENCODING-EMPTY
        assert(TokenizedStaysExposure.decodePrice(1) == 0); // SMT: ENCODING-ZERO-PRICE
    }

    function provePriceDelta(uint256 starting, uint256 ending) external pure {
        require(starting <= MAX_PRICE_PER_DATE);
        require(ending <= MAX_PRICE_PER_DATE);
        int256 delta = TokenizedStaysExposure.priceDelta(starting, ending);
        assert(delta == int256(starting) - int256(ending)); // SMT: DELTA-DEFINITION
        assert(delta <= int256(MAX_PRICE_PER_DATE)); // SMT: DELTA-UPPER-BOUND
        assert(delta >= -int256(MAX_PRICE_PER_DATE)); // SMT: DELTA-LOWER-BOUND
    }

    function proveDeltaApplication(int256 exposure, int256 maximum, int256 delta) external pure {
        require(exposure >= 0);
        require(maximum >= exposure);
        require(delta >= -exposure);
        require(delta <= type(int256).max - exposure);
        (int256 updatedExposure, int256 updatedMaximum) = TokenizedStaysExposure.applyDelta(exposure, maximum, delta);
        assert(updatedExposure >= 0); // SMT: APPLY-DELTA-NONNEGATIVE
        assert(updatedExposure <= type(int256).max); // SMT: APPLY-DELTA-SIGNED-RANGE
        assert(updatedMaximum >= maximum); // SMT: APPLY-DELTA-PRESERVES-MAX
        assert(updatedMaximum >= updatedExposure); // SMT: APPLY-DELTA-COVERS-EXPOSURE
        assert(updatedMaximum == (updatedExposure > maximum ? updatedExposure : maximum)); // SMT: APPLY-DELTA-DEFINITION
    }

    function proveSummaryApplication(
        int256 exposure,
        int256 maximum,
        int256 totalDelta,
        int256 maxPrefix
    ) external pure {
        require(exposure >= 0);
        require(maximum >= exposure);
        require(maxPrefix >= 0 && maxPrefix <= type(int256).max - exposure);
        require(totalDelta >= -exposure && totalDelta <= type(int256).max - exposure);
        (int256 endingExposure, int256 updatedMaximum) = TokenizedStaysExposure.applyYearSummary(
            exposure,
            maximum,
            totalDelta,
            maxPrefix
        );
        assert(endingExposure >= 0); // SMT: SUMMARY-NONNEGATIVE
        assert(updatedMaximum >= maximum); // SMT: SUMMARY-PRESERVES-MAX
        assert(updatedMaximum >= exposure); // SMT: SUMMARY-COVERS-ENTRY
        assert(updatedMaximum == (exposure + maxPrefix > maximum ? exposure + maxPrefix : maximum)); // SMT: SUMMARY-MAX
        assert(endingExposure == exposure + totalDelta); // SMT: SUMMARY-ENDING
    }

    function proveExpiryYear(uint16 bookingYear, uint32 bookingDayId, uint32 firstDayOfNextYear) external pure {
        require(bookingYear < type(uint16).max);
        uint16 expiryYear = TokenizedStaysExposure.expiryYear(bookingYear, bookingDayId, firstDayOfNextYear, LOCK_DAYS);
        assert(expiryYear == bookingYear || expiryYear == bookingYear + 1); // SMT: EXPIRY-YEAR-RANGE
        if (uint256(bookingDayId) + LOCK_DAYS < firstDayOfNextYear) {
            assert(expiryYear == bookingYear); // SMT: EXPIRY-SAME-YEAR
        } else {
            assert(expiryYear == bookingYear + 1); // SMT: EXPIRY-NEXT-YEAR
        }
    }
}
