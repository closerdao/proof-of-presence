// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract StakedTDF is Context, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    mapping(address => uint256) internal _balances;
    mapping(address => StakedUnit[]) internal _staked;
    uint256 public lockingPeriod = 1 * 86400; // one day for tests

    struct StakedUnit {
        uint256 timestamp;
        uint256 amount;
    }

    struct RedeemtionState {
        uint256 redeemable;
        uint256 remainingBalance;
        StakedUnit[] unRedeemable;
    }

    constructor(IERC20 _token) {
        token = _token;
    }

    function stake(uint256 amount) public {
        _staked[_msgSender()].push(StakedUnit(block.timestamp, amount));
        _balances[_msgSender()] += amount;
        token.safeTransfer(address(this), amount);
        // Emit
    }

    function redeem() public returns (uint256) {
        RedeemtionState memory result = _calculateRedeem(_msgSender());

        if (result.redeemable > 0) {
            uint256 unReL = result.unRedeemable.length;
            // Change the state

            _staked[_msgSender()] = new StakedUnit[](unReL);
            for (uint256 i = 0; i < unReL; i++) {
                StakedUnit memory unit = result.unRedeemable[i];
                _staked[_msgSender()].push(StakedUnit(unit.timestamp, unit.amount));
            }

            // _staked[_msgSender()] = result.unRedeemable;
            _balances[_msgSender()] = result.remainingBalance;
            token.safeTransfer(_msgSender(), result.redeemable);
        }
        // EMIT
        return result.redeemable;
    }

    function amountRedeemable(address account) public view returns (uint256) {
        RedeemtionState memory result = _calculateRedeem(account);
        return result.redeemable;
    }

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function _calculateRedeem(address account) internal view returns (RedeemtionState memory) {
        StakedUnit[] memory stakedFunds = _staked[account];
        RedeemtionState memory state = RedeemtionState(0, 0, new StakedUnit[](0));
        if (stakedFunds.length == 0) {
            return state;
        }

        for (uint8 i = 0; i < stakedFunds.length; i++) {
            StakedUnit memory elem = stakedFunds[i];
            if (_isRedeemable(elem)) {
                state.redeemable += elem.amount;
            } else {
                state.remainingBalance += elem.amount;
                state.unRedeemable = _addUnit(state.unRedeemable, elem);
            }
        }
        return state;
    }

    function _addUnit(StakedUnit[] memory acc, StakedUnit memory unit) internal pure returns (StakedUnit[] memory) {
        uint256 length = acc.length;

        StakedUnit[] memory newAcc = new StakedUnit[](length + 1);
        for (uint8 i = 0; i < length; i++) {
            newAcc[i] = acc[i];
        }
        newAcc[length] = unit;
        return newAcc;
    }

    function _isRedeemable(StakedUnit memory unit) internal view returns (bool) {
        return unit.timestamp + lockingPeriod >= block.timestamp;
    }
}
