// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title Tokenized-stays exposure arithmetic
/// @author Closer DAO
/// @notice Internal helpers for calculating booking-lock exposure from plus-one encoded per-date prices.
/// @dev Stored prices must be bounded so every valid overlapping sum fits in `int256`.
library TokenizedStaysExposure {
    /// @notice Decodes a stored booking price while preserving zero as the empty-slot sentinel.
    /// @param bookingPricePlusOne Per-date plus-one encoded booking prices.
    /// @param dayId Day whose decoded price is requested.
    /// @return Decoded price, or zero for an empty slot or zero-price booking.
    function priceForDay(
        mapping(uint32 dayId => uint256 encodedPrice) storage bookingPricePlusOne,
        uint32 dayId
    ) internal view returns (uint256) {
        return decodePrice(bookingPricePlusOne[dayId]);
    }

    /// @notice Decodes a plus-one price; both an empty slot and an encoded zero-price booking decode to zero.
    /// @param encodedPrice Stored plus-one encoded price.
    /// @return Decoded price.
    function decodePrice(uint256 encodedPrice) internal pure returns (uint256) {
        return encodedPrice == 0 ? 0 : encodedPrice - 1;
    }

    /// @notice Sums prices whose half-open lock intervals contain `dayId`.
    /// @param bookingPricePlusOne Per-date plus-one encoded booking prices.
    /// @param dayId Day for which active exposure is calculated.
    /// @param lockDays Number of days in every half-open lock interval.
    /// @return exposure Sum of prices active on `dayId`.
    function activeExposure(
        mapping(uint32 dayId => uint256 encodedPrice) storage bookingPricePlusOne,
        uint32 dayId,
        uint32 lockDays
    ) internal view returns (int256 exposure) {
        if (lockDays == 0) return 0;
        uint32 firstActiveDay = dayId >= lockDays - 1 ? dayId - (lockDays - 1) : 0;

        for (uint32 candidate = firstActiveDay; ; ) {
            exposure += int256(priceForDay(bookingPricePlusOne, candidate));
            if (candidate == dayId) break;
            unchecked {
                ++candidate;
            }
        }
        return exposure;
    }

    /// @notice Returns the price starting on `dayId` minus the price expiring on that day.
    /// @param bookingPricePlusOne Per-date plus-one encoded booking prices.
    /// @param dayId Day whose exposure delta is calculated.
    /// @param lockDays Number of days in every half-open lock interval.
    /// @return Signed start-minus-expiry exposure delta.
    function dailyDelta(
        mapping(uint32 dayId => uint256 encodedPrice) storage bookingPricePlusOne,
        uint32 dayId,
        uint32 lockDays
    ) internal view returns (int256) {
        uint256 starting = priceForDay(bookingPricePlusOne, dayId);
        uint256 ending = dayId >= lockDays ? priceForDay(bookingPricePlusOne, dayId - lockDays) : 0;
        return priceDelta(starting, ending);
    }

    /// @notice Returns a signed start-minus-expiry price delta.
    /// @param starting Price whose lock begins.
    /// @param ending Price whose lock expires.
    /// @return Signed difference between `starting` and `ending`.
    function priceDelta(uint256 starting, uint256 ending) internal pure returns (int256) {
        return int256(starting) - int256(ending);
    }

    /// @notice Scans an inclusive day range and returns its ending and maximum exposure.
    /// @param bookingPricePlusOne Per-date plus-one encoded booking prices.
    /// @param firstDay First day included in the scan.
    /// @param lastDay Last day included in the scan.
    /// @param lockDays Number of days in every half-open lock interval.
    /// @param enteringExposure Exposure immediately before `firstDay`.
    /// @return endingExposure Exposure after applying `lastDay`.
    /// @return maximum Maximum exposure encountered, including `enteringExposure`.
    function scanRange(
        mapping(uint32 dayId => uint256 encodedPrice) storage bookingPricePlusOne,
        uint32 firstDay,
        uint32 lastDay,
        uint32 lockDays,
        int256 enteringExposure
    ) internal view returns (int256 endingExposure, int256 maximum) {
        endingExposure = enteringExposure;
        maximum = enteringExposure;
        if (firstDay > lastDay) return (endingExposure, maximum);

        for (uint32 dayId = firstDay; ; ) {
            (endingExposure, maximum) = applyDelta(
                endingExposure,
                maximum,
                dailyDelta(bookingPricePlusOne, dayId, lockDays)
            );
            if (dayId == lastDay) break;
            unchecked {
                ++dayId;
            }
        }
    }

    /// @notice Builds a total-delta and maximum-prefix summary over an inclusive year range.
    /// @param bookingPricePlusOne Per-date plus-one encoded booking prices.
    /// @param firstDayId First day ID of the summarized year.
    /// @param yearDays Number of days in the summarized year.
    /// @param lockDays Number of days in every half-open lock interval.
    /// @return totalDelta Net exposure change across the year.
    /// @return maxPrefix Maximum cumulative daily delta relative to zero before the year.
    function summarizeYear(
        mapping(uint32 dayId => uint256 encodedPrice) storage bookingPricePlusOne,
        uint32 firstDayId,
        uint16 yearDays,
        uint32 lockDays
    ) internal view returns (int256 totalDelta, int256 maxPrefix) {
        uint32 dayId = firstDayId;
        for (uint256 i = 0; i < yearDays; ) {
            (totalDelta, maxPrefix) = applyDelta(
                totalDelta,
                maxPrefix,
                dailyDelta(bookingPricePlusOne, dayId, lockDays)
            );
            unchecked {
                ++i;
                ++dayId;
            }
        }
        return (totalDelta, maxPrefix);
    }

    /// @notice Applies one signed delta and updates a running maximum.
    /// @param exposure Exposure before applying `delta`.
    /// @param maximum Maximum exposure observed before applying `delta`.
    /// @param delta Signed exposure change.
    /// @return updatedExposure Exposure after applying `delta`.
    /// @return updatedMaximum Maximum including `updatedExposure`.
    function applyDelta(
        int256 exposure,
        int256 maximum,
        int256 delta
    ) internal pure returns (int256 updatedExposure, int256 updatedMaximum) {
        updatedExposure = exposure + delta;
        updatedMaximum = updatedExposure > maximum ? updatedExposure : maximum;
    }

    /// @notice Applies a cached year's maximum prefix and total delta to an entering exposure.
    /// @param exposure Exposure entering the summarized year.
    /// @param maximum Maximum exposure observed before the summarized year.
    /// @param totalDelta Net exposure change across the summarized year.
    /// @param maxPrefix Maximum cumulative daily delta within the year.
    /// @return endingExposure Exposure after the summarized year.
    /// @return updatedMaximum Maximum including the summarized year.
    function applyYearSummary(
        int256 exposure,
        int256 maximum,
        int256 totalDelta,
        int256 maxPrefix
    ) internal pure returns (int256 endingExposure, int256 updatedMaximum) {
        int256 yearMaximum = exposure + maxPrefix;
        updatedMaximum = yearMaximum > maximum ? yearMaximum : maximum;
        endingExposure = exposure + totalDelta;
    }

    /// @notice Returns the booking or following year in which a fixed-day lock expires.
    /// @param bookingYear Calendar year containing the booking day.
    /// @param bookingDayId Absolute booking day identifier.
    /// @param firstDayOfNextYear Absolute day identifier of January 1 after `bookingYear`.
    /// @param lockDays Number of days in the half-open lock interval.
    /// @return Calendar year containing the lock's exclusive end.
    function expiryYear(
        uint16 bookingYear,
        uint32 bookingDayId,
        uint32 firstDayOfNextYear,
        uint32 lockDays
    ) internal pure returns (uint16) {
        return uint256(bookingDayId) + lockDays < firstDayOfNextYear ? bookingYear : bookingYear + 1;
    }

    /// @notice Marks a non-current summary year relative to `baseYear` in a bit mask.
    /// @param mask Existing summary-year bit mask.
    /// @param baseYear Year represented by bit zero.
    /// @param year Year to mark when it is later than `baseYear`.
    /// @return Updated summary-year bit mask.
    function markSummaryYear(uint256 mask, uint16 baseYear, uint16 year) internal pure returns (uint256) {
        if (year <= baseYear) return mask;
        uint256 offset = uint256(year) - baseYear;
        return mask | (uint256(1) << offset);
    }
}
