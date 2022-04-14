// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./TDFSale.sol";

contract USTSale is TDFSale {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address public constant UST_ADDRESS = 0x692597b009d13C4049a947CAB2239b7d6517875F;

    // address _token,
    // address _quote,
    // address payable _wallet,
    // uint256 _rate,
    // uint256 _minTokenBuyAmount
    constructor(address _token, address payable _wallet)
        TDFSale(_token, UST_ADDRESS, _wallet, 350000000000000000000, 1000000000000000000)
    {
        // solhint-disable-previous-line no-empty-blocks
    }
}
