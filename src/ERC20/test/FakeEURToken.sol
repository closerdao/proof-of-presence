// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract FakeEURToken is ERC20 {
    constructor() ERC20("FakeEUR", "FEUR") {
        _mint(msg.sender, 1_000_000_000 ether);
    }

    function faucet(uint256 amount) public {
        _mint(msg.sender, amount);
    }

    function faucetFor(address account, uint256 amount) public {
        _mint(account, amount);
    }
}
