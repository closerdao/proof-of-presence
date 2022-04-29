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
import "hardhat/console.sol";

contract TokenLock is Context, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    mapping(address => uint256) internal _balances;
    mapping(address => LockedUnit[]) internal _staked;
    uint256 public lockingPeriod;

    struct LockedUnit {
        uint256 timestamp;
        uint256 amount;
    }

    struct UnlockingResult {
        uint256 unlocked;
        uint256 remainingBalance;
        LockedUnit[] locked;
    }

    constructor(IERC20 _token, uint256 daysLocked) {
        token = _token;
        lockingPeriod = daysLocked * 86400; // there are 86400 seconds in a day
    }

    function lock(uint256 amount) public {
        _staked[_msgSender()].push(LockedUnit(block.timestamp, amount));
        _balances[_msgSender()] += amount;
        token.safeTransferFrom(_msgSender(), address(this), amount);
        // Emit
    }

    function unlock() public returns (uint256) {
        require(_balances[_msgSender()] > 0, "NOT_ENOUGHT_BALANCE");
        UnlockingResult memory result = _calculateRelease(_msgSender());
        // Change the state
        if (result.unlocked > 0) {
            // crear previous stake
            delete _staked[_msgSender()];
            for (uint256 i = 0; i < result.locked.length; i++) {
                // add the reminder stakes
                _staked[_msgSender()].push(result.locked[i]);
            }

            _balances[_msgSender()] = result.remainingBalance;
            token.safeTransfer(_msgSender(), result.unlocked);
            // EMIT
        }
        return result.unlocked;
    }

    function unlockedAmount(address account) public view returns (uint256) {
        UnlockingResult memory result = _calculateRelease(account);
        return result.unlocked;
    }

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function _calculateRelease(address account) internal view returns (UnlockingResult memory) {
        LockedUnit[] memory stakedFunds = _staked[account];
        UnlockingResult memory result = UnlockingResult(0, 0, new LockedUnit[](0));
        if (stakedFunds.length == 0) {
            return result;
        }

        for (uint8 i = 0; i < stakedFunds.length; i++) {
            LockedUnit memory elem = stakedFunds[i];
            if (_isReleasable(elem)) {
                result.unlocked += elem.amount;
            } else {
                result.remainingBalance += elem.amount;
                result.locked = _addUnit(result.locked, elem);
            }
        }
        return result;
    }

    function _addUnit(LockedUnit[] memory acc, LockedUnit memory unit) internal pure returns (LockedUnit[] memory) {
        uint256 length = acc.length;
        // creates new acc with one more slot
        LockedUnit[] memory newAcc = new LockedUnit[](length + 1);
        // copy previous array
        for (uint8 i = 0; i < length; i++) {
            newAcc[i] = acc[i];
        }
        // adds the new element
        newAcc[length] = unit;
        return newAcc;
    }

    function _isReleasable(LockedUnit memory unit) internal view returns (bool) {
        return (unit.timestamp + lockingPeriod) <= block.timestamp;
    }
}
