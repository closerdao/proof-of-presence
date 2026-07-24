// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @title CommunityToken sale interface
/// @author Closer DAO
/// @notice Minimal CommunityToken interface required by primary-issuance modules.
interface ICommunityToken is IERC20Metadata {
    /// @notice Returns the owner-governed ceiling enforced for total supply.
    function maxSupply() external view returns (uint256);

    /// @notice Mints tokens under the CommunityToken's MINTER_ROLE authorization.
    /// @param account Recipient of the newly minted tokens.
    /// @param amount Amount minted in the token's smallest unit.
    function mint(address account, uint256 amount) external;
}
