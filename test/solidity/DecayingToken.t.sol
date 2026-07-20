// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC20NonTransferableDecaying} from "../../src/village/tokens/ERC20NonTransferableDecaying.sol";
import {VillagePresenceToken} from "../../src/village/tokens/VillagePresenceToken.sol";
import {VillageSweatToken} from "../../src/village/tokens/VillageSweatToken.sol";
import {VillageRoles} from "../../src/village/access/VillageRoles.sol";
import {RoleAuthorityHarness, TestBase} from "./TestBase.sol";

contract DecayingTokenTest is TestBase {
    uint256 internal constant RATE = 288_617;

    VillagePresenceToken internal token;
    RoleAuthorityHarness internal authority;
    address internal manager = makeAddr("manager");
    address internal platform = makeAddr("platform");
    address internal holder = makeAddr("holder");
    address internal other = makeAddr("other");
    address internal outsider = makeAddr("outsider");

    function setUp() public {
        vm.warp(10_000 days + 6 hours);
        authority = new RoleAuthorityHarness(address(this));
        authority.grantRole(VillageRoles.BOOKING_MANAGER_ROLE, manager);
        authority.grantRole(VillageRoles.BOOKING_PLATFORM_ROLE, platform);
        token = _deployPresence(address(authority), RATE, address(this));
    }

    function test_RejectsInvalidCustomInitializerInputs() public {
        VillagePresenceToken implementation = new VillagePresenceToken();

        vm.expectRevert(abi.encodeWithSelector(ERC20NonTransferableDecaying.InvalidRoleAuthority.selector, outsider));
        _proxy(
            address(implementation),
            abi.encodeCall(VillagePresenceToken.initialize, ("Presence", "PRES", outsider, RATE, address(this)))
        );

        vm.expectRevert(abi.encodeWithSelector(ERC20NonTransferableDecaying.InvalidOwner.selector, address(0)));
        _proxy(
            address(implementation),
            abi.encodeCall(VillagePresenceToken.initialize, ("Presence", "PRES", address(authority), RATE, address(0)))
        );

        uint256 invalidRate = token.MAX_DECAY_RATE_PER_DAY() + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                ERC20NonTransferableDecaying.InvalidDecayRatePerDay.selector,
                invalidRate,
                token.MAX_DECAY_RATE_PER_DAY()
            )
        );
        _proxy(
            address(implementation),
            abi.encodeCall(
                VillagePresenceToken.initialize,
                ("Presence", "PRES", address(authority), invalidRate, address(this))
            )
        );
    }

    function test_OwnerManagerAndPlatformCanMintWhileUnrelatedAccountsCannot() public {
        token.mint(holder, 1 ether, 0);
        vm.prank(manager);
        token.mint(holder, 2 ether, 0);
        vm.prank(platform);
        token.mint(holder, 3 ether, 0);
        assertEq(token.nonDecayedBalanceOf(holder), 6 ether);

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(
                ERC20NonTransferableDecaying.Unauthorized.selector,
                outsider,
                VillageRoles.BOOKING_MANAGER_ROLE
            )
        );
        token.mint(holder, 1, 0);
    }

    function test_MintBatchUpdatesCustomAccountingAndIsAtomic() public {
        ERC20NonTransferableDecaying.MintData[] memory empty = new ERC20NonTransferableDecaying.MintData[](0);
        vm.expectRevert(ERC20NonTransferableDecaying.MintDataEmpty.selector);
        token.mintBatch(empty);

        ERC20NonTransferableDecaying.MintData[] memory entries = new ERC20NonTransferableDecaying.MintData[](2);
        entries[0] = ERC20NonTransferableDecaying.MintData(holder, 2 ether, 3);
        entries[1] = ERC20NonTransferableDecaying.MintData(other, 0, 0);
        vm.expectRevert(ERC20NonTransferableDecaying.MintWithZeroAmount.selector);
        token.mintBatch(entries);

        assertEq(token.nonDecayedBalanceOf(holder), 0);
        assertFalse(token.isHolder(holder));

        entries[1] = ERC20NonTransferableDecaying.MintData(other, 3 ether, 2);
        token.mintBatch(entries);
        assertEq(token.nonDecayedBalanceOf(holder), 2 ether);
        assertEq(token.nonDecayedBalanceOf(other), 3 ether);
        assertEq(token.balanceOf(holder), token.calculateDecayForDays(2 ether, 3));
        assertEq(token.balanceOf(other), token.calculateDecayForDays(3 ether, 2));
        assertTrue(token.isHolder(holder));
        assertTrue(token.isHolder(other));
        assertEq(token.nonDecayedTotalSupply(), 5 ether);
    }

    function test_HistoricalMintAndPartialBurnUseTheProvidedAges() public {
        uint256 amount = 100 ether;
        uint256 decayedMintedAmount = token.calculateDecayForDays(amount, 10);
        vm.expectEmit(true, false, false, true, address(token));
        emit ERC20NonTransferableDecaying.MintWithDecay(holder, amount, decayedMintedAmount, 10);
        token.mint(holder, amount, 10);
        assertEq(token.balanceOf(holder), decayedMintedAmount);

        uint256 balanceBeforeBurn = token.balanceOf(holder);
        ERC20NonTransferableDecaying.BurnData[] memory entries = new ERC20NonTransferableDecaying.BurnData[](1);
        entries[0] = ERC20NonTransferableDecaying.BurnData(10, 25 ether);
        uint256 decayedBurnedAmount = token.calculateDecayForDays(25 ether, 10);
        vm.expectEmit(true, false, false, true, address(token));
        emit ERC20NonTransferableDecaying.BurnWithDecay(holder, 25 ether, decayedBurnedAmount, 10);
        uint256 finalBalance = token.burn(holder, entries);

        assertEq(token.nonDecayedBalanceOf(holder), 75 ether);
        assertEq(finalBalance, balanceBeforeBurn - decayedBurnedAmount);
        assertEq(token.balanceOf(holder), finalBalance);
    }

    function test_CheckpointPreservesFractionalDayProgressAcrossMints() public {
        token.mint(holder, 100 ether, 0);
        uint256 originalCheckpoint = token.decayCheckpointTimestamp(holder);

        vm.warp(block.timestamp + 1 days + 12 hours);
        uint256 afterOneDay = token.calculateDecayForDays(100 ether, 1);
        token.mint(holder, 10 ether, 0);

        assertEq(token.decayCheckpointTimestamp(holder), originalCheckpoint + 1 days);
        assertEq(token.decayCheckpointBalance(holder), afterOneDay + 10 ether);

        vm.warp(block.timestamp + 12 hours);
        assertEq(token.balanceOf(holder), token.calculateDecayForDays(afterOneDay + 10 ether, 1));
    }

    function test_CheckpointPreservesFractionalDayProgressAcrossBurns() public {
        token.mint(holder, 100 ether, 0);
        uint256 originalCheckpoint = token.decayCheckpointTimestamp(holder);

        vm.warp(block.timestamp + 1 days + 12 hours);
        uint256 afterOneDay = token.calculateDecayForDays(100 ether, 1);
        ERC20NonTransferableDecaying.BurnData[] memory entries = new ERC20NonTransferableDecaying.BurnData[](1);
        entries[0] = ERC20NonTransferableDecaying.BurnData(0, 10 ether);
        uint256 finalBalance = token.burn(holder, entries);

        assertEq(token.decayCheckpointTimestamp(holder), originalCheckpoint + 1 days);
        assertEq(finalBalance, afterOneDay - 10 ether);
        assertEq(token.decayCheckpointBalance(holder), finalBalance);

        vm.warp(block.timestamp + 12 hours);
        assertEq(token.balanceOf(holder), token.calculateDecayForDays(finalBalance, 1));
    }

    function test_BurnRejectsEmptyAndMateriallyExcessiveRequests() public {
        ERC20NonTransferableDecaying.BurnData[] memory empty = new ERC20NonTransferableDecaying.BurnData[](0);
        vm.expectRevert(ERC20NonTransferableDecaying.BurnDataEmpty.selector);
        token.burn(holder, empty);

        token.mint(holder, 1 ether, 0);
        ERC20NonTransferableDecaying.BurnData[] memory entries = new ERC20NonTransferableDecaying.BurnData[](1);
        entries[0] = ERC20NonTransferableDecaying.BurnData(0, 2 ether);
        vm.expectPartialRevert(ERC20NonTransferableDecaying.BurnAmountExceedsDecayedBalance.selector);
        token.burn(holder, entries);
    }

    function test_BurnAcceptsOnlyTheDocumentedRoundingTolerance() public {
        uint256 amount = 100_000_000;
        token.mint(holder, amount, 0);
        vm.warp(block.timestamp + 1 days);

        uint256 roundingDifference = amount - token.balanceOf(holder);
        assertGt(roundingDifference, 0);
        assertLe(roundingDifference, token.MAX_ALLOWED_ROUNDING_ERROR());

        ERC20NonTransferableDecaying.BurnData[] memory entries = new ERC20NonTransferableDecaying.BurnData[](1);
        entries[0] = ERC20NonTransferableDecaying.BurnData(0, amount);
        assertEq(token.burn(holder, entries), 0);
        assertEq(token.nonDecayedBalanceOf(holder), 0);
        assertEq(token.decayCheckpointBalance(holder), 0);
        assertEq(token.decayCheckpointTimestamp(holder), 0);
    }

    function test_BurnAllClearsRawAndCheckpointedBalances() public {
        token.mint(holder, 5 ether, 2);
        vm.expectEmit(true, false, false, true, address(token));
        emit ERC20NonTransferableDecaying.BurnAllUserTokens(holder);
        token.burnAll(holder);

        assertEq(token.nonDecayedBalanceOf(holder), 0);
        assertEq(token.balanceOf(holder), 0);
        assertEq(token.decayCheckpointBalance(holder), 0);
        assertEq(token.decayCheckpointTimestamp(holder), 0);
    }

    function test_TransferAndApprovalEntryPointsAreNonTransferable() public {
        token.mint(holder, 3 ether, 0);

        vm.prank(holder);
        vm.expectRevert(ERC20NonTransferableDecaying.TransferNotAllowed.selector);
        token.transfer(other, 1);

        vm.expectRevert(ERC20NonTransferableDecaying.TransferNotAllowed.selector);
        token.transferFrom(holder, other, 1);

        vm.prank(holder);
        vm.expectRevert(ERC20NonTransferableDecaying.ApproveNotAllowed.selector);
        token.approve(other, 1);
    }

    function test_HolderRegistryDeduplicatesAndTotalSupplySumsReadableBalances() public {
        assertEq(token.totalSupply(), 0);
        token.mint(holder, 5 ether, 0);
        token.mint(holder, 2 ether, 0);
        token.mint(other, 3 ether, 2);

        assertEq(token.holders(0), holder);
        assertEq(token.holders(1), other);
        vm.expectRevert();
        token.holders(2);
        assertEq(token.nonDecayedTotalSupply(), 10 ether);
        assertEq(token.totalSupply(), token.balanceOf(holder) + token.balanceOf(other));
    }

    function test_SetDecayRateBeforeMintingControlsSubsequentDecay() public {
        token.setDecayRatePerDay(0);
        token.mint(holder, 7 ether, 30);
        assertEq(token.balanceOf(holder), 7 ether);

        vm.prank(outsider);
        vm.expectRevert();
        token.setDecayRatePerDay(RATE);
    }

    function test_ReplacingAuthorityChangesManagerPermissions() public {
        RoleAuthorityHarness replacement = new RoleAuthorityHarness(address(this));
        replacement.grantRole(VillageRoles.BOOKING_MANAGER_ROLE, other);
        token.setRoleAuthority(address(replacement));

        vm.prank(manager);
        vm.expectRevert();
        token.mint(holder, 1, 0);

        vm.prank(other);
        token.mint(holder, 1, 0);
        assertEq(token.balanceOf(holder), 1);
    }

    function test_SweatWrapperUsesItsOwnInitializerMetadata() public {
        VillageSweatToken implementation = new VillageSweatToken();
        VillageSweatToken sweat = VillageSweatToken(
            _proxy(
                address(implementation),
                abi.encodeCall(VillageSweatToken.initialize, ("Sweat", "SWT", address(authority), RATE, address(this)))
            )
        );
        assertEq(sweat.name(), "Sweat");
        assertEq(sweat.symbol(), "SWT");
        assertEq(sweat.decayRatePerDay(), RATE);
    }

    function testFuzz_AnnualDailyConversionRoundTripsWithinOneUnit(uint256 dailyRate) public view {
        dailyRate = bound(dailyRate, 0, token.MAX_DECAY_RATE_PER_DAY());
        uint256 annual = token.getDecayRatePerYear(dailyRate);
        uint256 roundTrip = token.getDecayRatePerDay(annual);
        uint256 difference = dailyRate > roundTrip ? dailyRate - roundTrip : roundTrip - dailyRate;
        assertLe(difference, 1);
    }

    function _deployPresence(
        address roleAuthority,
        uint256 rate,
        address owner
    ) private returns (VillagePresenceToken) {
        VillagePresenceToken implementation = new VillagePresenceToken();
        return
            VillagePresenceToken(
                _proxy(
                    address(implementation),
                    abi.encodeCall(VillagePresenceToken.initialize, ("Presence", "PRES", roleAuthority, rate, owner))
                )
            );
    }
}

