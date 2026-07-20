// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ITransferPolicy} from "../../src/village/interfaces/ITransferPolicy.sol";
import {TDFTransferPolicy} from "../../src/profiles/tdf/TDFTransferPolicy.sol";
import {TestBase} from "./TestBase.sol";

contract TDFTransferPolicyTest is TestBase {
    TDFTransferPolicy internal policy;
    address internal treasury = makeAddr("treasury");
    address internal counterparty = makeAddr("counterparty");
    address internal member = makeAddr("member");
    address internal other = makeAddr("other");

    function setUp() public {
        policy = new TDFTransferPolicy(treasury, address(this));
    }

    function test_RestrictedPolicyAllowsOnlyDefinedCounterpartiesAndMintBurn() public {
        assertTrue(policy.transfersRestricted());
        assertTrue(policy.isTransferAllowed(address(1), address(2), address(0), member, 1));
        assertTrue(policy.isTransferAllowed(address(1), address(2), member, address(0), 1));
        assertTrue(policy.isTransferAllowed(address(1), address(2), treasury, member, 1));
        assertTrue(policy.isTransferAllowed(address(1), address(2), member, treasury, 1));
        assertFalse(policy.isTransferAllowed(address(1), address(2), member, other, 1));

        policy.setAllowedCounterparty(counterparty, true);
        assertTrue(policy.isTransferAllowed(address(1), address(2), member, counterparty, 1));
        assertTrue(policy.isTransferAllowed(address(1), address(2), counterparty, member, 1));

        policy.setAllowedCounterparty(counterparty, false);
        assertFalse(policy.isTransferAllowed(address(1), address(2), member, counterparty, 1));
    }

    function test_AdministrationChangesOnlyOurPolicyState() public {
        address newTreasury = makeAddr("newTreasury");
        policy.setTreasury(newTreasury);
        assertEq(policy.treasury(), newTreasury);

        policy.setTransfersRestricted(false);
        assertFalse(policy.transfersRestricted());
        assertTrue(policy.isTransferAllowed(address(1), address(2), member, other, 1));

        vm.expectRevert(abi.encodeWithSelector(TDFTransferPolicy.InvalidTreasury.selector, address(0)));
        policy.setTreasury(address(0));

        vm.prank(other);
        vm.expectRevert();
        policy.setTransfersRestricted(true);

        policy.setTransfersRestricted(true);
        assertTrue(policy.transfersRestricted());
        assertFalse(policy.isTransferAllowed(address(1), address(2), member, other, 1));
    }

    function test_AdvertisesOnlyTheRequiredCustomInterface() public view {
        assertTrue(policy.supportsInterface(type(ITransferPolicy).interfaceId));
        assertFalse(policy.supportsInterface(0xffffffff));
    }

    function testFuzz_RestrictedDecisionMatchesTheDocumentedCounterpartyPredicate(
        address token,
        address operator,
        address from,
        address to,
        uint256 amount
    ) public {
        policy.setAllowedCounterparty(counterparty, true);
        bool expected =
            from == address(0) ||
                to == address(0) ||
                from == treasury ||
                to == treasury ||
                from == counterparty ||
                to == counterparty;
        assertEq(policy.isTransferAllowed(token, operator, from, to, amount), expected);
    }
}
