// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title Fixed-point decay math
/// @author Closer DAO
/// @notice Exponentiation and root helpers used to convert and apply decay rates.
library DecayMath {
    /// @notice Raises a scaled fixed-point value to an integer exponent.
    /// @dev Uses exponentiation by squaring and rounds down after each fixed-point multiplication. `base` is expected
    /// to use `scale` as one whole unit; an exponent of zero returns `scale`.
    /// @param base Scaled fixed-point base.
    /// @param exponent Non-negative integer exponent.
    /// @param scale Fixed-point representation of one.
    /// @return result Scaled approximation of `base ** exponent`.
    function powWithPrecision(uint256 base, uint256 exponent, uint256 scale) internal pure returns (uint256 result) {
        result = scale;
        while (exponent > 0) {
            if (exponent & 1 == 1) {
                result = Math.mulDiv(result, base, scale);
            }
            base = Math.mulDiv(base, base, scale);
            exponent >>= 1;
        }
    }

    /// @notice Approximates the nth root of a scaled retention value.
    /// @dev The caller must provide `value <= scale`. The binary search returns the representable candidate whose nth
    /// power is closest to `value`, rounding ties upward. Zero always returns zero; for nonzero values, `n == 0` returns
    /// `scale` as a conversion convenience.
    /// @param value Scaled value in the inclusive range `[0, scale]`.
    /// @param n Root degree.
    /// @param scale Fixed-point representation of one.
    /// @return root Scaled approximation of the nth root.
    function nthRoot(uint256 value, uint256 n, uint256 scale) internal pure returns (uint256) {
        if (value == 0) return 0;
        if (n == 0) return scale;
        if (n == 1) return value;

        uint256 low = 0;
        uint256 high = scale;

        // Retain V1's bounded binary search. For decay retention values both
        // the input and its nth root are in [0, scale], which keeps every
        // fixed-point power bounded and avoids Newton iteration overshooting.
        while (high - low > 1) {
            uint256 mid = (low + high) / 2;
            uint256 midToN = powWithPrecision(mid, n, scale);

            // Exact equality is the binary search's successful termination condition.
            // slither-disable-next-line incorrect-equality
            if (midToN == value) return mid;
            if (midToN < value) {
                low = mid;
            } else {
                high = mid;
            }
        }

        uint256 lowToN = powWithPrecision(low, n, scale);
        uint256 highToN = powWithPrecision(high, n, scale);
        return value - lowToN < highToN - value ? low : high;
    }
}
