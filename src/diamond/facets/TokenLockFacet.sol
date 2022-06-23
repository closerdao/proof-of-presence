// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../libraries/AppStorage.sol";
import "../libraries/StakeManagerLib.sol";

contract TokenLockFacet is Modifiers, Context, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using StakeManagerLib for AppStorage;

    // // Max number in uint256
    // // same result can be achieved with: `uint256 MAX_INT = 2**256 - 1`
    // // Pasted the literal here for cheaper deployment
    // uint256 private constant MAX_INT = 115792089237316195423570985008687907853269984665640564039457584007913129639935;

    // struct WithdrawingResult {
    //     uint256 untiedAmount;
    //     uint256 remainingBalance;
    //     Deposit[] remainingDeposits;
    // }

    // event DepositedTokens(address account, uint256 amount);
    // event WithdrawnTokens(address account, uint256 amount);

    function deposit(uint256 amount) public {
        // _deposit(_msgSender(), amount, block.timestamp);
        s.deposit(_msgSender(), amount, block.timestamp);
    }

    function withdrawMax() public returns (uint256) {
        return s.withdrawMax(_msgSender());
    }

    function withdraw(uint256 requested) public returns (uint256) {
        return s.withdraw(_msgSender(), requested);
    }

    function restakeMax() public {
        s.restakeMax(_msgSender());
    }

    function restake(uint256 requestedAmount) public {
        s.restake(_msgSender(), requestedAmount);
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
