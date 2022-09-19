// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../StakeLib.sol";

contract StakeLibMock {
    using StakeLib for StakeLib.StakeStore;

    StakeLib.StakeStore staking;
    IERC20 token;

    constructor(address token_) {
        token = IERC20(token_);
    }

    function restakeOrDepositAtFor(
        address account,
        uint256 amount,
        uint256 tm
    ) public {
        staking.restakeOrDepositAtFor(token, account, amount, tm);
    }

    function unlockedStake(address account) public view returns (uint256) {
        return staking.unlockedStake(account);
    }

    function lockedStake(address account) public view returns (uint256) {
        return staking.lockedStake(account);
    }

    function stakedBalanceOf(address account) public view returns (uint256) {
        return staking.stakedBalanceOf(account);
    }

    function depositsStakedFor(address account) public view returns (StakeLib.StakedDeposit[] memory) {
        return staking.depositsStakedFor(account);
    }
}
