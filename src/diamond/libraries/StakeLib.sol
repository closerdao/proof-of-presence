// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

library StakeLib {
    using SafeERC20 for IERC20;

    // Max number in uint256
    // same result can be achieved with: `uint256 MAX_INT = 2**256 - 1`
    // Pasted the literal here for cheaper deployment
    uint256 private constant MAX_INT = 115792089237316195423570985008687907853269984665640564039457584007913129639935;
    struct StakedDeposit {
        uint256 timestamp;
        uint256 amount;
    }

    struct WithdrawingResult {
        uint256 untiedAmount;
        uint256 remainingBalance;
        StakedDeposit[] remainingDeposits;
    }
    struct StakeStore {
        // TODO: remove stake namespace
        mapping(address => uint256) stakedBalances;
        mapping(address => StakedDeposit[]) stakedDeposits;
        uint256 stakeLockingPeriod;
    }

    event DepositedTokens(address account, uint256 amount);
    event WithdrawnTokens(address account, uint256 amount);

    function deposit(
        StakeStore storage store,
        IERC20 communityToken,
        address account,
        uint256 amount,
        uint256 depositTm
    ) internal {
        store.stakedDeposits[account].push(StakedDeposit(depositTm, amount));
        store.stakedBalances[account] += amount;
        communityToken.safeTransferFrom(account, address(this), amount);
        emit DepositedTokens(account, amount);
    }

    function withdrawMaxStake(
        StakeStore storage store,
        IERC20 communityToken,
        address account
    ) internal returns (uint256) {
        require(store.stakedBalances[account] > 0, "NOT_ENOUGHT_BALANCE");
        WithdrawingResult memory result = _calculateWithdraw(store, account, MAX_INT, block.timestamp);

        // Change the state
        _withdraw(store, communityToken, account, result);
        return result.untiedAmount;
    }

    function withdrawStake(
        StakeStore storage store,
        IERC20 communityToken,
        address account,
        uint256 requested
    ) internal returns (uint256) {
        require(store.stakedBalances[account] >= requested, "NOT_ENOUGHT_BALANCE");
        // `requested` is passed as value and not by reference because is a basic type
        // https://docs.soliditylang.org/en/v0.8.9/types.html#value-types
        // It will not be modified by `_calculateWithdraw()`
        WithdrawingResult memory result = _calculateWithdraw(store, account, requested, block.timestamp);
        require(result.untiedAmount == requested, "NOT_ENOUGHT_UNLOCKABLE_BALANCE");
        // Change the state
        _withdraw(store, communityToken, account, result);
        return result.untiedAmount;
    }

    function restakeMax(StakeStore storage store, address account) internal {
        require(store.stakedBalances[account] > 0, "NOT_ENOUGHT_BALANCE");
        WithdrawingResult memory result = _calculateWithdraw(store, account, MAX_INT, block.timestamp);
        _restake(store, account, result, block.timestamp);
    }

    function restake(
        StakeStore storage store,
        address account,
        uint256 requestedAmount
    ) internal {
        require(store.stakedBalances[account] > 0, "NOT_ENOUGHT_BALANCE");
        WithdrawingResult memory result = _calculateWithdraw(store, account, requestedAmount, block.timestamp);
        require(result.untiedAmount == requestedAmount, "NOT_ENOUGHT_UNLOCKABLE_BALANCE");
        _restake(store, account, result, block.timestamp);
    }

    function restakeOrDepositAtFor(
        StakeStore storage store,
        IERC20 communityToken,
        address account,
        uint256 amount,
        // TODO: initLocking time must be bigger that current timestamp
        uint256 initLockingTm
    ) internal {
        require(initLockingTm >= block.timestamp, "Unable to stake to the pass");
        uint256 stake = store.stakedBalances[account];
        uint256 tBalance = communityToken.balanceOf(account);
        require(stake + tBalance >= amount, "NOT_ENOUGHT_BALANCE");
        if (stake == 0) {
            deposit(store, communityToken, account, amount, initLockingTm);
        } else {
            // TODO: the restake should account for bigger TM as staked and update the smaller TM only
            WithdrawingResult memory result = _calculateWithdraw(store, account, amount, MAX_INT);

            _restake(store, account, result, initLockingTm);

            if (amount > result.untiedAmount) {
                uint256 toTransfer = amount - result.untiedAmount;
                deposit(store, communityToken, account, toTransfer, initLockingTm);
            }
        }
    }

    function _restake(
        StakeStore storage store,
        address account,
        WithdrawingResult memory result,
        // TODO: initLocking time must be bigger than current timestamp
        uint256 lockingInitTm
    ) internal {
        // crear previous deposits
        delete store.stakedDeposits[account];
        for (uint256 i = 0; i < result.remainingDeposits.length; i++) {
            // copy the deposits to storage
            store.stakedDeposits[account].push(result.remainingDeposits[i]);
        }
        // ReStake the withdrawable amount
        store.stakedDeposits[account].push(StakedDeposit(lockingInitTm, result.untiedAmount));
        // EMIT ReStaked
        // return amount
    }

    function _withdraw(
        StakeStore storage store,
        IERC20 communityToken,
        address account,
        WithdrawingResult memory result
    ) internal {
        if (result.untiedAmount > 0) {
            // clear previous deposits
            delete store.stakedDeposits[account];
            for (uint256 i = 0; i < result.remainingDeposits.length; i++) {
                // add the reminder deposits
                store.stakedDeposits[account].push(result.remainingDeposits[i]);
            }

            store.stakedBalances[account] = result.remainingBalance;
            communityToken.safeTransfer(account, result.untiedAmount);
            emit WithdrawnTokens(account, result.untiedAmount);
        }
    }

    function unlockedStake(StakeStore storage store, address account) internal view returns (uint256) {
        WithdrawingResult memory result = _calculateWithdraw(store, account, MAX_INT, block.timestamp);
        return result.untiedAmount;
    }

    function lockedStake(StakeStore storage store, address account) internal view returns (uint256) {
        WithdrawingResult memory result = _calculateWithdraw(store, account, MAX_INT, block.timestamp);
        return store.stakedBalances[account] - result.untiedAmount;
    }

    function stakedBalanceOf(StakeStore storage store, address account) internal view returns (uint256) {
        return store.stakedBalances[account];
    }

    function depositsStakedFor(StakeStore storage store, address account)
        internal
        view
        returns (StakedDeposit[] memory)
    {
        return store.stakedDeposits[account];
    }

    function _calculateWithdraw(
        StakeStore storage store,
        address account,
        uint256 requested,
        uint256 lockedUntil
    ) internal view returns (WithdrawingResult memory) {
        StakedDeposit[] memory stakedFunds = store.stakedDeposits[account];
        WithdrawingResult memory result = WithdrawingResult(0, 0, new StakedDeposit[](0));
        if (stakedFunds.length == 0) {
            return result;
        }

        for (uint8 i = 0; i < stakedFunds.length; i++) {
            StakedDeposit memory elem = stakedFunds[i];
            if (_isReleasable(store, elem, lockedUntil) && requested > 0) {
                // Example:
                // requested: 25 < elem.amount: 100 = true
                // TODO: initLocking time must be bigger than current timestamp
                if (requested < elem.amount) {
                    // rest: 75
                    uint256 rest = elem.amount - requested;
                    // put back the remainder in user balance
                    elem.amount = rest;
                    // Add to unlocked result the requested reminder
                    // + 25
                    result.untiedAmount += requested;
                    // The reminder gets into the result
                    result.remainingBalance += rest;
                    // push the pocket into the reminder balances
                    // without modifying the timestamp
                    result.remainingDeposits = _pushDeposit(result.remainingDeposits, elem);
                    // Set requested to 0 to stop substracting more balance
                    requested = 0;
                } else {
                    // Substract the current amount to continue the countdown
                    requested -= elem.amount;
                    // Add to the unlockable amount
                    result.untiedAmount += elem.amount;
                }
            } else {
                // Recollect the remaining balances
                result.remainingBalance += elem.amount;
                result.remainingDeposits = _pushDeposit(result.remainingDeposits, elem);
            }
        }
        return result;
    }

    /**
     * @dev Can not modify (push) elements to memory array. The only way is to create a new
     * one with +1 size,copy the previous elements and add the last one
     */
    function _pushDeposit(StakedDeposit[] memory acc, StakedDeposit memory unit)
        internal
        pure
        returns (StakedDeposit[] memory)
    {
        uint256 length = acc.length;
        // creates new acc with one more slot
        StakedDeposit[] memory newAcc = new StakedDeposit[](length + 1);
        // copy previous array
        for (uint8 i = 0; i < length; i++) {
            newAcc[i] = acc[i];
        }
        // push the new element
        newAcc[length] = unit;
        return newAcc;
    }

    function _isReleasable(
        StakeStore storage store,
        StakedDeposit memory unit,
        uint256 lockedUntil
    ) internal view returns (bool) {
        return (unit.timestamp + store.stakeLockingPeriod) <= lockedUntil;
    }
}
