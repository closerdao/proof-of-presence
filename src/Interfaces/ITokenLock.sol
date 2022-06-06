// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;

interface ITokenLock {
    function restakeOrDepositAtFor(
        address account,
        uint256 amount,
        uint256 initLockingTm
    ) external;
}
