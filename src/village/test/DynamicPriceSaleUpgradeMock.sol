// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {DynamicPriceSale} from "../sales/DynamicPriceSale.sol";

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract DynamicPriceSaleUpgradeMock is DynamicPriceSale {
    function version() external pure returns (string memory) {
        return "dynamic-price-sale-upgrade-mock";
    }
}
