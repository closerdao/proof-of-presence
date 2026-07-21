// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ITransferPolicy} from "../interfaces/ITransferPolicy.sol";

contract TransferPolicyMock is ITransferPolicy, ERC165 {
    mapping(address => bool) public allowedSender;
    mapping(address => bool) public allowedRecipient;

    function setAllowedSender(address account, bool allowed) external {
        allowedSender[account] = allowed;
    }

    function setAllowedRecipient(address account, bool allowed) external {
        allowedRecipient[account] = allowed;
    }

    function isTransferAllowed(address, address, address from, address to, uint256) external view returns (bool) {
        if (from == address(0) || to == address(0)) return true;
        return allowedSender[from] || allowedRecipient[to];
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(ITransferPolicy).interfaceId || super.supportsInterface(interfaceId);
    }
}
