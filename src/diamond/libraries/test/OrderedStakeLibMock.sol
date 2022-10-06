// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "../OrderedStakeLib.sol";

contract OrderedStakeLibMock {
    using OrderedStakeLib for OrderedStakeLib.Store;
    OrderedStakeLib.Store private store;

    event PushBack(bool success);
    event PushFront(bool success);
    event PopFront(uint256 amount, uint256 timestamp);
    event Released(uint256 amount, uint256 timestamp);
    event Moved(uint256 amount, uint256 from, uint256 to);

    function push(uint256 amount, uint256 timestamp) public {
        store.push(amount, timestamp);
        emit PushBack(true);
    }

    function pushFront(uint256 amount, uint256 timestamp) public {
        store.pushFront(amount, timestamp);
        emit PushFront(true);
    }

    function _popFront() public {
        OrderedStakeLib.Deposit memory _deposit = store._popFront();
        emit PopFront(_deposit.amount, _deposit.timestamp);
    }

    function balance() public view returns (uint256) {
        return store.balance();
    }

    function moveFront(
        uint256 amount,
        uint256 from,
        uint256 to
    ) public {
        store.moveFront(amount, from, to);
        emit Moved(amount, from, to);
    }

    function deposits() public view returns (OrderedStakeLib.Deposit[] memory) {
        return store.list();
    }

    function takeAt(uint256 amount, uint256 tm) public {
        store.takeAt(amount, tm);
        emit Released(amount, tm);
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
