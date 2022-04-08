// SPDX-License-Identifier: AGPL-1.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ERC20Base.sol";
import "./WithPermitAndFixedDomain.sol";

contract TDFToken is ERC20Base, WithPermitAndFixedDomain {
    constructor(address to, uint256 amount) WithPermitAndFixedDomain("1") {
        _mint(to, amount);
    }

    string public constant symbol = "TDF";

    function name() public pure override returns (string memory) {
        return "TDF token";
    }
}
