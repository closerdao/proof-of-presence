// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/DoubleEndedQueue.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../StakeLibV2.sol";

contract StakeLibV2Mock {
    using StakeLibV2 for OrderedStakeLib.Store;
    using StakeLibV2 for StakeLibV2.Context;
    using StakeLibV2 for StakeLibV2.BookingContext;

    uint256 public constant lockingPeriod = 86400; // 1 day

    OrderedStakeLib.Store staking;
    IERC20 token;
    event DepositedTokens(address account, uint256 amount);
    event WithdrawnTokens(address account, uint256 amount);
    event PushBack(bool success);
    event PopFront(uint256 amount, uint256 timestamp);
    event RestakeOrDepositedAtForStatus(bool status);
    event Success();

    constructor(address token_) {
        token = IERC20(token_);
    }

    function _stakeLibContext(address account) internal view returns (StakeLibV2.Context memory) {
        return
            StakeLibV2.Context({account: account, token: token, lockingTimePeriod: lockingPeriod, requiredBalance: 0});
    }

    function handleBooking(
        StakeLibV2.BookingContext memory context,
        uint256 amount,
        uint256 timestamp
    ) public {
        context.handleBooking(staking, amount, timestamp);
        emit Success();
    }

    function handleCancelation(
        StakeLibV2.BookingContext memory context,
        uint256 amount,
        uint256 timestamp
    ) public {
        context.handleCancelation(staking, amount, timestamp);
        emit Success();
    }

    function deposit(uint256 amount) public {
        _stakeLibContext(msg.sender).add(staking, amount);
    }

    function balance() public view returns (uint256) {
        return staking.balance();
    }

    function deposits() public view returns (OrderedStakeLib.Deposit[] memory) {
        return staking.deposits();
    }

    function locked(address) public view returns (uint256) {
        return _stakeLibContext(msg.sender).locked(staking);
    }

    function unlocked(address) public view returns (uint256) {
        return _stakeLibContext(msg.sender).releasable(staking);
    }

    function restakeOrDepositAt(uint256 amount, uint256 inserTm) public {
        _stakeLibContext(msg.sender).restakeOrDepositAt(staking, amount, inserTm);
        emit RestakeOrDepositedAtForStatus(true);
    }

    function withdraw(uint256 amount) public {
        _stakeLibContext(msg.sender).remove(staking, amount);
    }

    function withdrawMax() public {
        _stakeLibContext(msg.sender).takeMax(staking);
    }
}
