// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import {Modifiers} from "../libraries/AppStorage.sol";

/**
 * @notice One-time Diamond initializer for moving the transfer-permitted TDF treasury.
 * @dev Execute through `diamondCut` so this code runs against the Diamond's AppStorage.
 *      The initializer deliberately adds no facet selectors and therefore cannot be called
 *      through the Diamond after the migration transaction completes.
 */
contract TDFTreasuryMigration is Modifiers {
    event TDFTreasuryMigrated(address indexed previousTreasury, address indexed newTreasury);

    function migrate(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "TDFTreasuryMigration: zero treasury");
        require(newTreasury != s.tdfTreasury, "TDFTreasuryMigration: treasury unchanged");

        address previousTreasury = s.tdfTreasury;
        s.tdfTreasury = newTreasury;
        emit TDFTreasuryMigrated(previousTreasury, newTreasury);
    }
}
