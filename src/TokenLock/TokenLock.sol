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
    mapping(address => Deposit[]) internal _deposits;
    uint256 public lockingPeriod;
    // Max number in uint256
    // same result can be achieved with: `uint256 MAX_INT = 2**256 - 1`
    // Pasted the literal here for cheaper deployment
    uint256 private constant MAX_INT = 115792089237316195423570985008687907853269984665640564039457584007913129639935;

    struct Deposit {
        uint256 timestamp;
        uint256 amount;
    }

    struct WithdrawingResult {
        uint256 untiedAmount;
        uint256 remainingBalance;
        Deposit[] remainingDeposits;
    }

    event DepositedTokens(address account, uint256 amount);
    event WithdrawnTokens(address account, uint256 amount);

    constructor(IERC20 _token, uint256 daysLocked) {
        token = _token;
        lockingPeriod = daysLocked * 86400; // there are 86400 seconds in a day
    }

    function deposit(uint256 amount) public {
        _deposits[_msgSender()].push(Deposit(block.timestamp, amount));
        _balances[_msgSender()] += amount;
        token.safeTransferFrom(_msgSender(), address(this), amount);
        emit DepositedTokens(_msgSender(), amount);
    }

    function withdrawMax() public returns (uint256) {
        require(_balances[_msgSender()] > 0, "NOT_ENOUGHT_BALANCE");
        WithdrawingResult memory result = _calculateWithdraw(_msgSender(), MAX_INT);

        // Change the state
        _withdraw(_msgSender(), result);
        return result.untiedAmount;
    }

    function withdraw(uint256 requested) public returns (uint256) {
        require(_balances[_msgSender()] >= requested, "NOT_ENOUGHT_BALANCE");
        // `requested` is passed as value and not by reference because is a basic type
        // https://docs.soliditylang.org/en/v0.8.9/types.html#value-types
        // It will not be modified by `_calculateWithdraw()`
        WithdrawingResult memory result = _calculateWithdraw(_msgSender(), requested);
        require(result.untiedAmount == requested, "NOT_ENOUGHT_UNLOCKABLE_BALANCE");
        // Change the state
        _withdraw(_msgSender(), result);
        return result.untiedAmount;
    }

    function restakeMax() public {
        require(_balances[_msgSender()] > 0, "NOT_ENOUGHT_BALANCE");
        WithdrawingResult memory result = _calculateWithdraw(_msgSender(), MAX_INT);
        result.remainingDeposits = _pushDeposit(
            result.remainingDeposits,
            Deposit(block.timestamp, result.untiedAmount)
        );
        // crear previous deposits
        _deposits[_msgSender()] = result.remainingDeposits;
        // for (uint256 i = 0; i < result.remainingDeposits.length; i++) {
        //     // add the reminder deposits
        //     _deposits[_msgSender()].push(result.remainingDeposits[i]);
        // }
    }

    function _withdraw(address account, WithdrawingResult memory result) internal {
        if (result.untiedAmount > 0) {
            // crear previous deposits
            delete _deposits[account];
            for (uint256 i = 0; i < result.remainingDeposits.length; i++) {
                // add the reminder deposits
                _deposits[account].push(result.remainingDeposits[i]);
            }

            _balances[account] = result.remainingBalance;
            token.safeTransfer(account, result.untiedAmount);
            emit WithdrawnTokens(account, result.untiedAmount);
        }
    }

    function unlockedAmount(address account) public view returns (uint256) {
        WithdrawingResult memory result = _calculateWithdraw(account, MAX_INT);
        return result.untiedAmount;
    }

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function _calculateWithdraw(address account, uint256 requested) internal view returns (WithdrawingResult memory) {
        Deposit[] memory stakedFunds = _deposits[account];
        WithdrawingResult memory result = WithdrawingResult(0, 0, new Deposit[](0));
        if (stakedFunds.length == 0) {
            return result;
        }

        for (uint8 i = 0; i < stakedFunds.length; i++) {
            Deposit memory elem = stakedFunds[i];
            if (_isReleasable(elem) && requested > 0) {
                // Example:
                // requested: 0.25 < elem.amount: 1 = true
                if (requested < elem.amount) {
                    // rest: 0.75
                    uint256 rest = elem.amount - requested;
                    // put back the remainder in user balance
                    elem.amount = rest;
                    // Add to unlocked result the requested reminder
                    // + 0.25
                    result.untiedAmount += requested;
                    // The reminder gets into the result
                    result.remainingBalance += rest;
                    // push the pocket into the reminder balances
                    // without modifying the timestamp
                    result.remainingDeposits = _pushDeposit(result.remainingDeposits, elem);
                    // Set requested to not substract more balance
                    requested = 0;
                } else {
                    // Substract the current amount to continue the countdown
                    requested -= elem.amount;
                    // Add to the unlockable amount
                    result.untiedAmount += elem.amount;
                }
            } else {
                // Recollect the renaining balances
                result.remainingBalance += elem.amount;
                result.remainingDeposits = _pushDeposit(result.remainingDeposits, elem);
            }
        }
        return result;
    }

    /**
     * @dev Can not modify (push) elements to memory array. The only way is to create a new
     * one with +1 size,copy the previous elements and add the last one
     */
    function _pushDeposit(Deposit[] memory acc, Deposit memory unit) internal pure returns (Deposit[] memory) {
        uint256 length = acc.length;
        // creates new acc with one more slot
        Deposit[] memory newAcc = new Deposit[](length + 1);
        // copy previous array
        for (uint8 i = 0; i < length; i++) {
            newAcc[i] = acc[i];
        }
        // adds the new element
        newAcc[length] = unit;
        return newAcc;
    }

    function _isReleasable(Deposit memory unit) internal view returns (bool) {
        return (unit.timestamp + lockingPeriod) <= block.timestamp;
    }
}
