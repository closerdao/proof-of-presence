// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {TokenizedStays} from "../stays/TokenizedStays.sol";

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract TokenizedStaysV2Mock is TokenizedStays {
    /// @custom:storage-location erc7201:closer.storage.TokenizedStaysV2Mock
    struct V2Storage {
        uint256 value;
    }

    function version() external pure returns (string memory) {
        return "tokenized-stays-v2";
    }

    function setV2Value(uint256 newValue) external {
        _getV2Storage().value = newValue;
    }

    function v2Value() external view returns (uint256) {
        return _getV2Storage().value;
    }

    function _getV2Storage() private pure returns (V2Storage storage $) {
        uint256 storageLocation = erc7201("closer.storage.TokenizedStaysV2Mock");
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            $.slot := storageLocation
        }
    }
}
