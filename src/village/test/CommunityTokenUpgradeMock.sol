// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {CommunityToken} from "../tokens/CommunityToken.sol";

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract CommunityTokenUpgradeMock is CommunityToken {
    error MigrationRejected();

    /// @custom:storage-location erc7201:closer.storage.CommunityTokenUpgradeMock
    struct UpgradeStorage {
        uint256 value;
    }

    function version() external pure returns (string memory) {
        return "community-token-upgrade-mock";
    }

    function initializeUpgrade(uint256 newValue, bool shouldRevert) external reinitializer(2) onlyOwner {
        if (shouldRevert) revert MigrationRejected();
        _getUpgradeStorage().value = newValue;
    }

    function setUpgradeValue(uint256 newValue) external {
        _getUpgradeStorage().value = newValue;
    }

    function upgradeValue() external view returns (uint256) {
        return _getUpgradeStorage().value;
    }

    function _getUpgradeStorage() private pure returns (UpgradeStorage storage $) {
        uint256 storageLocation = erc7201("closer.storage.CommunityTokenUpgradeMock");
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            $.slot := storageLocation
        }
    }
}
