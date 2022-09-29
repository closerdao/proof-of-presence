// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "../OrderedStakeLib.sol";

contract OrderedStakeLibMock {
    using OrderedStakeLib for OrderedStakeLib.Store;
    OrderedStakeLib.Store private store;

    event PushBack(bool success);
    event PopFront(uint256 amount, uint256 timestamp);
    event Released(uint256 amount, uint256 timestamp);

    function push(uint256 amount, uint256 timestamp) public {
        store.push(amount, timestamp);
        emit PushBack(true);
    }

    function _popFront() public {
        OrderedStakeLib.Deposit memory _deposit = store._popFront();
        emit PopFront(_deposit.amount, _deposit.timestamp);
    }

    function balance() public view returns (uint256) {
        return store._balance;
    }

    function deposits() public view returns (OrderedStakeLib.Deposit[] memory) {
        return store.list();
    }

    function takeUntil(uint256 amount, uint256 untilTm) public {
        store.takeUntil(amount, untilTm);
        emit Released(amount, untilTm);
    }

    function takeMaxUntil(uint256 untilTm) public {
        uint256 amount = store.takeMaxUntil(untilTm);
        emit Released(amount, untilTm);
    }

    function balanceUntil(uint256 untilTm) public view returns (uint256) {
        return store.balanceUntil(untilTm);
    }

    function balanceFrom(uint256 untilTm) public view returns (uint256) {
        return store.balanceFrom(untilTm);
    }
}
