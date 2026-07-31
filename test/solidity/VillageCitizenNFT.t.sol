// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Vm} from "forge-std/Vm.sol";
import {VillageCitizenNFT} from "../../src/village/citizenship/VillageCitizenNFT.sol";
import {VillageRoles} from "../../src/village/access/VillageRoles.sol";
import {VillageCitizenNFTUpgradeMock} from "../../src/village/test/VillageCitizenNFTUpgradeMock.sol";
import {TestBase, RoleAuthorityHarness} from "./TestBase.sol";

contract CitizenReceiver is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract IncompatibleCitizenReceiver {}

contract ReentrantCitizenReceiver is IERC721Receiver {
    VillageCitizenNFT internal immutable nft;
    bytes32 internal immutable reentrantRef;

    constructor(VillageCitizenNFT nft_, bytes32 reentrantRef_) {
        nft = nft_;
        reentrantRef = reentrantRef_;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        nft.issue(address(0xBEEF), reentrantRef);
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract VillageCitizenNFTTest is TestBase {
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Locked(uint256 tokenId);
    event CitizenshipIssued(
        address indexed operator,
        address indexed citizen,
        uint256 indexed tokenId,
        bytes32 subjectRef,
        uint64 issuedAt
    );
    event CitizenshipOperatorBurned(
        address indexed operator,
        address indexed citizen,
        uint256 indexed tokenId,
        bytes32 subjectRef,
        VillageCitizenNFT.BurnReason reason
    );
    event CitizenshipSelfBurned(address indexed citizen, uint256 indexed tokenId, bytes32 subjectRef);
    event CitizenshipRecovered(
        address indexed operator,
        address indexed oldCitizen,
        address indexed newCitizen,
        uint256 oldTokenId,
        uint256 newTokenId,
        bytes32 oldSubjectRef,
        bytes32 newSubjectRef
    );
    event BaseURIChanged(string oldBaseURI, string newBaseURI);
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);

    RoleAuthorityHarness internal authority;
    VillageCitizenNFT internal nft;
    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal citizen = makeAddr("citizen");
    address internal otherCitizen = makeAddr("otherCitizen");
    address internal outsider = makeAddr("outsider");
    bytes32 internal constant SUBJECT_ONE = keccak256("opaque-subject-one");
    bytes32 internal constant SUBJECT_TWO = keccak256("opaque-subject-two");
    bytes32 internal constant SUBJECT_THREE = keccak256("opaque-subject-three");

    function setUp() public {
        authority = new RoleAuthorityHarness(address(this));
        authority.grantRole(VillageRoles.CITIZEN_OPERATOR_ROLE, operator);
        VillageCitizenNFT implementation = new VillageCitizenNFT();
        nft = VillageCitizenNFT(
            _proxy(
                address(implementation),
                abi.encodeCall(
                    VillageCitizenNFT.initialize,
                    ("Village Citizen", "VCIT", "https://citizen.example/", address(authority), owner)
                )
            )
        );
    }

    function test_ImplementationIsDisabledAndProxyInitializesOnlyOnce() public {
        VillageCitizenNFT implementation = new VillageCitizenNFT();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        implementation.initialize("Citizen", "CIT", "", address(authority), owner);

        vm.expectRevert(Initializable.InvalidInitialization.selector);
        nft.initialize("Other", "OTHER", "", address(authority), owner);
    }

    function test_InitializationRejectsInvalidOwnerAndAuthorities() public {
        VillageCitizenNFT implementation = new VillageCitizenNFT();
        vm.expectRevert(abi.encodeWithSelector(VillageCitizenNFT.InvalidOwner.selector, address(0)));
        _proxy(
            address(implementation),
            abi.encodeCall(VillageCitizenNFT.initialize, ("Citizen", "CIT", "", address(authority), address(0)))
        );

        implementation = new VillageCitizenNFT();
        vm.expectRevert(abi.encodeWithSelector(VillageCitizenNFT.InvalidRoleAuthority.selector, address(0)));
        _proxy(
            address(implementation),
            abi.encodeCall(VillageCitizenNFT.initialize, ("Citizen", "CIT", "", address(0), owner))
        );

        implementation = new VillageCitizenNFT();
        vm.expectRevert(abi.encodeWithSelector(VillageCitizenNFT.InvalidRoleAuthority.selector, outsider));
        _proxy(
            address(implementation),
            abi.encodeCall(VillageCitizenNFT.initialize, ("Citizen", "CIT", "", outsider, owner))
        );
    }

    function test_SupportsEveryRequiredInterface() public view {
        assertTrue(nft.supportsInterface(0x80ac58cd));
        assertTrue(nft.supportsInterface(0x5b5e139f));
        assertTrue(nft.supportsInterface(0x780e9d63));
        assertTrue(nft.supportsInterface(0xb45a3c0e));
        assertTrue(nft.supportsInterface(0x49064906));
        assertFalse(nft.supportsInterface(0xffffffff));
    }

    function test_IssueEmitsStandardsAndDomainEventsAndPopulatesLookups() public {
        vm.warp(1_234_567);
        vm.startPrank(operator);
        vm.expectEmit(true, true, true, true, address(nft));
        emit Transfer(address(0), citizen, 1);
        vm.expectEmit(false, false, false, true, address(nft));
        emit Locked(1);
        vm.expectEmit(true, true, true, true, address(nft));
        emit CitizenshipIssued(operator, citizen, 1, SUBJECT_ONE, uint64(block.timestamp));
        uint256 tokenId = nft.issue(citizen, SUBJECT_ONE);
        vm.stopPrank();

        assertEq(tokenId, 1);
        assertEq(nft.ownerOf(tokenId), citizen);
        assertEq(nft.balanceOf(citizen), 1);
        assertTrue(nft.hasCitizenship(citizen));
        assertEq(nft.tokenIdOf(citizen), tokenId);
        VillageCitizenNFT.CitizenshipInfo memory info = nft.citizenshipInfo(citizen);
        assertEq(info.tokenId, tokenId);
        assertEq(info.subjectRef, SUBJECT_ONE);
        assertEq(info.issuedAt, block.timestamp);
        assertEq(nft.tokenURI(tokenId), "https://citizen.example/1");
        assertTrue(nft.locked(tokenId));
        assertEq(nft.totalCitizens(), 1);
        assertEq(nft.totalSupply(), 1);
        assertEq(nft.tokenByIndex(0), tokenId);
        assertEq(nft.tokenOfOwnerByIndex(citizen, 0), tokenId);
    }

    function test_IssueSupportsACompatibleReceiver() public {
        CitizenReceiver receiver = new CitizenReceiver();
        vm.prank(operator);
        assertEq(nft.issue(address(receiver), SUBJECT_ONE), 1);
        assertEq(nft.ownerOf(1), address(receiver));
    }

    function test_MintAndBurnNeverEmitUnlockedOrMetadataEvents() public {
        bytes32 lockedTopic = keccak256("Locked(uint256)");
        bytes32 unlockedTopic = keccak256("Unlocked(uint256)");
        bytes32 metadataUpdateTopic = keccak256("MetadataUpdate(uint256)");
        bytes32 batchMetadataUpdateTopic = keccak256("BatchMetadataUpdate(uint256,uint256)");

        vm.recordLogs();
        vm.prank(operator);
        nft.issue(citizen, SUBJECT_ONE);
        Vm.Log[] memory mintLogs = vm.getRecordedLogs();
        assertTrue(_containsTopic(mintLogs, lockedTopic));
        assertFalse(_containsTopic(mintLogs, unlockedTopic));
        assertFalse(_containsTopic(mintLogs, metadataUpdateTopic));
        assertFalse(_containsTopic(mintLogs, batchMetadataUpdateTopic));

        vm.recordLogs();
        vm.prank(citizen);
        nft.burn(1);
        Vm.Log[] memory burnLogs = vm.getRecordedLogs();
        assertFalse(_containsTopic(burnLogs, unlockedTopic));
        assertFalse(_containsTopic(burnLogs, metadataUpdateTopic));
        assertFalse(_containsTopic(burnLogs, batchMetadataUpdateTopic));
    }

    function test_IssueRejectsUnauthorizedInvalidOccupiedReusedAndIncompatibleInputs() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                VillageCitizenNFT.Unauthorized.selector,
                outsider,
                VillageRoles.CITIZEN_OPERATOR_ROLE
            )
        );
        vm.prank(outsider);
        nft.issue(citizen, SUBJECT_ONE);

        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSelector(VillageCitizenNFT.InvalidCitizen.selector, address(0)));
        nft.issue(address(0), SUBJECT_ONE);
        vm.expectRevert(VillageCitizenNFT.InvalidSubjectReference.selector);
        nft.issue(citizen, bytes32(0));
        nft.issue(citizen, SUBJECT_ONE);
        vm.expectRevert(abi.encodeWithSelector(VillageCitizenNFT.CitizenAlreadyCredentialed.selector, citizen, 1));
        nft.issue(citizen, SUBJECT_TWO);
        vm.expectRevert(abi.encodeWithSelector(VillageCitizenNFT.SubjectReferenceAlreadyUsed.selector, SUBJECT_ONE));
        nft.issue(otherCitizen, SUBJECT_ONE);

        IncompatibleCitizenReceiver incompatible = new IncompatibleCitizenReceiver();
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidReceiver.selector, address(incompatible)));
        nft.issue(address(incompatible), SUBJECT_TWO);
        vm.stopPrank();

        vm.warp(uint256(type(uint64).max) + 1);
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(VillageCitizenNFT.TimestampOutOfRange.selector, uint256(type(uint64).max) + 1)
        );
        nft.issue(otherCitizen, SUBJECT_TWO);
    }

    function test_SoulboundTransfersAndPublicApprovalsAlwaysRevert() public {
        vm.prank(operator);
        nft.issue(citizen, SUBJECT_ONE);

        vm.startPrank(citizen);
        vm.expectRevert(VillageCitizenNFT.SoulboundTransfer.selector);
        nft.transferFrom(citizen, otherCitizen, 1);
        vm.expectRevert(VillageCitizenNFT.SoulboundTransfer.selector);
        nft.safeTransferFrom(citizen, otherCitizen, 1);
        vm.expectRevert(VillageCitizenNFT.SoulboundTransfer.selector);
        nft.safeTransferFrom(citizen, otherCitizen, 1, "payload");
        vm.expectRevert(VillageCitizenNFT.SoulboundApproval.selector);
        nft.approve(otherCitizen, 1);
        vm.expectRevert(VillageCitizenNFT.SoulboundApproval.selector);
        nft.setApprovalForAll(otherCitizen, true);
        vm.stopPrank();

        assertEq(nft.ownerOf(1), citizen);
        assertEq(nft.getApproved(1), address(0));
        assertFalse(nft.isApprovedForAll(citizen, otherCitizen));
    }

    function test_HolderBurnIsDirectOnlyAndReferenceRemainsConsumed() public {
        vm.prank(operator);
        nft.issue(citizen, SUBJECT_ONE);

        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(VillageCitizenNFT.NotCredentialHolder.selector, outsider, 1, citizen));
        nft.burn(1);

        vm.prank(citizen);
        vm.expectEmit(true, true, false, true, address(nft));
        emit CitizenshipSelfBurned(citizen, 1, SUBJECT_ONE);
        nft.burn(1);

        assertFalse(nft.hasCitizenship(citizen));
        assertEq(nft.tokenIdOf(citizen), 0);
        VillageCitizenNFT.CitizenshipInfo memory empty = nft.citizenshipInfo(citizen);
        assertEq(empty.tokenId, 0);
        assertEq(empty.subjectRef, bytes32(0));
        assertEq(empty.issuedAt, 0);
        assertEq(nft.totalSupply(), 0);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 1));
        nft.locked(1);

        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSelector(VillageCitizenNFT.SubjectReferenceAlreadyUsed.selector, SUBJECT_ONE));
        nft.issue(otherCitizen, SUBJECT_ONE);
        assertEq(nft.issue(citizen, SUBJECT_TWO), 2);
        vm.stopPrank();
    }

    function test_OperatorBurnRecordsSuspensionAndRevocation() public {
        vm.startPrank(operator);
        nft.issue(citizen, SUBJECT_ONE);
        vm.expectEmit(true, true, true, true, address(nft));
        emit CitizenshipOperatorBurned(operator, citizen, 1, SUBJECT_ONE, VillageCitizenNFT.BurnReason.Suspension);
        nft.operatorBurn(1, VillageCitizenNFT.BurnReason.Suspension);

        nft.issue(citizen, SUBJECT_TWO);
        vm.expectEmit(true, true, true, true, address(nft));
        emit CitizenshipOperatorBurned(operator, citizen, 2, SUBJECT_TWO, VillageCitizenNFT.BurnReason.Revocation);
        nft.operatorBurn(2, VillageCitizenNFT.BurnReason.Revocation);
        vm.stopPrank();
    }

    function test_EnumerationTracksBurnsWithoutAssumingOrder() public {
        address thirdCitizen = makeAddr("thirdCitizen");
        vm.startPrank(operator);
        nft.issue(citizen, SUBJECT_ONE);
        nft.issue(otherCitizen, SUBJECT_TWO);
        nft.issue(thirdCitizen, SUBJECT_THREE);
        nft.operatorBurn(2, VillageCitizenNFT.BurnReason.Revocation);
        vm.stopPrank();

        assertEq(nft.totalCitizens(), 2);
        assertEq(nft.totalSupply(), 2);
        uint256 first = nft.tokenByIndex(0);
        uint256 second = nft.tokenByIndex(1);
        assertTrue((first == 1 && second == 3) || (first == 3 && second == 1));
        assertEq(nft.tokenOfOwnerByIndex(citizen, 0), 1);
        assertEq(nft.tokenOfOwnerByIndex(thirdCitizen, 0), 3);
        vm.expectRevert();
        nft.tokenByIndex(2);
        vm.expectRevert();
        nft.tokenOfOwnerByIndex(otherCitizen, 0);
    }

    function test_RecoveryIsAtomicAndUsesFreshWalletReferenceAndId() public {
        vm.prank(operator);
        nft.issue(citizen, SUBJECT_ONE);

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(VillageCitizenNFT.ReplacementWalletUnchanged.selector, citizen));
        nft.recover(1, citizen, SUBJECT_TWO);
        assertEq(nft.ownerOf(1), citizen);

        IncompatibleCitizenReceiver incompatible = new IncompatibleCitizenReceiver();
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidReceiver.selector, address(incompatible)));
        nft.recover(1, address(incompatible), SUBJECT_TWO);
        assertEq(nft.ownerOf(1), citizen);
        assertEq(nft.totalSupply(), 1);

        vm.prank(operator);
        vm.expectEmit(true, true, true, true, address(nft));
        emit CitizenshipRecovered(operator, citizen, otherCitizen, 1, 2, SUBJECT_ONE, SUBJECT_TWO);
        uint256 replacementId = nft.recover(1, otherCitizen, SUBJECT_TWO);
        assertEq(replacementId, 2);
        assertEq(nft.ownerOf(2), otherCitizen);
        assertEq(nft.tokenIdOf(citizen), 0);
        assertEq(nft.tokenIdOf(otherCitizen), 2);
        assertEq(nft.totalSupply(), 1);
        assertEq(nft.tokenByIndex(0), 2);
    }

    function test_RecoveryRollsBackForZeroOccupiedAndUsedReferenceTargets() public {
        address thirdCitizen = makeAddr("thirdCitizen");
        vm.startPrank(operator);
        nft.issue(citizen, SUBJECT_ONE);
        nft.issue(otherCitizen, SUBJECT_TWO);

        vm.expectRevert(abi.encodeWithSelector(VillageCitizenNFT.InvalidCitizen.selector, address(0)));
        nft.recover(1, address(0), SUBJECT_THREE);
        assertEq(nft.ownerOf(1), citizen);

        vm.expectRevert(abi.encodeWithSelector(VillageCitizenNFT.CitizenAlreadyCredentialed.selector, otherCitizen, 2));
        nft.recover(1, otherCitizen, SUBJECT_THREE);
        assertEq(nft.ownerOf(1), citizen);

        vm.expectRevert(abi.encodeWithSelector(VillageCitizenNFT.SubjectReferenceAlreadyUsed.selector, SUBJECT_TWO));
        nft.recover(1, thirdCitizen, SUBJECT_TWO);
        assertEq(nft.ownerOf(1), citizen);
        assertEq(nft.totalSupply(), 2);

        assertEq(nft.recover(1, thirdCitizen, SUBJECT_THREE), 3);
        vm.stopPrank();
        assertEq(nft.ownerOf(3), thirdCitizen);
        assertEq(nft.totalSupply(), 2);
    }

    function test_ReceiverCallbackCannotReenterLifecycleAndAllWritesRollBack() public {
        ReentrantCitizenReceiver receiver = new ReentrantCitizenReceiver(nft, SUBJECT_TWO);
        authority.grantRole(VillageRoles.CITIZEN_OPERATOR_ROLE, address(receiver));

        vm.prank(operator);
        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        nft.issue(address(receiver), SUBJECT_ONE);
        assertEq(nft.totalSupply(), 0);
        assertEq(nft.tokenIdOf(address(receiver)), 0);

        vm.prank(operator);
        assertEq(nft.issue(citizen, SUBJECT_ONE), 1);
    }

    function test_BaseURIUpdatesAllIssuedIdsAndEmitsERC4906OnlyAfterIssuance() public {
        vm.prank(owner);
        vm.recordLogs();
        nft.setBaseURI("");
        assertFalse(_containsTopic(vm.getRecordedLogs(), keccak256("BatchMetadataUpdate(uint256,uint256)")));

        vm.prank(operator);
        nft.issue(citizen, SUBJECT_ONE);
        vm.prank(citizen);
        nft.burn(1);
        vm.prank(operator);
        nft.issue(otherCitizen, SUBJECT_TWO);

        vm.startPrank(owner);
        vm.expectEmit(false, false, false, true, address(nft));
        emit BaseURIChanged("", "ipfs://citizens/");
        vm.expectEmit(false, false, false, true, address(nft));
        emit BatchMetadataUpdate(1, 2);
        nft.setBaseURI("ipfs://citizens/");
        vm.stopPrank();
        assertEq(nft.baseURI(), "ipfs://citizens/");
        assertEq(nft.tokenURI(2), "ipfs://citizens/2");
    }

    function test_OwnerControlsConfigurationTwoStepOwnershipRenunciationAndUpgrades() public {
        RoleAuthorityHarness replacementAuthority = new RoleAuthorityHarness(address(this));
        address newOwner = makeAddr("newOwner");

        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, outsider));
        nft.setRoleAuthority(address(replacementAuthority));
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(VillageCitizenNFT.InvalidRoleAuthority.selector, outsider));
        nft.setRoleAuthority(outsider);

        vm.prank(owner);
        nft.transferOwnership(newOwner);
        assertEq(nft.owner(), owner);
        assertEq(nft.pendingOwner(), newOwner);
        vm.prank(newOwner);
        nft.acceptOwnership();

        vm.prank(newOwner);
        nft.setRoleAuthority(address(replacementAuthority));
        assertEq(address(nft.roleAuthority()), address(replacementAuthority));

        VillageCitizenNFTUpgradeMock nextImplementation = new VillageCitizenNFTUpgradeMock();
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, outsider));
        nft.upgradeToAndCall(address(nextImplementation), "");

        vm.prank(newOwner);
        nft.renounceOwnership();
        assertEq(nft.owner(), address(0));
        vm.prank(newOwner);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, newOwner));
        nft.setBaseURI("unreachable");
    }

    function test_UpgradePreservesNamespacedCredentialAndEnumerableState() public {
        vm.prank(operator);
        nft.issue(citizen, SUBJECT_ONE);
        VillageCitizenNFTUpgradeMock nextImplementation = new VillageCitizenNFTUpgradeMock();

        vm.prank(owner);
        nft.upgradeToAndCall(address(nextImplementation), "");
        VillageCitizenNFTUpgradeMock upgraded = VillageCitizenNFTUpgradeMock(address(nft));
        assertEq(upgraded.version(), "village-citizen-nft-upgrade-mock");
        assertEq(upgraded.ownerOf(1), citizen);
        assertEq(upgraded.tokenIdOf(citizen), 1);
        assertEq(upgraded.tokenByIndex(0), 1);
        assertEq(upgraded.totalCitizens(), 1);
        assertEq(upgraded.baseURI(), "https://citizen.example/");
        VillageCitizenNFT.CitizenshipInfo memory info = upgraded.citizenshipInfo(citizen);
        assertEq(info.subjectRef, SUBJECT_ONE);

        vm.prank(citizen);
        upgraded.burn(1);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(VillageCitizenNFT.SubjectReferenceAlreadyUsed.selector, SUBJECT_ONE));
        upgraded.issue(otherCitizen, SUBJECT_ONE);
    }

    function testFuzz_IssueAndBurnPreserveSingleCredentialAndEnumerableState(
        address account,
        bytes32 subjectRef
    ) public {
        vm.assume(account != address(0) && account.code.length == 0);
        vm.assume(subjectRef != bytes32(0));
        vm.prank(operator);
        uint256 tokenId = nft.issue(account, subjectRef);
        assertEq(nft.balanceOf(account), 1);
        assertEq(nft.tokenIdOf(account), tokenId);
        assertEq(nft.tokenOfOwnerByIndex(account, 0), tokenId);
        assertEq(nft.tokenByIndex(0), tokenId);

        vm.prank(account);
        nft.burn(tokenId);
        assertEq(nft.balanceOf(account), 0);
        assertEq(nft.tokenIdOf(account), 0);
        assertEq(nft.totalSupply(), 0);
        assertEq(nft.totalCitizens(), 0);
    }

    function _containsTopic(Vm.Log[] memory logs, bytes32 topic) private pure returns (bool) {
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == topic) return true;
        }
        return false;
    }
}
