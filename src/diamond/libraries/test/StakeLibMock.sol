// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../StakeLib.sol";

contract StakeLibMock {
    using StakeLib for StakeLib.StakeStore;

    StakeLib.StakeStore staking;
    IERC20 token;

    event DepositedTokens(address account, uint256 amount);
    event WithdrawnTokens(address account, uint256 amount);
    event RestakeOrDepositedAtForStatus();

    constructor(address token_) {
        token = IERC20(token_);
    }

    function restakeOrDepositAtFor(
        address account,
        uint256 amount,
        uint256 tm
    ) public {
        staking.restakeOrDepositAtFor(token, account, amount, tm);
        emit RestakeOrDepositedAtForStatus();
    }

    function depositStake(uint256 amount) public {
        _deposit(msg.sender, amount, block.timestamp);
    }

    function _deposit(
        address account,
        uint256 amount,
        uint256 depositTm
    ) internal {
        staking.deposit(token, account, amount, depositTm);
    }

    function withdrawMaxStake() public returns (uint256) {
        return staking.withdrawMax(token, msg.sender);
    }

    function withdrawStake(uint256 requested) public returns (uint256) {
        return staking.withdraw(token, msg.sender, requested);
    }

    function restakeMax() public {
        staking.restakeMax(msg.sender);
    }

    function restake(uint256 requestedAmount) public {
        staking.restake(msg.sender, requestedAmount);
    }

    function unlockedStake(address account) public view returns (uint256) {
        return staking.unlocked(account);
    }

    function lockedStake(address account) public view returns (uint256) {
        return staking.locked(account);
    }

    function stakedBalanceOf(address account) public view returns (uint256) {
        return staking.balanceOf(account);
    }

    function depositsStakedFor(address account) public view returns (StakeLib.StakedDeposit[] memory) {
        return staking.depositsFor(account);
    }
}
