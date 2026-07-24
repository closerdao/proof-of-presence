// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IBondingCurve} from "../../village/interfaces/IBondingCurve.sol";

/// @title TDF V1 bonding curve
/// @author Closer DAO
/// @notice Stateless adapter preserving the historical TDF V1 primary-sale pricing formula.
/// @dev Purchase costs retain V1's integer evaluation order and cent rounding. Spot prices are normalized from V1's
/// whole-euro output to 18-decimal quote-token base units. The 200,000 TDF upper bound is a mathematical safety domain,
/// not a token or sale supply cap.
contract TDFV1BondingCurve is IBondingCurve, ERC165 {
    /// @notice Decimal precision required from the quote token.
    uint8 public constant QUOTE_TOKEN_DECIMALS = 18;
    /// @notice Lowest total supply accepted by the historical formula.
    uint256 public constant MIN_CURVE_SUPPLY = 4_109 ether;
    /// @notice Highest total supply accepted by the historical formula.
    uint256 public constant MAX_CURVE_SUPPLY = 200_000 ether;

    int256 private constant C = 420;
    int256 private constant A = 11_680_057_722 * 1e36;
    int256 private constant B = 32_000_461_777_723 * 1e54;

    error SupplyBelowCurveMinimum(uint256 currentSupply, uint256 minimumSupply);
    error SupplyAboveCurveMaximum(uint256 resultingSupply, uint256 maximumSupply);
    error InvalidPurchaseAmount(uint256 amount);

    /// @inheritdoc IBondingCurve
    function quoteTokenDecimals() external pure returns (uint8) {
        return QUOTE_TOKEN_DECIMALS;
    }

    /// @inheritdoc IBondingCurve
    function currentPrice(uint256 currentSupply) public pure returns (uint256) {
        _validateSupply(currentSupply);
        return _calculateRawPrice(int256(currentSupply)) * 1 ether;
    }

    /// @inheritdoc IBondingCurve
    function quotePurchase(
        uint256 currentSupply,
        uint256 amount
    ) external pure returns (uint256 totalPayment, uint256 postPurchasePrice) {
        if (amount == 0) revert InvalidPurchaseAmount(amount);
        if (currentSupply < MIN_CURVE_SUPPLY) {
            revert SupplyBelowCurveMinimum(currentSupply, MIN_CURVE_SUPPLY);
        }
        if (currentSupply > MAX_CURVE_SUPPLY) {
            revert SupplyAboveCurveMaximum(currentSupply, MAX_CURVE_SUPPLY);
        }
        if (amount > MAX_CURVE_SUPPLY - currentSupply) {
            revert SupplyAboveCurveMaximum(Math.saturatingAdd(currentSupply, amount), MAX_CURVE_SUPPLY);
        }

        int256 supplyBeforeBuy = int256(currentSupply);
        int256 supplyAfterBuy = supplyBeforeBuy + int256(amount);
        // Exact V1 parity requires retaining its integer evaluation and truncation order.
        // slither-disable-next-line divide-before-multiply
        int256 inducedCost =
            C * 1e54 * (supplyAfterBuy - supplyBeforeBuy) +
                A * ((int256(1e54) / supplyAfterBuy) - (int256(1e54) / supplyBeforeBuy)) -
                (B / 2) * ((int256(1e54) / supplyAfterBuy ** 2) - (int256(1e54) / supplyBeforeBuy ** 2));

        // slither-disable-next-line divide-before-multiply
        totalPayment = uint256((inducedCost / 1e70) * 1e16);
        postPurchasePrice = _calculateRawPrice(supplyAfterBuy) * 1 ether;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IBondingCurve).interfaceId || super.supportsInterface(interfaceId);
    }

    function _validateSupply(uint256 supply) private pure {
        if (supply < MIN_CURVE_SUPPLY) revert SupplyBelowCurveMinimum(supply, MIN_CURVE_SUPPLY);
        if (supply > MAX_CURVE_SUPPLY) revert SupplyAboveCurveMaximum(supply, MAX_CURVE_SUPPLY);
    }

    function _calculateRawPrice(int256 tokenSupply) private pure returns (uint256) {
        return uint256(C - (A / tokenSupply ** 2) + (B / tokenSupply ** 3));
    }
}
