// SPDX-License-Identifier: AGPL-1.0
pragma solidity 0.8.28;

interface ITransferPermitter {
    function isTokenTransferPermitted(address from, address to, uint256 amount) external returns (bool);
}
