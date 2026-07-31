// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title Community token transfer policy
/// @author Closer DAO
/// @notice Optional policy hook used by CommunityToken to approve or reject every balance update.
/// @dev Implementations must advertise this interface through ERC-165. The hook also receives mints and burns, where
/// `from` or `to` is the zero address, so policies must define those cases deliberately.
interface ITransferPolicy is IERC165 {
    /// @notice Returns whether a token balance update is permitted.
    /// @param token CommunityToken instance requesting the decision.
    /// @param operator Caller that initiated the transfer, mint, or burn.
    /// @param from Source account, or the zero address for a mint.
    /// @param to Destination account, or the zero address for a burn.
    /// @param amount Amount expressed in the token's smallest unit.
    /// @return True when CommunityToken may continue with the update.
    function isTransferAllowed(
        address token,
        address operator,
        address from,
        address to,
        uint256 amount
    ) external view returns (bool);
}
