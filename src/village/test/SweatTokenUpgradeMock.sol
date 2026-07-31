// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {VillageSweatToken} from "../tokens/VillageSweatToken.sol";

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract SweatTokenUpgradeMock is VillageSweatToken {
    /// @custom:storage-location erc7201:closer.storage.SweatTokenUpgradeMock
    struct UpgradeStorage {
        uint256 value;
    }

    function version() external pure returns (string memory) {
        return "sweat-token-upgrade-mock";
    }

    function setUpgradeValue(uint256 newValue) external {
        _getUpgradeStorage().value = newValue;
    }

    function upgradeValue() external view returns (uint256) {
        return _getUpgradeStorage().value;
    }

    function _getUpgradeStorage() private pure returns (UpgradeStorage storage $) {
        uint256 storageLocation = erc7201("closer.storage.SweatTokenUpgradeMock");
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            $.slot := storageLocation
        }
    }
}
