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

interface IERC20ApproveAndCall {
    function approveAndCall(
        address spender,
        uint256 amount,
        bytes calldata data
    ) external returns (bool);
}

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
        _deposit(_msgSender(), amount, block.timestamp);
    }

    function _deposit(
        address account,
        uint256 amount,
        uint256 depositTm
    ) internal {
        _deposits[account].push(Deposit(depositTm, amount));
        _balances[account] += amount;
        token.safeTransferFrom(account, address(this), amount);
        emit DepositedTokens(account, amount);
    }

    function withdrawMax() public returns (uint256) {
        require(_balances[_msgSender()] > 0, "NOT_ENOUGHT_BALANCE");
        WithdrawingResult memory result = _calculateWithdraw(_msgSender(), MAX_INT, block.timestamp);

        // Change the state
        _withdraw(_msgSender(), result);
        return result.untiedAmount;
    }

    function withdraw(uint256 requested) public returns (uint256) {
        require(_balances[_msgSender()] >= requested, "NOT_ENOUGHT_BALANCE");
        // `requested` is passed as value and not by reference because is a basic type
        // https://docs.soliditylang.org/en/v0.8.9/types.html#value-types
        // It will not be modified by `_calculateWithdraw()`
        WithdrawingResult memory result = _calculateWithdraw(_msgSender(), requested, block.timestamp);
        require(result.untiedAmount == requested, "NOT_ENOUGHT_UNLOCKABLE_BALANCE");
        // Change the state
        _withdraw(_msgSender(), result);
        return result.untiedAmount;
    }

    function restakeMax() public {
        require(_balances[_msgSender()] > 0, "NOT_ENOUGHT_BALANCE");
        WithdrawingResult memory result = _calculateWithdraw(_msgSender(), MAX_INT, block.timestamp);
        _restake(_msgSender(), result, block.timestamp);
    }

    function restake(uint256 requestedAmount) public {
        require(_balances[_msgSender()] > 0, "NOT_ENOUGHT_BALANCE");
        WithdrawingResult memory result = _calculateWithdraw(_msgSender(), requestedAmount, block.timestamp);
        require(result.untiedAmount == requestedAmount, "NOT_ENOUGHT_UNLOCKABLE_BALANCE");
        _restake(_msgSender(), result, block.timestamp);
    }

    struct ApprovalCallback {
        uint256 timestamp;
    }

    function approveAndRestakeOrDepositAtFor(
        address account,
        uint256 amount,
        uint256 initLockingTm
    ) external returns (bool) {
        console.log(address(this));
        return
            IERC20ApproveAndCall(address(token)).approveAndCall(
                account,
                amount,
                abi.encode(ApprovalCallback(initLockingTm))
            );
    }

    function restakeOrDepositAtFor(
        address account,
        uint256 amount,
        // TODO: initLocking time must be bigger that current timestamp
        uint256 initLockingTm
    ) public {
        _restakeOrDepositAtFor(account, amount, initLockingTm);
    }

    function _restakeOrDepositAtFor(
        address account,
        uint256 amount,
        // TODO: initLocking time must be bigger that current timestamp
        uint256 initLockingTm
    ) private {
        require(initLockingTm >= block.timestamp, "Unable to stake to the pass");
        uint256 stake = _balances[account];
        uint256 tBalance = token.balanceOf(account);
        require(stake + tBalance >= amount, "NOT_ENOUGHT_BALANCE");
        if (stake == 0) {
            _deposit(account, amount, initLockingTm);
        } else {
            // TODO: the restake should account for bigger TM as staked and update the smaller TM only
            WithdrawingResult memory result = _calculateWithdraw(account, amount, MAX_INT);

            _restake(account, result, initLockingTm);

            if (amount > result.untiedAmount) {
                uint256 toTransfer = amount - result.untiedAmount;
                _deposit(account, toTransfer, initLockingTm);
            }
        }
    }

    function onTokenApproval(
        address account,
        uint256 amount,
        bytes calldata data
    ) external returns (bool) {
        ApprovalCallback memory params = abi.decode(data, (ApprovalCallback));
        _restakeOrDepositAtFor(account, amount, params.timestamp);
        return true;
    }

    function _restake(
        address account,
        WithdrawingResult memory result,
        // TODO: initLocking time must be bigger than current timestamp
        uint256 lockingInitTm
    ) internal {
        // crear previous deposits
        delete _deposits[account];
        for (uint256 i = 0; i < result.remainingDeposits.length; i++) {
            // copy the deposits to storage
            _deposits[account].push(result.remainingDeposits[i]);
        }
        // ReStake the withdrawable amount
        _deposits[account].push(Deposit(lockingInitTm, result.untiedAmount));
        // EMIT ReStaked
        // return amount
    }

    function _withdraw(address account, WithdrawingResult memory result) internal {
        if (result.untiedAmount > 0) {
            // clear previous deposits
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
        WithdrawingResult memory result = _calculateWithdraw(account, MAX_INT, block.timestamp);
        return result.untiedAmount;
    }

    function lockedAmount(address account) public view returns (uint256) {
        WithdrawingResult memory result = _calculateWithdraw(account, MAX_INT, block.timestamp);
        return _balances[account] - result.untiedAmount;
    }

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function depositsFor(address account) public view returns (Deposit[] memory) {
        return _deposits[account];
    }

    function _calculateWithdraw(
        address account,
        uint256 requested,
        uint256 lockedUntil
    ) internal view returns (WithdrawingResult memory) {
        Deposit[] memory stakedFunds = _deposits[account];
        WithdrawingResult memory result = WithdrawingResult(0, 0, new Deposit[](0));
        if (stakedFunds.length == 0) {
            return result;
        }

        for (uint8 i = 0; i < stakedFunds.length; i++) {
            Deposit memory elem = stakedFunds[i];
            if (_isReleasable(elem, lockedUntil) && requested > 0) {
                // Example:
                // requested: 25 < elem.amount: 100 = true
                // TODO: initLocking time must be bigger than current timestamp
                if (requested < elem.amount) {
                    // rest: 75
                    uint256 rest = elem.amount - requested;
                    // put back the remainder in user balance
                    elem.amount = rest;
                    // Add to unlocked result the requested reminder
                    // + 25
                    result.untiedAmount += requested;
                    // The reminder gets into the result
                    result.remainingBalance += rest;
                    // push the pocket into the reminder balances
                    // without modifying the timestamp
                    result.remainingDeposits = _pushDeposit(result.remainingDeposits, elem);
                    // Set requested to 0 to stop substracting more balance
                    requested = 0;
                } else {
                    // Substract the current amount to continue the countdown
                    requested -= elem.amount;
                    // Add to the unlockable amount
                    result.untiedAmount += elem.amount;
                }
            } else {
                // Recollect the remaining balances
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
        // push the new element
        newAcc[length] = unit;
        return newAcc;
    }

    function _isReleasable(Deposit memory unit, uint256 lockedUntil) internal view returns (bool) {
        return (unit.timestamp + lockingPeriod) <= lockedUntil;
    }
}
