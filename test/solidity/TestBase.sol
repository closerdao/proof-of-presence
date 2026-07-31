// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ITransferPolicy} from "../../src/village/interfaces/ITransferPolicy.sol";
import {DecayMath} from "../../src/village/libraries/DecayMath.sol";
import {ERC1967ProxyForTest} from "../../src/village/test/ERC1967ProxyForTest.sol";

abstract contract TestBase is Test {
    function _proxy(address implementation, bytes memory initializer) internal returns (address) {
        return address(new ERC1967ProxyForTest(implementation, initializer));
    }
}

contract RoleAuthorityHarness is AccessControl {
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }
}

contract TestCommunityToken is ERC20 {
    constructor() ERC20("Test Community Token", "TCT") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function forceBurn(address account, uint256 amount) external {
        _burn(account, amount);
    }
}

contract ConfigurableTransferPolicy is ITransferPolicy, ERC165 {
    bool public allowed = true;

    function setAllowed(bool value) external {
        allowed = value;
    }

    function isTransferAllowed(address, address, address, address, uint256) external view returns (bool) {
        return allowed;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(ITransferPolicy).interfaceId || super.supportsInterface(interfaceId);
    }
}

contract WrongInterfacePolicy is ERC165 {}

contract DecayMathHarness {
    function powWithPrecision(uint256 base, uint256 exponent, uint256 scale) external pure returns (uint256) {
        return DecayMath.powWithPrecision(base, exponent, scale);
    }

    function nthRoot(uint256 value, uint256 n, uint256 scale) external pure returns (uint256) {
        return DecayMath.nthRoot(value, n, scale);
    }
}
