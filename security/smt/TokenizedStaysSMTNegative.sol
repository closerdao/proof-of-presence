// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Deliberately false assertion proving the SMT result parser detects counterexamples.
contract TokenizedStaysSMTNegative {
    function negativeControl() external pure {
        assert(false);
    }
}
