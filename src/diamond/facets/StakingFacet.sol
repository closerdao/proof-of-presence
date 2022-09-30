// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../libraries/AppStorage.sol";

contract StakingFacet is Modifiers, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using StakeLibV2 for StakeLibV2.Context;
    using StakeLibV2 for OrderedStakeLib.Store;

    event DepositedTokens(address account, uint256 amount);
    event WithdrawnTokens(address account, uint256 amount);

    function depositStake(uint256 amount) public {
        _stakeLibContext(_msgSender()).add(s.staking[_msgSender()], amount);
    }

    function withdrawMaxStake() public {
        _stakeLibContext(_msgSender()).takeMax(s.staking[_msgSender()]);

        // return s.staking.withdrawMax(s.communityToken, _msgSender());
    }

    function withdrawStake(uint256 requested) public {
        _stakeLibContext(_msgSender()).remove(s.staking[_msgSender()], requested);

        // return s.staking.withdraw(s.communityToken, _msgSender(), requested);
    }

    // function restakeMax() public {
    //     _stakeLibContext(_msgSender()).restakeMax(s.staking[_msgSender()]);

    //     // s.staking.restakeMax(_msgSender());
    // }

    // function restake(uint256 requestedAmount) public {
    //     s.staking.restake(_msgSender(), requestedAmount);
    // }

    function unlockedStake(address account) public view returns (uint256) {
        return _stakeLibContext(_msgSender()).releasable(s.staking[account]);
    }

    function lockedStake(address account) public view returns (uint256) {
        return _stakeLibContext(_msgSender()).locked(s.staking[account]);
    }

    function stakedBalanceOf(address account) public view returns (uint256) {
        return s.staking[account].balance();
    }

    function depositsStakedFor(address account) public view returns (OrderedStakeLib.Deposit[] memory) {
        return s.staking[account].deposits();
    }
}
