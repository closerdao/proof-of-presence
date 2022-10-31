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
        uint256 requiredBalance;
    }
    struct BookingContext {
        address account;
        IERC20 token;
        uint256 lockingTimePeriod;
        uint256 requiredBalance;
        uint256 fromReservationFutureRequiredBalance;
        uint256 fromReservationPastRequiredBalance;
        uint256 initYearTm;
        uint256 endYearTm;
        uint256 onYearBoookingsAmount;
    }

    function handleBookingNOT(
        BookingContext memory context,
        OrderedStakeLib.Store storage store,
        uint256 amount,
        uint256 timestamp
    ) internal {
        // cases:
        // A) user does not have balance: transfer in
        uint256 yearBalance = store.balanceFromTo(context.initYearTm, context.endYearTm);
        uint256 nextYearsBalance = store.balanceFrom(context.endYearTm);
        uint256 prevYearsBalance = store.balanceUntil(context.initYearTm);
        // has balances in the future
        if (nextYearsBalance == context.requiredBalance) return;
        // We only have to work with current year
        if (prevYearsBalance == uint256(0) && nextYearsBalance == uint256(0)) {
            // No balance in previous years. Just get from wallet
            store.push(amount, timestamp);
            context.token.safeTransferFrom(context.account, address(this), amount);
            return;
        }
        if (nextYearsBalance == uint256(0)) {
            // We work only with the past tokens
            uint256 pastMovable;
            if (prevYearsBalance >= context.requiredBalance) {
                if (prevYearsBalance >= amount) {
                    store.moveBackRanged(amount, uint256(0), timestamp);
                } else {
                    store.moveBack(prevYearsBalance, store.front().timestamp, timestamp);
                    store.push(amount - prevYearsBalance, timestamp);
                    context.token.safeTransferFrom(context.account, address(this), amount);
                }
            } else {
                pastMovable = prevYearsBalance - yearBalance;
                revert("fix: prev years do not have enought");
            }
        } else if (prevYearsBalance == uint256(0)) {
            // We only work with the future
            uint256 notStaked;
            if (nextYearsBalance < context.requiredBalance) {
                notStaked = context.requiredBalance - nextYearsBalance;
            } else {
                notStaked = nextYearsBalance - context.requiredBalance;
            }
            store.push(notStaked, timestamp);
            context.token.safeTransferFrom(context.account, address(this), notStaked);
        } else {
            // we have in both directions, we have to move some from the pasts
            // how much in the future
            if (context.requiredBalance > nextYearsBalance) {
                // Take fu
            }
            revert("Fix both sides has stake");
        }
    }

    function handleBooking(
        BookingContext memory context,
        OrderedStakeLib.Store storage store,
        uint256 amount,
        uint256 timestamp
    ) internal {
        _refactorHandleBooking(context, store, amount, timestamp);
    }

    function _refactorHandleBooking(
        BookingContext memory context,
        OrderedStakeLib.Store storage store,
        uint256 amount,
        uint256 timestamp
    ) internal {
        uint256 nextYearsBalance = store.balanceFrom(context.endYearTm);
        if (nextYearsBalance >= context.requiredBalance) return;

        uint256 required = context.requiredBalance;
        required -= nextYearsBalance;

        uint256 prevYearsBalance = store.balanceUntil(context.initYearTm);
        if (prevYearsBalance >= required) {
            // move from the past
            store.moveBack(prevYearsBalance - required, store.front().timestamp, timestamp);
            return;
        }
        if (prevYearsBalance > uint256(0)) {
            // move all prevYearsBalance
            store.moveBack(prevYearsBalance, store.front().timestamp, timestamp);
            required -= prevYearsBalance;
        }

        // rest tranfer
        store.push(required, timestamp);
        context.token.safeTransferFrom(context.account, address(this), required);
    }

    function handleCancelation(
        BookingContext memory context,
        OrderedStakeLib.Store storage store,
        uint256,
        uint256 timestamp
    ) internal {
        if (context.requiredBalance < store.balance()) {
            store.moveFrontRanged(store.balance() - context.requiredBalance, timestamp, uint256(0));
        }
    }

    function _handleCancelation(
        BookingContext memory context,
        OrderedStakeLib.Store storage store,
        uint256 amount,
        uint256 timestamp
    ) internal {
        if (context.requiredBalance == store.balance()) return;
        // do nothing
        // if (store.balanceFrom(timestamp - 1) >= amount) {
        //     store.moveFront(amount, store.back().timestamp, timestamp);
        // }
        if (context.requiredBalance < store.balance()) {
            if (store.balanceFromTo(timestamp, type(uint256).max) > context.requiredBalance) {
                if (store.balanceFromTo(timestamp, type(uint256).max) - context.requiredBalance == amount) {
                    store.moveFrontRanged(amount, timestamp, uint256(0));
                }
                revert("handleCancelation: current required is not exactly amount");
            }
            // if current future balance < expected move to current tm
            // store.mo
            // store.takeFromBackToFrontRange(amount, timestamp);
            // context.token.safeTransfer(context.account, amount);
        } else {
            revert("StakeLibV2: `handleCancelations` unhandled case");
        }
    }

    // function removeAt(
    //     Context memory context,
    //     OrderedStakeLib.Store storage store,
    //     uint256 amount,
    //     uint256 timestamp
    // ) internal {
    //     if (context.requiredBalance == store.balance()) {
    //         // do nothing
    //         // if (store.balanceFrom(timestamp - 1) >= amount) {
    //         //     store.moveFront(amount, store.back().timestamp, timestamp);
    //         // }
    //     } else if (context.requiredBalance < store.balance() && store.balance() - context.requiredBalance == amount) {
    //         // if current future balance < expected move to current tm
    //         // store.mo
    //         // store.takeFromBackToFrontRange(amount, timestamp);
    //         // context.token.safeTransfer(context.account, amount);
    //     } else {
    //         revert("not implemented");
    //     }
    // }

    function remove(
        Context memory context,
        OrderedStakeLib.Store storage store,
        uint256 requested
    ) internal {
        _remove(context, store, requested);
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
            emit DepositedTokens(context.account, toDeposit);
        }
    }

    function takeMax(Context memory context, OrderedStakeLib.Store storage store) internal returns (uint256) {
        uint256 amount = releasable(context, store);

        if (amount > 0) {
            _remove(context, store, amount);
        }
        return amount;
    }

    function _remove(
        Context memory context,
        OrderedStakeLib.Store storage store,
        uint256 requested
    ) internal {
        store.takeUntil(requested, _currentReleaseTimestamp(context));
        context.token.safeTransfer(context.account, requested);
        emit WithdrawnTokens(context.account, requested);
    }

    function locked(Context memory context, OrderedStakeLib.Store storage store) internal view returns (uint256) {
        return store.balanceFrom(_currentReleaseTimestamp(context));
    }

    function releasable(Context memory context, OrderedStakeLib.Store storage store) internal view returns (uint256) {
        return store.balanceUntil(_currentReleaseTimestamp(context));
    }

    function lockedAt(
        Context memory context,
        OrderedStakeLib.Store storage store,
        uint256 at
    ) internal view returns (uint256) {
        return store.balanceFrom(_releaseTimestampAt(context, at));
    }

    function releasableAt(
        Context memory context,
        OrderedStakeLib.Store storage store,
        uint256 at
    ) internal view returns (uint256) {
        return store.balanceUntil(_releaseTimestampAt(context, at));
    }

    function restakeMax(Context memory context, OrderedStakeLib.Store storage store) internal returns (uint256) {
        uint256 amount = store.balanceUntil(_currentReleaseTimestamp(context));
        if (amount > 0) {
            store.takeUntil(amount, _currentReleaseTimestamp(context));
            store.push(amount, block.timestamp);
        }
        return amount;
    }

    function restakeAmount(
        Context memory context,
        OrderedStakeLib.Store storage store,
        uint256 amount
    ) internal returns (uint256) {
        store.takeUntil(amount, _currentReleaseTimestamp(context));
        store.push(amount, block.timestamp);
        return amount;
    }

    // @dev
    // DO NOT USE IN SEND FUNCTIONS
    function deposits(OrderedStakeLib.Store storage store) internal view returns (OrderedStakeLib.Deposit[] memory) {
        return store.list();
    }

    function balance(OrderedStakeLib.Store storage store) internal view returns (uint256) {
        return store.balance();
    }

    // function buildContext(address account, IERC20 token, uint256 lockingTimePeriod) returns
    function add(
        Context memory context,
        OrderedStakeLib.Store storage store,
        uint256 amount
    ) internal {
        _addAt(context, store, amount, block.timestamp);
        emit DepositedTokens(context.account, amount);
    }

    // =========================================
    // PRIVATE FUNCTIONS
    // =========================================

    function _currentReleaseTimestamp(Context memory context) internal view returns (uint256) {
        return _releaseTimestampAt(context, block.timestamp);
    }

    function _releaseTimestampAt(Context memory context, uint256 at) internal pure returns (uint256) {
        return at - context.lockingTimePeriod;
    }

    function _addAt(
        Context memory context,
        OrderedStakeLib.Store storage store,
        uint256 amount,
        uint256 timestamp
    ) internal {
        store.push(amount, timestamp);
        context.token.safeTransferFrom(context.account, address(this), amount);
    }
}
