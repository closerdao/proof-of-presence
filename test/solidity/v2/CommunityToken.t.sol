// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {CommunityToken} from "../../../src/village/tokens/CommunityToken.sol";
import {VillageRoles} from "../../../src/village/access/VillageRoles.sol";
import {ConfigurableTransferPolicy, RoleAuthorityHarness, V2TestBase, WrongInterfacePolicy} from "./V2TestBase.sol";

contract V2CommunityTokenTest is V2TestBase {
    CommunityToken internal token;
    RoleAuthorityHarness internal authority;
    ConfigurableTransferPolicy internal policy;

    address internal minter = makeAddr("minter");
    address internal roleAdmin = makeAddr("roleAdmin");
    address internal holder = makeAddr("holder");
    address internal recipient = makeAddr("recipient");
    address internal operator = makeAddr("operator");
    address internal outsider = makeAddr("outsider");

    function setUp() public {
        authority = new RoleAuthorityHarness(address(this));
        authority.grantRole(VillageRoles.MINTER_ROLE, minter);
        authority.grantRole(bytes32(0), roleAdmin);
        policy = new ConfigurableTransferPolicy();
        token = _deployToken(address(authority), address(0), address(this), 0, address(0));
    }

    function test_InitializesCustomStateAndInitialSupply() public {
        CommunityToken initialized = _deployToken(address(authority), address(policy), address(this), 25 ether, holder);

        assertEq(initialized.name(), "Community");
        assertEq(initialized.symbol(), "COM");
        assertEq(initialized.owner(), address(this));
        assertEq(address(initialized.roleAuthority()), address(authority));
        assertEq(address(initialized.transferPolicy()), address(policy));
        assertEq(initialized.balanceOf(holder), 25 ether);
    }

    function test_RejectsInvalidCustomInitializerInputs() public {
        CommunityToken implementation = new CommunityToken();

        vm.expectRevert(abi.encodeWithSelector(CommunityToken.InvalidOwner.selector, address(0)));
        _proxy(
            address(implementation),
            abi.encodeCall(
                CommunityToken.initialize,
                ("Community", "COM", 0, address(0), address(authority), address(0), address(0))
            )
        );

        vm.expectRevert(abi.encodeWithSelector(CommunityToken.InvalidRoleAuthority.selector, outsider));
        _proxy(
            address(implementation),
            abi.encodeCall(
                CommunityToken.initialize,
                ("Community", "COM", 0, address(0), outsider, address(0), address(this))
            )
        );

        vm.expectRevert(abi.encodeWithSelector(CommunityToken.InvalidInitialRecipient.selector, address(0)));
        _proxy(
            address(implementation),
            abi.encodeCall(
                CommunityToken.initialize,
                ("Community", "COM", 1, address(0), address(authority), address(0), address(this))
            )
        );
    }

    function test_RoleCanMintAndBurnForAnotherAccount() public {
        vm.prank(minter);
        token.mint(holder, 10 ether);

        vm.prank(minter);
        token.burnFromByRole(holder, 4 ether);
        assertEq(token.balanceOf(holder), 6 ether);

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(CommunityToken.Unauthorized.selector, outsider, VillageRoles.MINTER_ROLE)
        );
        token.mint(holder, 1);
    }

    function test_ReplacingRoleAuthorityImmediatelyChangesAuthorization() public {
        RoleAuthorityHarness replacement = new RoleAuthorityHarness(address(this));
        replacement.grantRole(VillageRoles.MINTER_ROLE, operator);

        vm.expectEmit(true, true, false, true, address(token));
        emit CommunityToken.RoleAuthorityChanged(address(authority), address(replacement));
        token.setRoleAuthority(address(replacement));

        vm.prank(minter);
        vm.expectRevert();
        token.mint(holder, 1);

        vm.prank(operator);
        token.mint(holder, 1);
        assertEq(token.balanceOf(holder), 1);
    }

    function test_ValidatesPolicyInterfacesAndRootRoleAuthorization() public {
        vm.expectRevert(abi.encodeWithSelector(CommunityToken.InvalidTransferPolicy.selector, outsider));
        token.setTransferPolicy(outsider);

        WrongInterfacePolicy wrongInterface = new WrongInterfacePolicy();
        vm.expectRevert(abi.encodeWithSelector(CommunityToken.InvalidTransferPolicy.selector, address(wrongInterface)));
        token.setTransferPolicy(address(wrongInterface));

        vm.prank(roleAdmin);
        token.setTransferPolicy(address(policy));
        assertEq(address(token.transferPolicy()), address(policy));

        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(CommunityToken.Unauthorized.selector, outsider, bytes32(0)));
        token.setTransferPolicy(address(0));
    }

    function test_PolicyAppliesToTransferTransferFromMintAndBurn() public {
        vm.prank(minter);
        token.mint(holder, 20 ether);
        token.setTransferPolicy(address(policy));
        policy.setAllowed(false);

        vm.prank(holder);
        vm.expectPartialRevert(CommunityToken.TransferBlockedByPolicy.selector);
        token.transfer(recipient, 1 ether);

        vm.prank(holder);
        token.approve(operator, 2 ether);
        vm.prank(operator);
        vm.expectPartialRevert(CommunityToken.TransferBlockedByPolicy.selector);
        token.transferFrom(holder, recipient, 1 ether);

        vm.prank(minter);
        vm.expectPartialRevert(CommunityToken.TransferBlockedByPolicy.selector);
        token.mint(holder, 1 ether);

        vm.prank(minter);
        vm.expectPartialRevert(CommunityToken.TransferBlockedByPolicy.selector);
        token.burnFromByRole(holder, 1 ether);

        policy.setAllowed(true);
        vm.prank(holder);
        token.transfer(recipient, 1 ether);
        assertEq(token.balanceOf(recipient), 1 ether);
    }

    function test_ZeroPolicyExplicitlyDisablesChecks() public {
        token.setTransferPolicy(address(policy));
        policy.setAllowed(false);
        token.setTransferPolicy(address(0));

        vm.prank(minter);
        token.mint(holder, 2 ether);
        vm.prank(holder);
        token.transfer(recipient, 1 ether);
        assertEq(token.balanceOf(recipient), 1 ether);
    }

    function test_OwnerOrRootRoleCanPauseAndUnpause() public {
        token.pause();
        vm.prank(minter);
        vm.expectRevert();
        token.mint(holder, 1);

        vm.prank(roleAdmin);
        token.unpause();
        vm.prank(minter);
        token.mint(holder, 1);
        assertEq(token.balanceOf(holder), 1);

        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(CommunityToken.Unauthorized.selector, outsider, bytes32(0)));
        token.pause();
    }

    function _deployToken(
        address roleAuthority,
        address transferPolicy,
        address owner,
        uint256 initialSupply,
        address initialRecipient
    ) private returns (CommunityToken) {
        CommunityToken implementation = new CommunityToken();
        return
            CommunityToken(
                _proxy(
                    address(implementation),
                    abi.encodeCall(
                        CommunityToken.initialize,
                        ("Community", "COM", initialSupply, initialRecipient, roleAuthority, transferPolicy, owner)
                    )
                )
            );
    }
}
