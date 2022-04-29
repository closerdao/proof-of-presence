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
    // Max number in uint256
    // same result can be achieved with: `uint256 MAX_INT = 2**256 - 1`
    // Pasted the literal here for cheaper deployment
    uint256 private constant MAX_INT = 115792089237316195423570985008687907853269984665640564039457584007913129639935;

    struct LockedUnit {
        uint256 timestamp;
        uint256 amount;
    }

    // TODO: rename is a little confusing the naming
    struct UnlockingResult {
        uint256 unlocked;
        uint256 remainingBalance;
        LockedUnit[] locked;
    }

    event Locked(address account, uint256 amount);
    event Unlocked(address account, uint256 amount);

    constructor(IERC20 _token, uint256 daysLocked) {
        token = _token;
        lockingPeriod = daysLocked * 86400; // there are 86400 seconds in a day
    }

    function lock(uint256 amount) public {
        _staked[_msgSender()].push(LockedUnit(block.timestamp, amount));
        _balances[_msgSender()] += amount;
        token.safeTransferFrom(_msgSender(), address(this), amount);
        emit Locked(_msgSender(), amount);
    }

    function unlockMax() public returns (uint256) {
        require(_balances[_msgSender()] > 0, "NOT_ENOUGHT_BALANCE");
        UnlockingResult memory result = _calculateRelease(_msgSender(), MAX_INT);

        // Change the state
        _storeUnlock(_msgSender(), result);
        return result.unlocked;
    }

    function unlock(uint256 desired) public returns (uint256) {
        require(_balances[_msgSender()] >= desired, "NOT_ENOUGHT_BALANCE");
        // `desired` is passed as value and not by reference because is a basic type
        // https://docs.soliditylang.org/en/v0.8.9/types.html#value-types
        // It will not be modified by `_calculateRelease()`
        UnlockingResult memory result = _calculateRelease(_msgSender(), desired);
        require(result.unlocked == desired, "NOT_ENOUGHT_UNLOCKABLE_BALANCE");
        // Change the state
        _storeUnlock(_msgSender(), result);
        return result.unlocked;
    }

    function _storeUnlock(address account, UnlockingResult memory result) internal {
        if (result.unlocked > 0) {
            // crear previous stake
            delete _staked[account];
            for (uint256 i = 0; i < result.locked.length; i++) {
                // add the reminder stakes
                _staked[account].push(result.locked[i]);
            }

            _balances[account] = result.remainingBalance;
            token.safeTransfer(account, result.unlocked);
            emit Unlocked(account, result.unlocked);
        }
    }

    function unlockedAmount(address account) public view returns (uint256) {
        UnlockingResult memory result = _calculateRelease(account, MAX_INT);
        return result.unlocked;
    }

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function _calculateRelease(address account, uint256 desired) internal view returns (UnlockingResult memory) {
        LockedUnit[] memory stakedFunds = _staked[account];
        UnlockingResult memory result = UnlockingResult(0, 0, new LockedUnit[](0));
        if (stakedFunds.length == 0) {
            return result;
        }

        for (uint8 i = 0; i < stakedFunds.length; i++) {
            LockedUnit memory elem = stakedFunds[i];
            if (_isReleasable(elem) && desired > 0) {
                // Example:
                // desired: 0.25 < elem.amount: 1 = true
                if (desired < elem.amount) {
                    // rest: 0.75
                    uint256 rest = elem.amount - desired;
                    // put back the remainder in user balance
                    elem.amount = rest;
                    // Add to unlocking result the desired
                    // + 0.25
                    result.unlocked += desired;
                    // The reminder gets in to the result
                    result.remainingBalance += rest;
                    // push the pocket in to the reminder balances
                    // without modifying the timestamp
                    result.locked = _addUnit(result.locked, elem);
                    // Set de desired to not substract more balance
                    desired = 0;
                } else {
                    // Substract the current amount to continue the countdown
                    desired -= elem.amount;
                    // Add to the locable amount
                    result.unlocked += elem.amount;
                }
            } else {
                // Recollect the renaining balances
                result.remainingBalance += elem.amount;
                result.locked = _addUnit(result.locked, elem);
            }
        }
        return result;
    }

    /**
     * @dev Can not modify (push) elements to memory array. The only way is to create a new
     * copy the previous elements and add one
     */
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
