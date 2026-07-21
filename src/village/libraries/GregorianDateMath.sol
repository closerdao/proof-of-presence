// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title Gregorian calendar arithmetic
/// @author Closer DAO
/// @notice Pure helpers for converting between Gregorian dates and zero-based day identifiers.
/// @dev Callers are responsible for validating the epoch, year, day-of-year, and supported output range.
library GregorianDateMath {
    /// @notice Returns 365 or 366 according to Gregorian leap-year rules.
    /// @param year Gregorian year to inspect.
    /// @return Number of days in `year`.
    function daysInYear(uint256 year) internal pure returns (uint16) {
        return isLeapYear(year) ? 366 : 365;
    }

    /// @notice Converts a validated Gregorian date to a zero-based day identifier relative to `epochYear`.
    /// @param epochYear Gregorian year represented by day ID zero.
    /// @param year Validated Gregorian year to convert.
    /// @param dayOfYear Validated one-based day within `year`.
    /// @return Zero-based day identifier relative to `epochYear`.
    function toDayId(uint16 epochYear, uint16 year, uint16 dayOfYear) internal pure returns (uint256) {
        return daysBeforeYear(year) - daysBeforeYear(epochYear) + dayOfYear - 1;
    }

    /// @notice Converts a validated zero-based day identifier to a Gregorian date.
    /// @dev The caller must ensure the result fits in a `uint16` year before calling.
    /// @param epochYear Gregorian year represented by day ID zero.
    /// @param dayId Zero-based day identifier relative to `epochYear`.
    /// @return year Gregorian year containing `dayId`.
    /// @return dayOfYear One-based day within `year`.
    function fromDayId(uint16 epochYear, uint32 dayId) internal pure returns (uint16 year, uint16 dayOfYear) {
        uint256 absoluteDay = uint256(dayId) + daysBeforeYear(epochYear);
        uint256 low = epochYear;
        uint256 high = uint256(type(uint16).max) + 1;

        while (low + 1 < high) {
            uint256 middle = (low + high) / 2;
            if (daysBeforeYear(middle) <= absoluteDay) {
                low = middle;
            } else {
                high = middle;
            }
        }

        year = uint16(low);
        dayOfYear = uint16(absoluteDay - daysBeforeYear(low) + 1);
    }

    /// @notice Returns the number of complete Gregorian days preceding January 1 of `year`.
    /// @dev `year` must be greater than zero.
    /// @param year Gregorian year whose preceding days are counted.
    /// @return Number of complete days before January 1 of `year`.
    function daysBeforeYear(uint256 year) internal pure returns (uint256) {
        uint256 completedYears = year - 1;
        return 365 * completedYears + completedYears / 4 - completedYears / 100 + completedYears / 400;
    }

    /// @notice Returns whether `year` is a Gregorian leap year.
    /// @param year Gregorian year to inspect.
    /// @return Whether `year` contains February 29.
    function isLeapYear(uint256 year) internal pure returns (bool) {
        // Modulo is deterministic calendar arithmetic, not a source of randomness.
        // Equality is required by the Gregorian leap-year definition.
        // slither-disable-next-line weak-prng,incorrect-equality
        return year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    }
}
