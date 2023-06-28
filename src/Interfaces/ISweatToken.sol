// SPDX-License-Identifier: AGPL-1.0
pragma solidity 0.8.9;

interface ISweatToken {
    //--------------------------------------------------------------------------
    // Errors

    /// @notice Maximum of Sweat tokens have been reached
    error SweatToken_MaxSweatSupplyReached();
    /// @notice Minting amount + current supply exceeds max Sweat tokens
    error SweatToken_MintAmountExceedsMaxSupply();
    /// @notice Sweat token is non-transferable
    error SweatToken_SweatIsNonTransferable();
}
