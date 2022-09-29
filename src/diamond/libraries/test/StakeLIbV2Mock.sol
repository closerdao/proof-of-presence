// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/DoubleEndedQueue.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "hardhat/console.sol";
import "../OrderedStakeLib.sol";

library StakeLibV2 {
    using SafeERC20 for IERC20;
    using OrderedStakeLib for OrderedStakeLib.Store;

    // Max number in uint256
    // same result can be achieved with: `uint256 MAX_INT = 2**256 - 1`
    // Pasted the literal here for cheaper deployment
    uint256 private constant MAX_INT = 115792089237316195423570985008687907853269984665640564039457584007913129639935;

    // struct WithdrawingResult {
    //     uint256 untiedAmount;
    //     uint256 remainingBalance;
    //     StakedDeposit[] remainingDeposits;
    // }

    // // Memory structs for Aggregations and Calculations
    // // This are internal, should not be used outside
    // struct StakedDepositTemp {
    //     uint256 timestamp;
    //     uint256 amount;
    // }

    // enum Command {
    //     Add,
    //     Update,
    //     Delete
    // }
    // struct DepositsCommand {
    //     Command command;
    //     bytes32 key;
    //     uint256 amount;
    //     uint256 tm;
    // }
    // struct WithdrawingResultOptimized {
    //     uint256 untiedAmount;
    //     uint256 remainingBalance;
    //     DepositsCommand[] commands;
    // }

    event DepositedTokens(address account, uint256 amount);
    event WithdrawnTokens(address account, uint256 amount);

    function balanceOf(OrderedStakeLib.Store storage store) internal view returns (uint256) {
        return store._balance;
    }

    // TODO: to many arguments
    function add(
        OrderedStakeLib.Store storage store,
        IERC20 token,
        address account,
        uint256 amount,
        uint256 depositTm
    ) internal {
        store.push(amount, depositTm);
        token.safeTransferFrom(account, address(this), amount);
        emit DepositedTokens(account, amount);
    }

    function remove(
        OrderedStakeLib.Store storage store,
        IERC20 communityToken,
        address account,
        uint256 requested
    ) internal {
        // TODO: move to orderedStakeLib
        store.takeUntil(block.timestamp + 1 * 86400, requested);

        communityToken.safeTransferFrom(address(this), account, requested);
        emit WithdrawnTokens(account, requested);
    }

    // @dev
    // DO NOT USE IN SEND FUNCTIONS
    function deposits(OrderedStakeLib.Store storage store) internal view returns (OrderedStakeLib.Deposit[] memory) {
        return store.list();
    }

    // function withdrawMax(
    //     Store storage store,
    //     IERC20 communityToken,
    //     address account
    // ) internal returns (uint256) {
    //     require(store.stakedBalances > 0, "NOT_ENOUGHT_BALANCE");
    //     WithdrawingResult memory result = _calculateWithdraw(store, MAX_INT, block.timestamp);

    //     // Change the state
    //     _withdraw(store, communityToken, account, result);
    //     return result.untiedAmount;
    // }

    // function _calculateWithdraw(
    //     Store storage store,
    //     uint256 requested,
    //     uint256 lockedUntil
    // ) internal view returns (WithdrawingResult memory) {
    //     StakedDeposit[] memory stakedFunds = store.stakedDeposits;
    //     WithdrawingResult memory result = WithdrawingResult(0, 0, new StakedDeposit[](0));
    //     if (stakedFunds.length == 0) {
    //         return result;
    //     }

    //     for (uint8 i = 0; i < stakedFunds.length; i++) {
    //         StakedDeposit memory elem = stakedFunds[i];
    //         if (_isReleasable(store, elem, lockedUntil) && requested > 0) {
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
}

contract StakeLibV2Mock {
    using StakeLibV2 for OrderedStakeLib.Store;

    mapping(address => OrderedStakeLib.Store) staking;
    IERC20 token;
    event DepositedTokens(address account, uint256 amount);
    event WithdrawnTokens(address account, uint256 amount);
    event PushBack(bool success);
    event PopFront(uint256 amount, uint256 timestamp);

    constructor(address token_) {
        token = IERC20(token_);
    }

    // -------------------------------
    // StakeLibV2
    // -------------------------------
    function deposit(uint256 amount) public {
        staking[msg.sender].add(token, msg.sender, amount, block.timestamp);
    }

    function balanceOf(address account) public view returns (uint256) {
        return staking[account]._balance;
    }

    function depositsFor(address account) public view returns (OrderedStakeLib.Deposit[] memory) {
        return staking[account].deposits();
    }

    function locked(address) public view returns (uint256) {
        return uint256(0);
    }

    function unlocked(address) public view returns (uint256) {
        return uint256(0);
    }

    function restakeOrDepositAtFor(
        address,
        uint256,
        uint256
    ) public view {}

    function withdraw(uint256 amount) public {
        staking[msg.sender].remove(token, msg.sender, amount);
    }

    function withdrawMax() public view {}
}
