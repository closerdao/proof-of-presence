// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import {LibDiamond} from "hardhat-deploy/solc_0.8/diamond/libraries/LibDiamond.sol";
import {Modifiers} from "../libraries/AppStorage.sol";
import "../libraries/AccessControlLib.sol";

contract AdminFacet is Modifiers {
    using AccessControlLib for AccessControlLib.RoleStore;

    event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole);
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);
    /**
     * @dev Emitted when the pause is triggered by `account`.
     */
    event Paused(address account);

    /**
     * @dev Emitted when the pause is lifted by `account`.
     */
    event Unpaused(address account);

    /**
     * @dev Triggers stopped state.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    function pause() external onlyRole(AccessControlLib.DEFAULT_ADMIN_ROLE) whenNotPaused {
        s.paused = true;
        emit Paused(msg.sender);
    }

    /**
     * @dev Returns to normal state.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    function unpause() external onlyRole(AccessControlLib.DEFAULT_ADMIN_ROLE) whenPaused {
        s.paused = false;
        emit Unpaused(msg.sender);
    }

    function paused() external view returns (bool) {
        return s.paused;
    }

    /**
     * @dev Returns `true` if `account` has been granted `role`.
     */
    function hasRole(bytes32 role, address account) external view returns (bool) {
        return s._roleStore.hasRole(role, account);
    }

    /**
     * @dev Returns the admin role that controls `role`. See {grantRole} and
     * {revokeRole}.
     *
     * To change a role's admin, use {_setRoleAdmin}.
     */
    function getRoleAdmin(bytes32 role) public view returns (bytes32) {
        return s._roleStore.getRoleAdmin(role);
    }

    /**
     * @dev Grants `role` to `account`.
     *
     * If `account` had not been already granted `role`, emits a {RoleGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     *
     * May emit a {RoleGranted} event.
     */
    function grantRole(bytes32 role, address account) public onlyRole(getRoleAdmin(role)) {
        s._roleStore.grantRole(role, account);
    }

    /**
     * @dev Revokes `role` from `account`.
     *
     * If `account` had been granted `role`, emits a {RoleRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     *
     * May emit a {RoleRevoked} event.
     */
    function revokeRole(bytes32 role, address account) public onlyRole(getRoleAdmin(role)) {
        s._roleStore.revokeRole(role, account);
    }

    function setRoleAdmin(bytes32 role, bytes32 adminRole) public onlyRole(getRoleAdmin(role)) {
        s._roleStore.setRoleAdmin(role, adminRole);
    }

    /**
     * @dev Revokes `role` from the calling account.
     *
     * Roles are often managed via {grantRole} and {revokeRole}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been revoked `role`, emits a {RoleRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `account`.
     *
     * May emit a {RoleRevoked} event.
     */
    function renounceRole(bytes32 role, address account) public {
        require(account == _msgSender(), "AccessControl: can only renounce roles for self");

        s._roleStore.revokeRole(role, account);
    }

    function getRoles() public pure returns (string[2][5] memory) {
        return AccessControlLib.getRoles();
    }
}
