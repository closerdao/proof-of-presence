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
    }

    function withdrawMaxStake() public returns (uint256) {
        return s.staking.withdrawMaxStake(s.communityToken, _msgSender());
    }

    function withdrawStake(uint256 requested) public returns (uint256) {
        return s.staking.withdrawStake(s.communityToken, _msgSender(), requested);
    }

    function restakeMax() public {
        s.staking.restakeMax(_msgSender());
    }

    function restake(uint256 requestedAmount) public {
        s.staking.restake(_msgSender(), requestedAmount);
    }

    function unlockedStake(address account) public view returns (uint256) {
        return s.staking.unlockedStake(account);
    }

    function lockedStake(address account) public view returns (uint256) {
        return s.staking.lockedStake(account);
    }

    function stakedBalanceOf(address account) public view returns (uint256) {
        return s.staking.stakedBalanceOf(account);
    }

    function depositsStakedFor(address account) public view returns (StakeLib.StakedDeposit[] memory) {
        return s.staking.depositsStakedFor(account);
    }
}
