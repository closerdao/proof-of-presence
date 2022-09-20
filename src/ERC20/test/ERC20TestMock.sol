// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20TestMock is ERC20 {
    constructor() ERC20("TestToken", "TTM") {}

    function faucet(uint256 amount) public {
        _mint(msg.sender, amount);
    }

    function faucetFor(address account, uint256 amount) public {
        _mint(account, amount);
    }
}
