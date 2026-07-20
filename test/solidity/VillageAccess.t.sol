// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {VillageAccess} from "../../src/village/access/VillageAccess.sol";
import {VillageRoles} from "../../src/village/access/VillageRoles.sol";
import {ERC1967ProxyForTest} from "../../src/village/test/ERC1967ProxyForTest.sol";
import {TestBase} from "./TestBase.sol";

contract VillageAccessTest is TestBase {
    VillageAccess internal access;
    address internal admin = makeAddr("admin");
    address internal minter = makeAddr("minter");
    address internal manager = makeAddr("manager");
    address internal outsider = makeAddr("outsider");

    function setUp() public {
        VillageAccess implementation = new VillageAccess();
        VillageAccess.InitialRoleGrant[] memory grants = new VillageAccess.InitialRoleGrant[](2);
        grants[0] = VillageAccess.InitialRoleGrant(VillageRoles.MINTER_ROLE, minter);
        grants[1] = VillageAccess.InitialRoleGrant(VillageRoles.BOOKING_MANAGER_ROLE, manager);
        access = VillageAccess(
            _proxy(address(implementation), abi.encodeCall(VillageAccess.initialize, (admin, grants)))
        );
    }

    function test_InitializesOnlyTheConfiguredAuthorities() public view {
        assertEq(access.defaultAdmin(), admin);
        assertFalse(access.hasRole(bytes32(0), address(this)));
        assertTrue(access.hasRole(VillageRoles.MINTER_ROLE, minter));
        assertTrue(access.hasRole(VillageRoles.BOOKING_MANAGER_ROLE, manager));
    }

    function test_RejectsDefaultAdminInTheInitialGrantList() public {
        VillageAccess implementation = new VillageAccess();
        VillageAccess.InitialRoleGrant[] memory grants = new VillageAccess.InitialRoleGrant[](1);
        grants[0] = VillageAccess.InitialRoleGrant(bytes32(0), minter);

        vm.expectRevert(VillageAccess.InitialDefaultAdminRoleGrantNotAllowed.selector);
        new ERC1967ProxyForTest(address(implementation), abi.encodeCall(VillageAccess.initialize, (admin, grants)));
    }

    function test_RejectsZeroAddressInTheInitialGrantList() public {
        VillageAccess implementation = new VillageAccess();
        VillageAccess.InitialRoleGrant[] memory grants = new VillageAccess.InitialRoleGrant[](1);
        grants[0] = VillageAccess.InitialRoleGrant(VillageRoles.MINTER_ROLE, address(0));

        vm.expectRevert(
            abi.encodeWithSelector(VillageAccess.InvalidInitialRoleGrantAccount.selector, VillageRoles.MINTER_ROLE)
        );
        new ERC1967ProxyForTest(address(implementation), abi.encodeCall(VillageAccess.initialize, (admin, grants)));
    }

    function test_DuplicateInitialRoleGrantsCollapseToOneEnumerableMembership() public {
        VillageAccess implementation = new VillageAccess();
        VillageAccess.InitialRoleGrant[] memory grants = new VillageAccess.InitialRoleGrant[](2);
        grants[0] = VillageAccess.InitialRoleGrant(VillageRoles.MINTER_ROLE, minter);
        grants[1] = VillageAccess.InitialRoleGrant(VillageRoles.MINTER_ROLE, minter);

        VillageAccess initialized = VillageAccess(
            address(
                new ERC1967ProxyForTest(
                    address(implementation),
                    abi.encodeCall(VillageAccess.initialize, (admin, grants))
                )
            )
        );

        assertTrue(initialized.hasRole(VillageRoles.MINTER_ROLE, minter));
        assertEq(initialized.getRoleMemberCount(VillageRoles.MINTER_ROLE), 1);
        assertEq(initialized.getRoleMember(VillageRoles.MINTER_ROLE, 0), minter);
    }

    function test_DefaultAdminCanDefineADelegatedRoleAdmin() public {
        bytes32 futureRole = keccak256("FUTURE_ROLE");

        vm.prank(admin);
        access.setRoleAdmin(futureRole, VillageRoles.MINTER_ROLE);
        assertEq(access.getRoleAdmin(futureRole), VillageRoles.MINTER_ROLE);

        vm.prank(minter);
        access.grantRole(futureRole, manager);
        assertTrue(access.hasRole(futureRole, manager));
    }

    function test_DelegatedAdminCannotChangeTheRoleHierarchy() public {
        vm.prank(minter);
        vm.expectRevert();
        access.setRoleAdmin(keccak256("FUTURE_ROLE"), VillageRoles.MINTER_ROLE);
    }
}
