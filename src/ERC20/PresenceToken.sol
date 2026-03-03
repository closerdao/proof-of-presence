// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./ERC20NonTransferableDecaying.sol";

contract PresenceToken is ERC20NonTransferableDecaying {
    function initialize(
        string memory name_,
        string memory symbol_,
        address daoAddress_,
        uint256 decayRatePerDay_
    ) public initializer {
        __ERC20NonTransferableDecaying_init(name_, symbol_, daoAddress_, decayRatePerDay_);
    }
}
