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

contract StakedTDF is Context {
    using SafeERC20 for IERC20;

    struct StakedUnit {
        uint256 timestamp;
        uint256 amount;
    }

    IERC20 public token;
    mapping(address => uint256) internal _balances;
    mapping(address => StakedUnit[]) internal _staked;

    constructor(IERC20 _token) {
        token = _token;
    }

    function stake(uint256 amount) public {
        token.safeTransfer(address(this), amount);
        _staked[_msgSender()][block.timestamp] = amount;
        _balances[_msgSender()] += amount;
        // Emit
    }

    function redeem(uint256 amount) public {
        mapping(uint256 => uint256) storage stakedFunds = _staked[_msgSender()];

        for (uint8 i = 0; i <= stakedFunds.length; i++) {}
    }
}
