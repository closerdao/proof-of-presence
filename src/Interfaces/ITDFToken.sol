// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IERC2612Standalone.sol";

// solhint-disable-next-line no-empty-blocks
interface ITDFToken is IERC20 {
    function mint(address account, uint256 amount) external;
}
