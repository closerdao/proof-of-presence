// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC20NonTransferableDecaying} from "./ERC20NonTransferableDecaying.sol";

/// @title Village presence token
/// @author Closer DAO
/// @notice Non-transferable, decaying points representing proof of presence in a village.
/// @dev This thin implementation gives the reusable decaying-token base a distinct deployment artifact and proxy.
contract VillagePresenceToken is ERC20NonTransferableDecaying {
    /// @notice Initializes the presence-token proxy.
    /// @param name_ ERC-20 display name.
    /// @param symbol_ ERC-20 display symbol.
    /// @param roleAuthority_ VillageAccess-compatible contract used for operational authorization.
    /// @param decayRatePerDay_ Daily decay rate with `DECAY_RATE_PER_DAY_DECIMALS` decimal places.
    /// @param owner_ Owner responsible for configuration and UUPS upgrades.
    function initialize(
        string memory name_,
        string memory symbol_,
        address roleAuthority_,
        uint256 decayRatePerDay_,
        address owner_
    ) external initializer {
        __ERC20NonTransferableDecaying_init(name_, symbol_, roleAuthority_, decayRatePerDay_, owner_);
    }
}