contract DecayingTokenHandler is TestBase {
    VillagePresenceToken public immutable token;
    address[3] public actors;
    bool[3] public wasMinted;

    constructor(VillagePresenceToken token_) {
        token = token_;
        actors[0] = makeAddr("invariant-holder-0");
        actors[1] = makeAddr("invariant-holder-1");
        actors[2] = makeAddr("invariant-holder-2");
    }

    function mint(uint8 actorIndex, uint96 amount, uint16 daysAgo) external {
        uint256 index = uint256(actorIndex) % actors.length;
        uint256 boundedAmount = bound(uint256(amount), 1, 1e24);
        uint256 boundedDaysAgo = bound(uint256(daysAgo), 0, 365);
        token.mint(actors[index], boundedAmount, boundedDaysAgo);
        wasMinted[index] = true;
    }

    function burn(uint8 actorIndex, uint96 rawAmount, uint96 rawSplit, bool useTwoBuckets) external {
        uint256 index = uint256(actorIndex) % actors.length;
        address actor = actors[index];
        uint256 readable = token.balanceOf(actor);
        uint256 raw = token.nonDecayedBalanceOf(actor);
        uint256 maximum = readable < raw ? readable : raw;
        if (maximum == 0) return;

        uint256 amount = bound(uint256(rawAmount), 1, maximum);
        uint256 entriesLength = useTwoBuckets && amount > 1 ? 2 : 1;
        ERC20NonTransferableDecaying.BurnData[] memory entries = new ERC20NonTransferableDecaying.BurnData[](
            entriesLength
        );
        if (entriesLength == 1) {
            entries[0] = ERC20NonTransferableDecaying.BurnData(0, amount);
        } else {
            uint256 firstAmount = bound(uint256(rawSplit), 1, amount - 1);
            entries[0] = ERC20NonTransferableDecaying.BurnData(0, firstAmount);
            entries[1] = ERC20NonTransferableDecaying.BurnData(0, amount - firstAmount);
        }
        token.burn(actor, entries);
    }

    function setDecayRate(uint64 rawRate) external {
        uint256 rate = bound(uint256(rawRate), 0, token.MAX_DECAY_RATE_PER_DAY());
        vm.prank(token.owner());
        token.setDecayRatePerDay(rate);
    }

    function advanceTime(uint32 elapsed) external {
        vm.warp(block.timestamp + bound(uint256(elapsed), 0, 3 days));
    }
}

