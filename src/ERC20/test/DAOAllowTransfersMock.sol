// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../Interfaces/ITransferPermitter.sol";

contract DAOAllowTransfersMock {
    using SafeERC20 for IERC20;

    mapping(address => mapping(address => uint256)) permittions;

    function isTokenTransferPermitted(
        address from,
        address to,
        uint256 amount
    ) external view returns (bool) {
        if (permittions[from][to] >= amount && permittions[from][to] > uint256(0)) return true;
        return false;
    }

    function addPermit(
        address from,
        address to,
        uint256 amount
    ) public {
        permittions[from][to] = amount;
    }

    function doTransferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) public {
        IERC20(token).safeTransferFrom(from, to, amount);
    }

    function doTransfer(
        address token,
        address to,
        uint256 amount
    ) public {
        IERC20(token).safeTransfer(to, amount);
    }
}
