// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {VillageCitizenNFT} from "../../src/village/citizenship/VillageCitizenNFT.sol";
import {VillageRoles} from "../../src/village/access/VillageRoles.sol";
import {TestBase, RoleAuthorityHarness} from "./TestBase.sol";

contract VillageCitizenNFTHandler is TestBase {
    VillageCitizenNFT public immutable nft;
    address[4] public actors;
    uint256[] public issuedTokenIds;
    bytes32[] public issuedSubjectRefs;
    uint256 private nonce;

    constructor(VillageCitizenNFT nft_) {
        nft = nft_;
        actors[0] = makeAddr("citizen-invariant-0");
        actors[1] = makeAddr("citizen-invariant-1");
        actors[2] = makeAddr("citizen-invariant-2");
        actors[3] = makeAddr("citizen-invariant-3");
    }

    function issue(uint8 rawActor) external {
        address actor = actors[uint256(rawActor) % actors.length];
        if (nft.hasCitizenship(actor)) return;
        bytes32 subjectRef = _freshSubjectRef();
        uint256 tokenId = nft.issue(actor, subjectRef);
        issuedTokenIds.push(tokenId);
        issuedSubjectRefs.push(subjectRef);
    }

    function operatorBurn(uint8 rawActor, bool revoked) external {
        address actor = actors[uint256(rawActor) % actors.length];
        uint256 tokenId = nft.tokenIdOf(actor);
        if (tokenId == 0) return;
        nft.operatorBurn(
            tokenId,
            revoked ? VillageCitizenNFT.BurnReason.Revocation : VillageCitizenNFT.BurnReason.Suspension
        );
    }

    function recover(uint8 rawOldActor, uint8 rawNewActor) external {
        uint256 oldIndex = uint256(rawOldActor) % actors.length;
        uint256 newIndex = uint256(rawNewActor) % actors.length;
        if (oldIndex == newIndex) return;
        uint256 oldTokenId = nft.tokenIdOf(actors[oldIndex]);
        if (oldTokenId == 0 || nft.hasCitizenship(actors[newIndex])) return;
        bytes32 subjectRef = _freshSubjectRef();
        uint256 tokenId = nft.recover(oldTokenId, actors[newIndex], subjectRef);
        issuedTokenIds.push(tokenId);
        issuedSubjectRefs.push(subjectRef);
    }

    function issuedCount() external view returns (uint256) {
        return issuedTokenIds.length;
    }

    function _freshSubjectRef() private returns (bytes32) {
        ++nonce;
        return keccak256(abi.encode("village-citizen-invariant", nonce));
    }
}

contract VillageCitizenNFTInvariantTest is TestBase {
    VillageCitizenNFT internal nft;
    VillageCitizenNFTHandler internal handler;

    function setUp() public {
        RoleAuthorityHarness authority = new RoleAuthorityHarness(address(this));
        VillageCitizenNFT implementation = new VillageCitizenNFT();
        nft = VillageCitizenNFT(
            _proxy(
                address(implementation),
                abi.encodeCall(
                    VillageCitizenNFT.initialize,
                    ("Invariant Citizen", "ICIT", "https://citizen.example/", address(authority), address(this))
                )
            )
        );
        handler = new VillageCitizenNFTHandler(nft);
        authority.grantRole(VillageRoles.CITIZEN_OPERATOR_ROLE, address(handler));
        targetContract(address(handler));
    }

    function invariant_EnumerableAndDomainIndexesExactlyMatchLiveOwnership() public view {
        uint256 expectedLive;
        for (uint256 i = 0; i < 4; ++i) {
            address actor = handler.actors(i);
            uint256 tokenId = nft.tokenIdOf(actor);
            assertLe(nft.balanceOf(actor), 1);
            assertEq(nft.hasCitizenship(actor), tokenId != 0);
            if (tokenId == 0) {
                assertEq(nft.balanceOf(actor), 0);
                VillageCitizenNFT.CitizenshipInfo memory empty = nft.citizenshipInfo(actor);
                assertEq(empty.tokenId, 0);
            } else {
                ++expectedLive;
                assertEq(nft.balanceOf(actor), 1);
                assertEq(nft.ownerOf(tokenId), actor);
                assertEq(nft.tokenOfOwnerByIndex(actor, 0), tokenId);
                VillageCitizenNFT.CitizenshipInfo memory info = nft.citizenshipInfo(actor);
                assertEq(info.tokenId, tokenId);
                assertNotEq(info.subjectRef, bytes32(0));
                assertGt(info.issuedAt, 0);
            }
        }

        assertEq(nft.totalCitizens(), expectedLive);
        assertEq(nft.totalSupply(), expectedLive);
        for (uint256 i = 0; i < nft.totalSupply(); ++i) {
            uint256 tokenId = nft.tokenByIndex(i);
            address tokenOwner = nft.ownerOf(tokenId);
            assertEq(nft.tokenIdOf(tokenOwner), tokenId);
            for (uint256 j = i + 1; j < nft.totalSupply(); ++j) {
                assertNotEq(tokenId, nft.tokenByIndex(j));
            }
        }
    }

    function invariant_TokenIdsAndSubjectReferencesAreNeverReused() public view {
        uint256 count = handler.issuedCount();
        for (uint256 i = 0; i < count; ++i) {
            uint256 tokenId = handler.issuedTokenIds(i);
            bytes32 subjectRef = handler.issuedSubjectRefs(i);
            assertNotEq(subjectRef, bytes32(0));
            if (i > 0) assertGt(tokenId, handler.issuedTokenIds(i - 1));
            for (uint256 j = i + 1; j < count; ++j) {
                assertNotEq(tokenId, handler.issuedTokenIds(j));
                assertNotEq(subjectRef, handler.issuedSubjectRefs(j));
            }
        }
    }
}
