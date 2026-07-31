// SPDX-License-Identifier: CC0-1.0
pragma solidity 0.8.35;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title Minimal Soulbound NFTs
/// @author Closer DAO
/// @notice ERC-5192 interface for ERC-721 tokens whose transferability is permanently locked.
interface IERC5192 is IERC165 {
    /// @notice Emitted when a token becomes non-transferable.
    /// @param tokenId Token whose transferability was locked.
    event Locked(uint256 tokenId);

    // The standard requires this event declaration, but VillageCitizenNFT is permanently locked.
    /// @notice Emitted when a token becomes transferable.
    /// @param tokenId Token whose transferability was unlocked.
    event Unlocked(uint256 tokenId); // wake-disable-line unused-event

    /// @notice Returns whether an existing token is non-transferable.
    /// @param tokenId Token to query.
    function locked(uint256 tokenId) external view returns (bool);
}
