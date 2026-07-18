// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {VillageSweatToken} from "../tokens/VillageSweatToken.sol";

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract SweatTokenV2Mock is VillageSweatToken {
    /// @custom:storage-location erc7201:closer.storage.SweatTokenV2Mock
    struct V2Storage {
        uint256 value;
    }

    function version() external pure returns (string memory) {
        return "sweat-token-v2";
    }

    function setV2Value(uint256 newValue) external {
        _getV2Storage().value = newValue;
    }

    function v2Value() external view returns (uint256) {
        return _getV2Storage().value;
    }

    function _getV2Storage() private pure returns (V2Storage storage $) {
        uint256 storageLocation = erc7201("closer.storage.SweatTokenV2Mock");
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            $.slot := storageLocation
        }
    }
}
