// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {DecayMathHarness, V2TestBase} from "./V2TestBase.sol";

contract V2DecayMathTest is V2TestBase {
    uint256 internal constant SCALE = 1e18;
    DecayMathHarness internal harness;

    function setUp() public {
        harness = new DecayMathHarness();
    }

    function test_SpecialRootCases() public view {
        assertEq(harness.nthRoot(0, 365, SCALE), 0);
        assertEq(harness.nthRoot(SCALE / 2, 0, SCALE), SCALE);
        assertEq(harness.nthRoot(SCALE / 2, 1, SCALE), SCALE / 2);
    }

    function testFuzz_PowerStaysWithinRetentionBounds(uint256 base, uint16 exponent) public view {
        base = bound(base, 0, SCALE);
        exponent = uint16(bound(exponent, 0, 365));

        uint256 result = harness.powWithPrecision(base, exponent, SCALE);
        assertLe(result, SCALE);
        if (exponent == 0) assertEq(result, SCALE);
        if (base == 0 && exponent > 0) assertEq(result, 0);
        if (base == SCALE) assertEq(result, SCALE);
    }

    function testFuzz_MoreElapsedDaysCannotIncreaseRetention(uint256 base, uint16 exponent) public view {
        base = bound(base, 0, SCALE);
        exponent = uint16(bound(exponent, 0, 364));

        uint256 beforeValue = harness.powWithPrecision(base, exponent, SCALE);
        uint256 afterValue = harness.powWithPrecision(base, uint256(exponent) + 1, SCALE);
        assertLe(afterValue, beforeValue);
    }

    function testFuzz_NthRootChoosesANearestAdjacentCandidate(uint256 value, uint16 n) public view {
        value = bound(value, 0, SCALE);
        n = uint16(bound(n, 2, 365));

        uint256 root = harness.nthRoot(value, n, SCALE);
        assertLe(root, SCALE);
        uint256 distance = _distance(harness.powWithPrecision(root, n, SCALE), value);

        if (root > 0) {
            uint256 lowerDistance = _distance(harness.powWithPrecision(root - 1, n, SCALE), value);
            assertLe(distance, lowerDistance);
        }
        if (root < SCALE) {
            uint256 upperDistance = _distance(harness.powWithPrecision(root + 1, n, SCALE), value);
            assertLe(distance, upperDistance);
        }
    }

    function _distance(uint256 left, uint256 right) private pure returns (uint256) {
        return left > right ? left - right : right - left;
    }
}