contract DecayingTokenInvariantTest is TestBase {
    VillagePresenceToken internal token;
    DecayingTokenHandler internal handler;

    function setUp() public {
        vm.warp(20_000 days);
        RoleAuthorityHarness authority = new RoleAuthorityHarness(address(this));
        VillagePresenceToken implementation = new VillagePresenceToken();
        token = VillagePresenceToken(
            _proxy(
                address(implementation),
                abi.encodeCall(
                    VillagePresenceToken.initialize,
                    ("Presence", "PRES", address(authority), 288_617, address(this))
                )
            )
        );
        handler = new DecayingTokenHandler(token);
        authority.grantRole(VillageRoles.BOOKING_PLATFORM_ROLE, address(handler));
        targetContract(address(handler));
    }

    function invariant_SuppliesAndBalancesRemainConsistent() public view {
        uint256 rawSupply;
        uint256 readableSupply;
        for (uint256 i = 0; i < 3; ++i) {
            address actor = handler.actors(i);
            uint256 raw = token.nonDecayedBalanceOf(actor);
            uint256 readable = token.balanceOf(actor);
            assertLe(readable, raw);
            rawSupply += raw;
            readableSupply += readable;

            if (handler.wasMinted(i)) {
                assertTrue(token.isHolder(actor));
            }
            if (raw == 0) {
                assertEq(readable, 0);
                assertEq(token.decayCheckpointBalance(actor), 0);
                assertEq(token.decayCheckpointTimestamp(actor), 0);
            }
            if (readable > 0) {
                assertGt(token.decayCheckpointBalance(actor), 0);
                assertGt(token.decayCheckpointTimestamp(actor), 0);
            }
        }
        assertEq(token.nonDecayedTotalSupply(), rawSupply);
        assertEq(token.totalSupply(), readableSupply);
    }
}
