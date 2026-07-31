// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {VillageCitizenNFT} from "../citizenship/VillageCitizenNFT.sol";

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract VillageCitizenNFTUpgradeMock is VillageCitizenNFT {
    function version() external pure returns (string memory) {
        return "village-citizen-nft-upgrade-mock";
    }
}
