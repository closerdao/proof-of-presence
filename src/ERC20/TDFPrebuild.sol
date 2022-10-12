// SPDX-License-Identifier: AGPL-1.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TDFPrebuild is ERC20, Ownable {
    constructor() ERC20("TDFprebuild", "pTDF") Ownable() {}

    function mint(address account, uint256 amount) public onlyOwner {
        _mint(account, amount);
    }
}
