// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/DoubleEndedQueue.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "hardhat/console.sol";

// TODO: make clearer public and private methods removing `_`
library OrderedStakeLib {
    using DoubleEndedQueue for DoubleEndedQueue.Bytes32Deque;

    // ONLY MEMORY!!
    struct Deposit {
        uint256 timestamp;
        uint256 amount;
    }

    struct Store {
        uint256 _balance;
        DoubleEndedQueue.Bytes32Deque _queue;
        mapping(bytes32 => uint256) _amounts;
    }

    function _pushFront(
        Store storage store,
        uint256 amount,
        uint256 timestamp
    ) internal {
        bytes32 key = bytes32(timestamp);
        store._queue.pushFront(key);
        store._amounts[key] = amount;
        store._balance += amount;
    }

    // PRIVATE do not use use _pushBackOrdered instead
    function _pushBack(
        Store storage store,
        uint256 amount,
        uint256 timestamp
    ) internal {
        bytes32 key = bytes32(timestamp);
        require(store._amounts[key] == uint256(0), "CAN NOT OVERRIDE TIMESTAMPS");
        store._queue.pushBack(key);
        store._amounts[key] = amount;
        store._balance += amount;
    }

    // PRIVATE do not use use _pushBackOrdered instead
    function _incrementBack(
        Store storage store,
        uint256 amount,
        uint256 timestamp
    ) internal {
        bytes32 key = bytes32(timestamp);
        require(store._amounts[key] != uint256(0), "Trying to update empty");
        store._amounts[key] += amount;
        store._balance += amount;
    }

    function pushBackOrdered(
        Store storage store,
        uint256 amount,
        uint256 timestamp
    ) internal {
        if (store._queue.empty()) {
            _pushBack(store, amount, timestamp);
        } else {
            uint256 backTm = uint256(store._queue.back());
            if (backTm < timestamp) {
                _pushBack(store, amount, timestamp);
            } else if (backTm == timestamp) {
                _incrementBack(store, amount, timestamp);
            } else {
                bytes32 last = store._queue.popBack();
                pushBackOrdered(store, amount, timestamp);
                store._queue.pushBack(last);
            }
        }
    }

    function popFront(Store storage store) internal returns (Deposit memory deposit) {
        bytes32 key = store._queue.popFront();
        uint256 val = store._amounts[key];
        delete store._amounts[key];
        store._balance -= val;
        deposit.timestamp = uint256(key);
        deposit.amount = val;
    }

    function length(Store storage store) internal view returns (uint256) {
        return store._queue.length();
    }

    function at(Store storage store, uint256 index) internal view returns (Deposit memory deposit) {
        bytes32 key = store._queue.at(index);
        deposit.timestamp = uint256(key);
        deposit.amount = uint256(store._amounts[key]);
    }

    function list(Store storage store) internal view returns (OrderedStakeLib.Deposit[] memory) {
        Deposit[] memory deposits_ = new Deposit[](length(store));
        for (uint256 i; i < length(store); i++) {
            deposits_[i] = at(store, i);
        }
        return deposits_;
    }

    function empty(Store storage store) internal view returns (bool) {
        return store._queue.empty();
    }
}

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
        store.pushBackOrdered(amount, depositTm);
        token.safeTransferFrom(account, address(this), amount);
        emit DepositedTokens(account, amount);
    }

    function remove(
        OrderedStakeLib.Store storage store,
        IERC20 communityToken,
        address account,
        uint256 requested
    ) internal {
        require(requested > uint256(0), "Nothing Requested");
        require(store._balance > requested, "NOT_ENOUGH_BALANCE");
        uint256 current_extracted;
        // TODO: move to orderedStakeLib
        while (current_extracted < requested) {
            OrderedStakeLib.Deposit memory current_deposit = store.popFront();
            if (_isReleasable(current_deposit)) {
                if (current_deposit.amount + current_extracted == requested) {
                    current_extracted += current_deposit.amount;
                } else if (current_deposit.amount + current_extracted > requested) {
                    // substract front
                    uint256 reminder = current_deposit.amount + current_extracted - requested;
                    store._pushFront(reminder, current_deposit.timestamp);
                    current_extracted = requested;
                } else {
                    current_extracted += current_deposit.amount;
                }
            } else {
                revert("NOT_ENOUGHT_UNLOCKABLE_BALANCE");
            }
        }
        communityToken.safeTransferFrom(address(this), account, requested);
        emit WithdrawnTokens(account, requested);
    }

    function _isReleasable(OrderedStakeLib.Deposit memory deposit) internal view returns (bool) {
        return true;
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
    // This is just for testing, Should never be used in the real contract
    // Only use StakeLibV2
    using OrderedStakeLib for OrderedStakeLib.Store;
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
    // OrderedStakeLib TESTS
    // -------------------------------
    function _pushBackOrdered(uint256 amount, uint256 timestamp) public {
        staking[msg.sender].pushBackOrdered(amount, timestamp);
        emit PushBack(true);
    }

    function _popFront() public {
        OrderedStakeLib.Deposit memory _deposit = staking[msg.sender].popFront();
        emit PopFront(_deposit.amount, _deposit.timestamp);
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
