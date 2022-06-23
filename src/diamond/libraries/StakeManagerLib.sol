// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import {AppStorage, Deposit} from "./AppStorage.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

library StakeManagerLib {
    using SafeERC20 for IERC20;

    // Max number in uint256
    // same result can be achieved with: `uint256 MAX_INT = 2**256 - 1`
    // Pasted the literal here for cheaper deployment
    uint256 private constant MAX_INT = 115792089237316195423570985008687907853269984665640564039457584007913129639935;

    struct WithdrawingResult {
        uint256 untiedAmount;
        uint256 remainingBalance;
        Deposit[] remainingDeposits;
    }

    event DepositedTokens(address account, uint256 amount);
    event WithdrawnTokens(address account, uint256 amount);

    function deposit(
        AppStorage storage s,
        address account,
        uint256 amount,
        uint256 depositTm
    ) internal {
        s._deposits[account].push(Deposit(depositTm, amount));
        s._balances[account] += amount;
        s.tdfToken.safeTransferFrom(account, address(this), amount);
        emit DepositedTokens(account, amount);
    }

    function withdrawMax(AppStorage storage s, address account) public returns (uint256) {
        require(s._balances[account] > 0, "NOT_ENOUGHT_BALANCE");
        WithdrawingResult memory result = _calculateWithdraw(s, account, MAX_INT, block.timestamp);

        // Change the state
        _withdraw(s, account, result);
        return result.untiedAmount;
    }

    function withdraw(
        AppStorage storage s,
        address account,
        uint256 requested
    ) public returns (uint256) {
        require(s._balances[account] >= requested, "NOT_ENOUGHT_BALANCE");
        // `requested` is passed as value and not by reference because is a basic type
        // https://docs.soliditylang.org/en/v0.8.9/types.html#value-types
        // It will not be modified by `_calculateWithdraw()`
        WithdrawingResult memory result = _calculateWithdraw(s, account, requested, block.timestamp);
        require(result.untiedAmount == requested, "NOT_ENOUGHT_UNLOCKABLE_BALANCE");
        // Change the state
        _withdraw(s, account, result);
        return result.untiedAmount;
    }

    function restakeMax(AppStorage storage s, address account) public {
        require(s._balances[account] > 0, "NOT_ENOUGHT_BALANCE");
        WithdrawingResult memory result = _calculateWithdraw(s, account, MAX_INT, block.timestamp);
        _restake(s, account, result, block.timestamp);
    }

    function restake(
        AppStorage storage s,
        address account,
        uint256 requestedAmount
    ) public {
        require(s._balances[account] > 0, "NOT_ENOUGHT_BALANCE");
        WithdrawingResult memory result = _calculateWithdraw(s, account, requestedAmount, block.timestamp);
        require(result.untiedAmount == requestedAmount, "NOT_ENOUGHT_UNLOCKABLE_BALANCE");
        _restake(s, account, result, block.timestamp);
    }

    function restakeOrDepositAtFor(
        AppStorage storage s,
        address account,
        uint256 amount,
        // TODO: initLocking time must be bigger that current timestamp
        uint256 initLockingTm
    ) internal {
        require(initLockingTm >= block.timestamp, "Unable to stake to the pass");
        uint256 stake = s._balances[account];
        uint256 tBalance = s.tdfToken.balanceOf(account);
        require(stake + tBalance >= amount, "NOT_ENOUGHT_BALANCE");
        if (stake == 0) {
            deposit(s, account, amount, initLockingTm);
        } else {
            // TODO: the restake should account for bigger TM as staked and update the smaller TM only
            WithdrawingResult memory result = _calculateWithdraw(s, account, amount, MAX_INT);

            _restake(s, account, result, initLockingTm);

            if (amount > result.untiedAmount) {
                uint256 toTransfer = amount - result.untiedAmount;
                deposit(s, account, toTransfer, initLockingTm);
            }
        }
    }

    function _restake(
        AppStorage storage s,
        address account,
        WithdrawingResult memory result,
        // TODO: initLocking time must be bigger than current timestamp
        uint256 lockingInitTm
    ) internal {
        // crear previous deposits
        delete s._deposits[account];
        for (uint256 i = 0; i < result.remainingDeposits.length; i++) {
            // copy the deposits to storage
            s._deposits[account].push(result.remainingDeposits[i]);
        }
        // ReStake the withdrawable amount
        s._deposits[account].push(Deposit(lockingInitTm, result.untiedAmount));
        // EMIT ReStaked
        // return amount
    }

    function _withdraw(
        AppStorage storage s,
        address account,
        WithdrawingResult memory result
    ) internal {
        if (result.untiedAmount > 0) {
            // clear previous deposits
            delete s._deposits[account];
            for (uint256 i = 0; i < result.remainingDeposits.length; i++) {
                // add the reminder deposits
                s._deposits[account].push(result.remainingDeposits[i]);
            }

            s._balances[account] = result.remainingBalance;
            s.tdfToken.safeTransfer(account, result.untiedAmount);
            emit WithdrawnTokens(account, result.untiedAmount);
        }
    }

    function unlockedAmount(AppStorage storage s, address account) internal view returns (uint256) {
        WithdrawingResult memory result = _calculateWithdraw(s, account, MAX_INT, block.timestamp);
        return result.untiedAmount;
    }

    function lockedAmount(AppStorage storage s, address account) internal view returns (uint256) {
        WithdrawingResult memory result = _calculateWithdraw(s, account, MAX_INT, block.timestamp);
        return s._balances[account] - result.untiedAmount;
    }

    function _calculateWithdraw(
        AppStorage storage s,
        address account,
        uint256 requested,
        uint256 lockedUntil
    ) internal view returns (WithdrawingResult memory) {
        Deposit[] memory stakedFunds = s._deposits[account];
        WithdrawingResult memory result = WithdrawingResult(0, 0, new Deposit[](0));
        if (stakedFunds.length == 0) {
            return result;
        }

        for (uint8 i = 0; i < stakedFunds.length; i++) {
            Deposit memory elem = stakedFunds[i];
            if (_isReleasable(s, elem, lockedUntil) && requested > 0) {
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
    function _pushDeposit(Deposit[] memory acc, Deposit memory unit) internal pure returns (Deposit[] memory) {
        uint256 length = acc.length;
        // creates new acc with one more slot
        Deposit[] memory newAcc = new Deposit[](length + 1);
        // copy previous array
        for (uint8 i = 0; i < length; i++) {
            newAcc[i] = acc[i];
        }
        // push the new element
        newAcc[length] = unit;
        return newAcc;
    }

    function _isReleasable(
        AppStorage storage s,
        Deposit memory unit,
        uint256 lockedUntil
    ) internal view returns (bool) {
        return (unit.timestamp + s.lockingPeriod) <= lockedUntil;
    }
}
