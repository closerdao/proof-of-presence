// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;

import "../../libraries/AppStorage.sol";
import "../../libraries/StakeManagerLib.sol";

contract StakeManagerLibMock is Modifiers {
    using StakeManagerLib for AppStorage;
    // TODO: this events are duplicated in the library
    event DepositedTokens(address account, uint256 amount);
    event WithdrawnTokens(address account, uint256 amount);

    constructor(address token, uint256 daysLocked) {
        s.tdfToken = IERC20(token);
        s.lockingPeriod = daysLocked * 86400;
    }

    function deposit(uint256 amount) public {
        // _deposit(_msgSender(), amount, block.timestamp);
        s.deposit(msg.sender, amount, block.timestamp);
    }

    function withdrawMax() public returns (uint256) {
        return s.withdrawMax(msg.sender);
    }

    function withdraw(uint256 requested) public returns (uint256) {
        return s.withdraw(msg.sender, requested);
    }

    function restakeMax() public {
        s.restakeMax(msg.sender);
    }

    function restake(uint256 requestedAmount) public {
        s.restake(msg.sender, requestedAmount);
    }

    function unlockedAmount(address account) public view returns (uint256) {
        return s.unlockedAmount(account);
    }

    function lockedAmount(address account) public view returns (uint256) {
        return s.lockedAmount(account);
    }

    function balanceOf(address account) public view returns (uint256) {
        return s._balances[account];
    }

    function depositsFor(address account) public view returns (Deposit[] memory) {
        return s._deposits[account];
    }

    function restakeOrDepositAtFor(
        address account,
        uint256 amount,
        // TODO: initLocking time must be bigger that current timestamp
        uint256 initLockingTm
    ) public {
        s.restakeOrDepositAtFor(account, amount, initLockingTm);
    }
}
