// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title Bonding curve interface
/// @author Closer DAO
/// @notice Stateless pricing seam used by DynamicPriceSale.
/// @dev Supply and purchase amounts use 18-decimal CommunityToken base units. Payment and price outputs use the
/// configured quote token's base units. `currentPrice` is the quote-token amount for one whole `1e18` CommunityToken.
interface IBondingCurve is IERC165 {
    /// @notice Returns the quote-token decimals expected by this curve.
    function quoteTokenDecimals() external view returns (uint8);

    /// @notice Returns the spot price at `currentSupply`.
    /// @param currentSupply CommunityToken total supply in 18-decimal base units.
    function currentPrice(uint256 currentSupply) external view returns (uint256);

    /// @notice Quotes a primary issuance purchase from `currentSupply`.
    /// @param currentSupply CommunityToken total supply before the purchase.
    /// @param amount CommunityToken amount purchased in 18-decimal base units.
    /// @return totalPayment Total quote-token amount charged for the purchase.
    /// @return postPurchasePrice Spot price after adding `amount` to the supply.
    function quotePurchase(
        uint256 currentSupply,
        uint256 amount
    ) external view returns (uint256 totalPayment, uint256 postPurchasePrice);
}
