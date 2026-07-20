// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {AccessControlEnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {VillageRoles} from "./VillageRoles.sol";

/// @title VillageAccess
/// @author Closer DAO
/// @notice Canonical role registry shared by independently deployable village modules.
/// @dev OpenZeppelin's default-admin rules limit DEFAULT_ADMIN_ROLE to one holder and require a two-step admin
/// transfer. The configured transfer delay is zero, so acceptance may happen immediately after scheduling. Role-member
/// enumeration is intended for administration and off-chain discovery; contracts should use `hasRole` for authorization.
/// UUPS upgrades and changes to the role-admin hierarchy remain reserved for the default admin; renouncing it disables
/// those operations permanently for that proxy.
contract VillageAccess is
    Initializable,
    AccessControlDefaultAdminRulesUpgradeable,
    AccessControlEnumerableUpgradeable,
    UUPSUpgradeable
{
    /// @notice A non-default role assignment applied atomically during proxy initialization.
    struct InitialRoleGrant {
        bytes32 role;
        address account;
    }

    error InitialDefaultAdminRoleGrantNotAllowed();
    error InvalidInitialRoleGrantAccount(bytes32 role);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the role authority and seeds its initial operational roles.
    /// @dev DEFAULT_ADMIN_ROLE cannot be included in `initialRoleGrants`; its sole initial holder is
    /// `initialDefaultAdmin`. Duplicate grants are harmless and collapse to one membership.
    /// @param initialDefaultAdmin Initial root administrator, normally the village governance Safe.
    /// @param initialRoleGrants Non-default roles to grant in the initialization transaction.
    function initialize(address initialDefaultAdmin, InitialRoleGrant[] memory initialRoleGrants) external initializer {
        __AccessControl_init();
        __AccessControlEnumerable_init();
        __AccessControlDefaultAdminRules_init(0, initialDefaultAdmin);

        for (uint256 i = 0; i < initialRoleGrants.length; ) {
            InitialRoleGrant memory roleGrant = initialRoleGrants[i];
            if (roleGrant.role == DEFAULT_ADMIN_ROLE) revert InitialDefaultAdminRoleGrantNotAllowed();
            if (roleGrant.account == address(0)) revert InvalidInitialRoleGrantAccount(roleGrant.role);
            // Duplicate initial grants intentionally collapse to the existing enumerable membership.
            // wake-disable-next-line unchecked-return-value
            _grantRole(roleGrant.role, roleGrant.account);

            unchecked {
                ++i;
            }
        }
    }

    /// @notice Returns the shared CommunityToken minter role ID.
    function MINTER_ROLE() external pure returns (bytes32) {
        return VillageRoles.MINTER_ROLE;
    }

    /// @notice Returns the shared booking-manager role ID.
    function BOOKING_MANAGER_ROLE() external pure returns (bytes32) {
        return VillageRoles.BOOKING_MANAGER_ROLE;
    }

    /// @notice Returns the shared booking-platform role ID.
    function BOOKING_PLATFORM_ROLE() external pure returns (bytes32) {
        return VillageRoles.BOOKING_PLATFORM_ROLE;
    }

    /// @inheritdoc AccessControlUpgradeable
    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        override(AccessControlDefaultAdminRulesUpgradeable, AccessControlEnumerableUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// @inheritdoc AccessControlUpgradeable
    function grantRole(
        bytes32 role,
        address account
    ) public override(AccessControlUpgradeable, IAccessControl, AccessControlDefaultAdminRulesUpgradeable) {
        super.grantRole(role, account);
    }

    /// @inheritdoc AccessControlUpgradeable
    function revokeRole(
        bytes32 role,
        address account
    ) public override(AccessControlUpgradeable, IAccessControl, AccessControlDefaultAdminRulesUpgradeable) {
        super.revokeRole(role, account);
    }

    /// @inheritdoc AccessControlUpgradeable
    function renounceRole(
        bytes32 role,
        address callerConfirmation
    ) public override(AccessControlUpgradeable, IAccessControl, AccessControlDefaultAdminRulesUpgradeable) {
        super.renounceRole(role, callerConfirmation);
    }

    /// @notice Changes a role's admin role. This is intentionally reserved for the root admin.
    /// @dev `getRoleAdmin` remains the OpenZeppelin source of truth for grant/revoke authorization,
    ///      while changes to that hierarchy require DEFAULT_ADMIN_ROLE to avoid delegated admins
    ///      expanding their own authority.
    /// @param role Role whose administrator is changing.
    /// @param adminRole New role allowed to grant and revoke `role`.
    function setRoleAdmin(bytes32 role, bytes32 adminRole) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setRoleAdmin(role, adminRole);
    }

    function _setRoleAdmin(
        bytes32 role,
        bytes32 adminRole
    ) internal override(AccessControlUpgradeable, AccessControlDefaultAdminRulesUpgradeable) {
        super._setRoleAdmin(role, adminRole);
    }

    function _grantRole(
        bytes32 role,
        address account
    ) internal override(AccessControlDefaultAdminRulesUpgradeable, AccessControlEnumerableUpgradeable) returns (bool) {
        return super._grantRole(role, account);
    }

    function _revokeRole(
        bytes32 role,
        address account
    ) internal override(AccessControlDefaultAdminRulesUpgradeable, AccessControlEnumerableUpgradeable) returns (bool) {
        return super._revokeRole(role, account);
    }

    /// @dev Keeps implementation upgrades under the same root authority that controls the role hierarchy.
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
