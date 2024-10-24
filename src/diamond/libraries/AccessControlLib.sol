// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

library AccessControlLib {
    using EnumerableSet for EnumerableSet.AddressSet;

    bytes32 constant DEFAULT_ADMIN_ROLE = 0x00;
    bytes32 constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 constant BOOKING_MANAGER_ROLE = keccak256("BOOKING_MANAGER_ROLE");
    bytes32 constant STAKE_MANAGER_ROLE = keccak256("STAKE_MANAGER_ROLE");
    bytes32 constant VAULT_MANAGER_ROLE = keccak256("VAULT_MANAGER_ROLE");
    bytes32 constant MEMBERSHIP_MANAGER_ROLE = keccak256("MEMBERSHIP_MANAGER_ROLE");
    bytes32 constant BOOKING_PLATFORM_ROLE = keccak256("BOOKING_PLATFORM_ROLE");

    struct RoleData {
        mapping(address => bool) members;
        bytes32 adminRole;
    }

    struct RoleStore {
        mapping(bytes32 => RoleData) _roles;
        mapping(bytes32 => EnumerableSet.AddressSet) _roleMembers;
    }
    /**
     * @dev Emitted when `newAdminRole` is set as ``role``'s admin role, replacing `previousAdminRole`
     *
     * `DEFAULT_ADMIN_ROLE` is the starting admin for all roles, despite
     * {RoleAdminChanged} not being emitted signaling this.
     *
     * _Available since v3.1._
     */
    event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole);

    /**
     * @dev Emitted when `account` is granted `role`.
     *
     * `sender` is the account that originated the contract call, an admin role
     * bearer except when using {AccessControl-_setupRole}.
     */
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);

    /**
     * @dev Emitted when `account` is revoked `role`.
     *
     * `sender` is the account that originated the contract call:
     *   - if using `revokeRole`, it is the admin role bearer
     *   - if using `renounceRole`, it is the role bearer (i.e. `account`)
     */
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    /**
     * @dev Revert with a standard message if `_msgSender()` is missing `role`.
     * Overriding this function changes the behavior of the {onlyRole} modifier.
     *
     * Format of the revert message is described in {_checkRole}.
     *
     * _Available since v4.6._
     */
    function checkRole(RoleStore storage store, bytes32 role) internal view {
        checkRole(store, role, msg.sender);
    }

    /**
     * @dev Revert with a standard message if `account` is missing `role`.
     *
     * The format of the revert reason is given by the following regular expression:
     *
     *  /^AccessControl: account (0x[0-9a-f]{40}) is missing role (0x[0-9a-f]{64})$/
     */
    function checkRole(
        RoleStore storage store,
        bytes32 role,
        address account
    ) internal view {
        if (!hasRole(store, role, account)) {
            revert(
                string(
                    abi.encodePacked(
                        "AccessControl: account ",
                        Strings.toHexString(uint160(account), 20),
                        " is missing role ",
                        Strings.toHexString(uint256(role), 32)
                    )
                )
            );
        }
    }

    /**
     * @dev Returns `true` if `account` has been granted `role`.
     */
    function hasRole(
        RoleStore storage store,
        bytes32 role,
        address account
    ) internal view returns (bool) {
        return store._roles[role].members[account];
    }

    /**
     * @dev Returns the admin role that controls `role`. See {grantRole} and
     * {revokeRole}.
     *
     * To change a role's admin, use {_setRoleAdmin}.
     */
    function getRoleAdmin(RoleStore storage store, bytes32 role) internal view returns (bytes32) {
        return store._roles[role].adminRole;
    }

    /**
     * @dev Sets `adminRole` as ``role``'s admin role.
     *
     * Emits a {RoleAdminChanged} event.
     */
    function setRoleAdmin(
        RoleStore storage store,
        bytes32 role,
        bytes32 adminRole
    ) internal {
        bytes32 previousAdminRole = getRoleAdmin(store, role);
        store._roles[role].adminRole = adminRole;
        emit RoleAdminChanged(role, previousAdminRole, adminRole);
    }

    /**
     * @dev Grants `role` to `account`.
     *
     * Internal function without access restriction.
     *
     * May emit a {RoleGranted} event.
     */
    function grantRole(
        RoleStore storage store,
        bytes32 role,
        address account
    ) internal {
        if (!hasRole(store, role, account)) {
            store._roles[role].members[account] = true;
            emit RoleGranted(role, account, msg.sender);
        }
        store._roleMembers[role].add(account);
    }

    /**
     * @dev Revokes `role` from `account`.
     *
     * Internal function without access restriction.
     *
     * May emit a {RoleRevoked} event.
     */
    function revokeRole(
        RoleStore storage store,
        bytes32 role,
        address account
    ) internal {
        if (hasRole(store, role, account)) {
            store._roles[role].members[account] = false;
            emit RoleRevoked(role, account, msg.sender);
        }
        store._roleMembers[role].remove(account);
    }

    function getRoles() internal pure returns (string[2][6] memory roles) {
        roles[0] = ["DEFAULT_ADMIN_ROLE", string(abi.encodePacked(DEFAULT_ADMIN_ROLE))];
        roles[1] = ["MINTER_ROLE", string(abi.encodePacked(MINTER_ROLE))];
        roles[2] = ["BOOKING_MANAGER_ROLE", string(abi.encodePacked(BOOKING_MANAGER_ROLE))];
        roles[3] = ["STAKE_MANAGER_ROLE", string(abi.encodePacked(STAKE_MANAGER_ROLE))];
        roles[4] = ["VAULT_MANAGER_ROLE", string(abi.encodePacked(VAULT_MANAGER_ROLE))];
        // TODO here is missing the MEMBERSHIP_MANAGER_ROLE, is that intentional?
        roles[5] = ["BOOKING_PLATFORM_ROLE", string(abi.encodePacked(BOOKING_PLATFORM_ROLE))];
        return roles;
    }
}
