// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/DoubleEndedQueue.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./OrderedStakeLib.sol";

library StakeLibV2 {
    using SafeERC20 for IERC20;
    using OrderedStakeLib for OrderedStakeLib.Store;

    event DepositedTokens(address account, uint256 amount);
    event WithdrawnTokens(address account, uint256 amount);

    // ONLY MEMORY
    struct Context {
        address account;
        IERC20 token;
        uint256 lockingTimePeriod;
    }

    // function buildContext(address account, IERC20 token, uint256 lockingTimePeriod) returns
    function add(
        Context memory context,
        OrderedStakeLib.Store storage store,
        uint256 amount
    ) internal {
        _addAt(context, store, amount, block.timestamp);
    }

    function remove(
        Context memory context,
        OrderedStakeLib.Store storage store,
        uint256 requested
    ) internal {
        store.takeUntil(requested, _currentReleaseTimestamp(context));
        context.token.safeTransfer(context.account, requested);
        emit WithdrawnTokens(context.account, requested);
    }

    function restakeOrDepositAt(
        Context memory context,
        OrderedStakeLib.Store storage store,
        uint256 requested,
        uint256 tm
    ) internal {
        uint256 releasableTm = tm - context.lockingTimePeriod;
        uint256 restakeable = store.balanceUntil(releasableTm);
        if (restakeable >= requested) {
            // No need to transfer more funds
            store.takeUntil(requested, releasableTm);
            store.push(requested, tm);
        } else {
            if (restakeable > uint256(0)) {
                // reappend releasable tokens
                store.takeUntil(restakeable, releasableTm);
                store.push(restakeable, tm);
            }
            uint256 toDeposit = requested - restakeable;
            // get the rest from the external account
            store.push(toDeposit, tm);
            context.token.safeTransferFrom(context.account, address(this), toDeposit);
        }
    }

    function takeMax(Context memory context, OrderedStakeLib.Store storage store) internal {
        store.takeMaxUntil(_currentReleaseTimestamp(context));
    }

    function locked(Context memory context, OrderedStakeLib.Store storage store) internal view returns (uint256) {
        return store.balanceFrom(_currentReleaseTimestamp(context));
    }

    function releasable(Context memory context, OrderedStakeLib.Store storage store) internal view returns (uint256) {
        return store.balanceUntil(_currentReleaseTimestamp(context));
    }

    // function restakeMax(Context memory context, OrderedStakeLib.Store storage store) internal returns (uint256) {
    //     uint256 amount = store.balanceUntil(_currentReleaseTimestamp(context));
    //     store.takeUntil(amount, _currentReleaseTimestamp(context));
    //     store.push(amount, block.timestamp);
    //     return amount;
    // }

    // @dev
    // DO NOT USE IN SEND FUNCTIONS
    function deposits(OrderedStakeLib.Store storage store) internal view returns (OrderedStakeLib.Deposit[] memory) {
        return store.list();
    }

    function balance(OrderedStakeLib.Store storage store) internal view returns (uint256) {
        return store.balance();
    }

    // =========================================
    // PRIVATE FUNCTIONS
    // =========================================

    function _currentReleaseTimestamp(Context memory context) internal view returns (uint256) {
        return block.timestamp - context.lockingTimePeriod;
    }

    function _addAt(
        Context memory context,
        OrderedStakeLib.Store storage store,
        uint256 amount,
        uint256 timestamp
    ) internal {
        store.push(amount, timestamp);
        context.token.safeTransferFrom(context.account, address(this), amount);
        emit DepositedTokens(context.account, amount);
    }
}
