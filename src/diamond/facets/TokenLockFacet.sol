// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../libraries/AppStorage.sol";
import "../libraries/StakeLib.sol";

contract TokenLockFacet is Modifiers, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using StakeLib for StakeLib.StakeStore;

    // Max number in uint256
    // same result can be achieved with: `uint256 MAX_INT = 2**256 - 1`
    // Pasted the literal here for cheaper deployment
    uint256 private constant MAX_INT = 115792089237316195423570985008687907853269984665640564039457584007913129639935;

    struct WithdrawingResult {
        uint256 untiedAmount;
        uint256 remainingBalance;
        StakedDeposit[] remainingDeposits;
    }

    event DepositedTokens(address account, uint256 amount);
    event WithdrawnTokens(address account, uint256 amount);

    function depositStake(uint256 amount) public {
        _deposit(_msgSender(), amount, block.timestamp);
    }

    function _deposit(
        address account,
        uint256 amount,
        uint256 depositTm
    ) internal {
        s.staking.deposit(s.communityToken, account, amount, depositTm);
        // s._stakedDeposits[account].push(StakedDeposit(depositTm, amount));
        // s._stakedBalances[account] += amount;
        // s.communityToken.safeTransferFrom(account, address(this), amount);
        // emit DepositedTokens(account, amount);
    }

    function withdrawMaxStake() public returns (uint256) {
        return s.staking.withdrawMaxStake(s.communityToken, _msgSender());
        // require(s._stakedBalances[_msgSender()] > 0, "NOT_ENOUGHT_BALANCE");
        // WithdrawingResult memory result = _calculateWithdraw(_msgSender(), MAX_INT, block.timestamp);

        // // Change the state
        // _withdraw(_msgSender(), result);
        // return result.untiedAmount;
    }

    function withdrawStake(uint256 requested) public returns (uint256) {
        return s.staking.withdrawStake(s.communityToken, _msgSender(), requested);
        // require(s._stakedBalances[_msgSender()] >= requested, "NOT_ENOUGHT_BALANCE");
        // // `requested` is passed as value and not by reference because is a basic type
        // // https://docs.soliditylang.org/en/v0.8.9/types.html#value-types
        // // It will not be modified by `_calculateWithdraw()`
        // WithdrawingResult memory result = _calculateWithdraw(_msgSender(), requested, block.timestamp);
        // require(result.untiedAmount == requested, "NOT_ENOUGHT_UNLOCKABLE_BALANCE");
        // // Change the state
        // _withdraw(_msgSender(), result);
        // return result.untiedAmount;
    }

    function restakeMax() public {
        s.staking.restakeMax(_msgSender());

        // require(s._stakedBalances[_msgSender()] > 0, "NOT_ENOUGHT_BALANCE");
        // WithdrawingResult memory result = _calculateWithdraw(_msgSender(), MAX_INT, block.timestamp);
        // _restake(_msgSender(), result, block.timestamp);
    }

    function restake(uint256 requestedAmount) public {
        s.staking.restake(_msgSender(), requestedAmount);

        // require(s._stakedBalances[_msgSender()] > 0, "NOT_ENOUGHT_BALANCE");
        // WithdrawingResult memory result = _calculateWithdraw(_msgSender(), requestedAmount, block.timestamp);
        // require(result.untiedAmount == requestedAmount, "NOT_ENOUGHT_UNLOCKABLE_BALANCE");
        // _restake(_msgSender(), result, block.timestamp);
    }

    // Check dependency and not use this contract to interact
    function restakeOrDepositAtFor(
        address account,
        uint256 amount,
        // TODO: initLocking time must be bigger that current timestamp
        uint256 initLockingTm
    ) external {
        s.staking.restakeOrDepositAtFor(s.communityToken, account, amount, initLockingTm);
    }

    // function _restake(
    //     address account,
    //     WithdrawingResult memory result,
    //     // TODO: initLocking time must be bigger than current timestamp
    //     uint256 lockingInitTm
    // ) internal {
    //     // crear previous deposits
    //     delete s._stakedDeposits[account];
    //     for (uint256 i = 0; i < result.remainingDeposits.length; i++) {
    //         // copy the deposits to storage
    //         s._stakedDeposits[account].push(result.remainingDeposits[i]);
    //     }
    //     // ReStake the withdrawable amount
    //     s._stakedDeposits[account].push(StakedDeposit(lockingInitTm, result.untiedAmount));
    //     // EMIT ReStaked
    //     // return amount
    // }

    // function _withdraw(address account, WithdrawingResult memory result) internal {
    //     if (result.untiedAmount > 0) {
    //         // clear previous deposits
    //         delete s._stakedDeposits[account];
    //         for (uint256 i = 0; i < result.remainingDeposits.length; i++) {
    //             // add the reminder deposits
    //             s._stakedDeposits[account].push(result.remainingDeposits[i]);
    //         }

    //         s._stakedBalances[account] = result.remainingBalance;
    //         s.communityToken.safeTransfer(account, result.untiedAmount);
    //         emit WithdrawnTokens(account, result.untiedAmount);
    //     }
    // }

    function unlockedStake(address account) public view returns (uint256) {
        return s.staking.unlockedStake(account);
        // WithdrawingResult memory result = _calculateWithdraw(account, MAX_INT, block.timestamp);
        // return result.untiedAmount;
    }

    function lockedStake(address account) public view returns (uint256) {
        return s.staking.lockedStake(account);

        // WithdrawingResult memory result = _calculateWithdraw(account, MAX_INT, block.timestamp);
        // return s._stakedBalances[account] - result.untiedAmount;
    }

    function stakedBalanceOf(address account) public view returns (uint256) {
        return s.staking.stakedBalanceOf(account);
    }

    function depositsStakedFor(address account) public view returns (StakeLib.StakedDeposit[] memory) {
        return s.staking.depositsStakedFor(account);
    }

    // function _calculateWithdraw(
    //     address account,
    //     uint256 requested,
    //     uint256 lockedUntil
    // ) internal view returns (WithdrawingResult memory) {
    //     StakedDeposit[] memory stakedFunds = s._stakedDeposits[account];
    //     WithdrawingResult memory result = WithdrawingResult(0, 0, new StakedDeposit[](0));
    //     if (stakedFunds.length == 0) {
    //         return result;
    //     }

    //     for (uint8 i = 0; i < stakedFunds.length; i++) {
    //         StakedDeposit memory elem = stakedFunds[i];
    //         if (_isReleasable(elem, lockedUntil) && requested > 0) {
    //             // Example:
    //             // requested: 25 < elem.amount: 100 = true
    //             // TODO: initLocking time must be bigger than current timestamp
    //             if (requested < elem.amount) {
    //                 // rest: 75
    //                 uint256 rest = elem.amount - requested;
    //                 // put back the remainder in user balance
    //                 elem.amount = rest;
    //                 // Add to unlocked result the requested reminder
    //                 // + 25
    //                 result.untiedAmount += requested;
    //                 // The reminder gets into the result
    //                 result.remainingBalance += rest;
    //                 // push the pocket into the reminder balances
    //                 // without modifying the timestamp
    //                 result.remainingDeposits = _pushDeposit(result.remainingDeposits, elem);
    //                 // Set requested to 0 to stop substracting more balance
    //                 requested = 0;
    //             } else {
    //                 // Substract the current amount to continue the countdown
    //                 requested -= elem.amount;
    //                 // Add to the unlockable amount
    //                 result.untiedAmount += elem.amount;
    //             }
    //         } else {
    //             // Recollect the remaining balances
    //             result.remainingBalance += elem.amount;
    //             result.remainingDeposits = _pushDeposit(result.remainingDeposits, elem);
    //         }
    //     }
    //     return result;
    // }

    // /**
    //  * @dev Can not modify (push) elements to memory array. The only way is to create a new
    //  * one with +1 size,copy the previous elements and add the last one
    //  */
    // function _pushDeposit(StakedDeposit[] memory acc, StakedDeposit memory unit)
    //     internal
    //     pure
    //     returns (StakedDeposit[] memory)
    // {
    //     uint256 length = acc.length;
    //     // creates new acc with one more slot
    //     StakedDeposit[] memory newAcc = new StakedDeposit[](length + 1);
    //     // copy previous array
    //     for (uint8 i = 0; i < length; i++) {
    //         newAcc[i] = acc[i];
    //     }
    //     // push the new element
    //     newAcc[length] = unit;
    //     return newAcc;
    // }

    // function _isReleasable(StakedDeposit memory unit, uint256 lockedUntil) internal view returns (bool) {
    //     return (unit.timestamp + s.stakeLockingPeriod) <= lockedUntil;
    // }
}
