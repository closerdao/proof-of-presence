// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {CommunityToken} from "../../src/village/tokens/CommunityToken.sol";
import {DynamicPriceSale} from "../../src/village/sales/DynamicPriceSale.sol";
import {
    BondingCurveMock,
    QuoteTokenMock,
    ReentrantQuoteTokenMock,
    SupplyTrackingBondingCurveMock,
    WrongBondingCurveInterface,
    ZeroTransferRevertingQuoteTokenMock
} from "../../src/village/test/DynamicPriceSaleMocks.sol";
import {VillageRoles} from "../../src/village/access/VillageRoles.sol";
import {RoleAuthorityHarness, TestBase} from "./TestBase.sol";

contract DynamicPriceSaleTest is TestBase {
    CommunityToken internal communityToken;
    QuoteTokenMock internal quoteToken;
    BondingCurveMock internal curve;
    DynamicPriceSale internal sale;
    RoleAuthorityHarness internal authority;

    address internal payer = makeAddr("payer");
    address internal recipient = makeAddr("recipient");
    address internal villageTreasury = makeAddr("villageTreasury");
    address internal closerFeeRecipient = makeAddr("closerFeeRecipient");
    address internal outsider = makeAddr("outsider");

    function setUp() public {
        authority = new RoleAuthorityHarness(address(this));
        communityToken = _deployCommunityToken(100 ether, 1_000 ether);
        quoteToken = new QuoteTokenMock(18);
        curve = new BondingCurveMock(18, 100 ether);
        sale = _deploySale(address(curve), 900 ether, 500);
        authority.grantRole(VillageRoles.MINTER_ROLE, address(sale));
        quoteToken.mint(payer, 100_000 ether);
        vm.prank(payer);
        quoteToken.approve(address(sale), type(uint256).max);
    }

    function test_ReturnsCompactConfigurationAndLiveStatus() public view {
        DynamicPriceSale.SaleConfiguration memory configuration = sale.saleConfiguration();
        assertEq(configuration.communityToken, address(communityToken));
        assertEq(configuration.quoteToken, address(quoteToken));
        assertEq(configuration.bondingCurve, address(curve));
        assertEq(configuration.villageTreasury, villageTreasury);
        assertEq(configuration.closerFeeRecipient, closerFeeRecipient);
        assertEq(configuration.saleCap, 900 ether);
        assertEq(configuration.minimumPurchase, 1 ether);
        assertEq(configuration.maximumPurchase, 100 ether);
        assertEq(configuration.purchaseGranularity, 1 ether);
        assertEq(configuration.maximumRecipientBalance, 915 ether);
        assertEq(configuration.closerFeeBps, 500);

        DynamicPriceSale.SaleStatus memory status = sale.saleStatus();
        assertEq(status.currentSupply, 100 ether);
        assertEq(status.tokenMaxSupply, 1_000 ether);
        assertEq(status.effectiveSupplyCap, 900 ether);
        assertEq(status.remainingSaleCapacity, 800 ether);
        assertEq(sale.currentPrice(), 100 ether);
    }

    function test_BuySplitsInclusiveFeeAndMintsToRecipient() public {
        (uint256 payment, uint256 fee, uint256 proceeds, uint256 postPrice, uint256 supply) = sale.quotePurchase(
            1 ether
        );
        assertEq(payment, 100 ether);
        assertEq(fee, 5 ether);
        assertEq(proceeds, 95 ether);
        assertEq(postPrice, 100 ether);
        assertEq(supply, 100 ether);

        vm.prank(payer);
        sale.buy(1 ether, recipient, payment, block.timestamp);

        assertEq(communityToken.balanceOf(recipient), 1 ether);
        assertEq(quoteToken.balanceOf(closerFeeRecipient), 5 ether);
        assertEq(quoteToken.balanceOf(villageTreasury), 95 ether);
        assertEq(quoteToken.balanceOf(payer), 99_900 ether);
    }

    function test_FeeBoundariesAtZeroAndOneHundredPercent() public {
        sale.setCloserFeeConfiguration(0, closerFeeRecipient);
        vm.prank(payer);
        sale.buy(1 ether, recipient, 100 ether, block.timestamp);
        assertEq(quoteToken.balanceOf(closerFeeRecipient), 0);
        assertEq(quoteToken.balanceOf(villageTreasury), 100 ether);

        sale.setCloserFeeConfiguration(10_000, closerFeeRecipient);
        vm.prank(payer);
        sale.buy(1 ether, recipient, 100 ether, block.timestamp);
        assertEq(quoteToken.balanceOf(closerFeeRecipient), 100 ether);
        assertEq(quoteToken.balanceOf(villageTreasury), 100 ether);
    }

    function test_ZeroFeeSkipsTheZeroValueTransfer() public {
        ZeroTransferRevertingQuoteTokenMock zeroTransferRevertingQuoteToken = new ZeroTransferRevertingQuoteTokenMock();
        DynamicPriceSale.SaleConfiguration memory configuration = _configuration(address(curve), 900 ether, 0);
        configuration.quoteToken = address(zeroTransferRevertingQuoteToken);
        DynamicPriceSale zeroFeeSale = _deploySaleWithConfiguration(configuration);
        authority.grantRole(VillageRoles.MINTER_ROLE, address(zeroFeeSale));
        zeroTransferRevertingQuoteToken.mint(payer, 100 ether);
        vm.prank(payer);
        zeroTransferRevertingQuoteToken.approve(address(zeroFeeSale), 100 ether);

        vm.prank(payer);
        zeroFeeSale.buy(1 ether, recipient, 100 ether, block.timestamp);

        assertEq(zeroTransferRevertingQuoteToken.balanceOf(closerFeeRecipient), 0);
        assertEq(zeroTransferRevertingQuoteToken.balanceOf(villageTreasury), 100 ether);
        assertEq(communityToken.balanceOf(recipient), 1 ether);
    }

    function test_FeeRoundsDownAndProceedsReceiveTheRemainder() public {
        curve.setPrice(101);
        sale.setCloserFeeConfiguration(500, closerFeeRecipient);
        (uint256 payment, uint256 fee, uint256 proceeds, , ) = sale.quotePurchase(1 ether);
        assertEq(payment, 101);
        assertEq(fee, 5);
        assertEq(proceeds, 96);
    }

    function test_ProtectedBuyRejectsExpiryAndPriceMovement() public {
        vm.warp(100);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(DynamicPriceSale.InvalidRecipient.selector, address(0)));
        sale.buy(1 ether, address(0), type(uint256).max, 100);

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(DynamicPriceSale.PurchaseExpired.selector, 99, 100));
        sale.buy(1 ether, recipient, type(uint256).max, 99);

        curve.setPrice(101 ether);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(DynamicPriceSale.MaximumPaymentExceeded.selector, 101 ether, 100 ether));
        sale.buy(1 ether, recipient, 100 ether, 100);
    }

    function test_OwnerUpdatesTreasuryAndFeeConfiguration() public {
        address newTreasury = makeAddr("newTreasury");
        address newCloserFeeRecipient = makeAddr("newCloserFeeRecipient");
        sale.setVillageTreasury(newTreasury);
        sale.setCloserFeeConfiguration(750, newCloserFeeRecipient);
        DynamicPriceSale.SaleConfiguration memory configuration = sale.saleConfiguration();
        assertEq(configuration.villageTreasury, newTreasury);
        assertEq(configuration.closerFeeBps, 750);
        assertEq(configuration.closerFeeRecipient, newCloserFeeRecipient);

        vm.expectRevert(abi.encodeWithSelector(DynamicPriceSale.InvalidVillageTreasury.selector, address(0)));
        sale.setVillageTreasury(address(0));
        vm.expectRevert(abi.encodeWithSelector(DynamicPriceSale.InvalidCloserFeeBps.selector, 10_001));
        sale.setCloserFeeConfiguration(10_001, newCloserFeeRecipient);
        vm.expectRevert(abi.encodeWithSelector(DynamicPriceSale.InvalidCloserFeeRecipient.selector, address(0)));
        sale.setCloserFeeConfiguration(750, address(0));
    }

    function test_RejectsAmountWalletAndCapacityViolations() public {
        vm.expectRevert();
        sale.quotePurchase(0);
        vm.expectRevert();
        sale.quotePurchase(101 ether);
        vm.expectRevert();
        sale.quotePurchase(1 ether + 1);

        communityToken.setMaxSupply(2_000 ether);
        DynamicPriceSale walletSale = _deploySale(address(curve), 1_800 ether, 500);
        authority.grantRole(VillageRoles.MINTER_ROLE, address(walletSale));
        authority.grantRole(VillageRoles.MINTER_ROLE, address(this));
        communityToken.mint(recipient, 915 ether);
        vm.prank(payer);
        quoteToken.approve(address(walletSale), type(uint256).max);
        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(
                DynamicPriceSale.RecipientBalanceLimitExceeded.selector,
                recipient,
                915 ether,
                1 ether,
                915 ether
            )
        );
        walletSale.buy(1 ether, recipient, type(uint256).max, block.timestamp);

        DynamicPriceSale.SaleStatus memory status = sale.saleStatus();
        assertEq(status.remainingSaleCapacity, 0);
        vm.expectRevert(
            abi.encodeWithSelector(DynamicPriceSale.SaleSupplyCapExceeded.selector, 1_015 ether, 1 ether, 900 ether)
        );
        sale.quotePurchase(1 ether);
    }

    function test_RuntimeTokenCapCanBecomeTheTighterSaleLimit() public {
        communityToken.setMaxSupply(110 ether);
        DynamicPriceSale.SaleStatus memory status = sale.saleStatus();
        assertEq(status.effectiveSupplyCap, 110 ether);
        assertEq(status.remainingSaleCapacity, 10 ether);

        vm.expectRevert(
            abi.encodeWithSelector(DynamicPriceSale.SaleSupplyCapExceeded.selector, 100 ether, 11 ether, 110 ether)
        );
        sale.quotePurchase(11 ether);

        communityToken.setMaxSupply(1_000 ether);
        status = sale.saleStatus();
        assertEq(status.effectiveSupplyCap, 900 ether);
    }

    function test_ExternalMintsAndBurnsImmediatelyMoveSupplyBasedPricing() public {
        SupplyTrackingBondingCurveMock supplyTrackingCurve = new SupplyTrackingBondingCurveMock();
        sale.setBondingCurve(address(supplyTrackingCurve));
        assertEq(sale.currentPrice(), 100 ether);

        authority.grantRole(VillageRoles.MINTER_ROLE, address(this));
        communityToken.mint(outsider, 10 ether);
        assertEq(sale.currentPrice(), 110 ether);
        assertEq(sale.saleStatus().currentSupply, 110 ether);

        vm.prank(outsider);
        communityToken.burn(4 ether);
        assertEq(sale.currentPrice(), 106 ether);
        assertEq(sale.saleStatus().currentSupply, 106 ether);
    }

    function test_ReentrantQuoteTokenCannotEnterBuy() public {
        ReentrantQuoteTokenMock reentrantQuoteToken = new ReentrantQuoteTokenMock();
        DynamicPriceSale.SaleConfiguration memory configuration = _configuration(address(curve), 900 ether, 500);
        configuration.quoteToken = address(reentrantQuoteToken);
        DynamicPriceSale reentrantSale = _deploySaleWithConfiguration(configuration);
        authority.grantRole(VillageRoles.MINTER_ROLE, address(reentrantSale));
        reentrantQuoteToken.mint(payer, 100 ether);
        vm.prank(payer);
        reentrantQuoteToken.approve(address(reentrantSale), type(uint256).max);
        reentrantQuoteToken.configureReentrancy(
            address(reentrantSale),
            abi.encodeCall(DynamicPriceSale.buy, (1 ether, recipient, 100 ether, block.timestamp))
        );

        vm.prank(payer);
        vm.expectRevert(bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        reentrantSale.buy(1 ether, recipient, 100 ether, block.timestamp);

        assertEq(reentrantQuoteToken.balanceOf(payer), 100 ether);
        assertEq(communityToken.balanceOf(recipient), 0);
    }

    function test_AllowanceOrMintFailureRollsBackBothPayments() public {
        vm.prank(payer);
        quoteToken.approve(address(sale), 5 ether);
        vm.prank(payer);
        vm.expectRevert();
        sale.buy(1 ether, recipient, 100 ether, block.timestamp);
        assertEq(quoteToken.balanceOf(closerFeeRecipient), 0);
        assertEq(quoteToken.balanceOf(villageTreasury), 0);

        vm.prank(payer);
        quoteToken.approve(address(sale), type(uint256).max);
        authority.revokeRole(VillageRoles.MINTER_ROLE, address(sale));
        vm.prank(payer);
        vm.expectRevert();
        sale.buy(1 ether, recipient, 100 ether, block.timestamp);
        assertEq(quoteToken.balanceOf(closerFeeRecipient), 0);
        assertEq(quoteToken.balanceOf(villageTreasury), 0);
        assertEq(communityToken.balanceOf(recipient), 0);
    }

    function test_PauseAdministrationAndCurveReplacementAreOwnerOnly() public {
        vm.prank(outsider);
        vm.expectRevert();
        sale.pause();

        sale.pause();
        vm.prank(payer);
        vm.expectRevert();
        sale.buy(1 ether, recipient, 100 ether, block.timestamp);
        sale.unpause();

        BondingCurveMock replacement = new BondingCurveMock(18, 125 ether);
        sale.setBondingCurve(address(replacement));
        assertEq(sale.currentPrice(), 125 ether);

        QuoteTokenMock sixDecimalQuote = new QuoteTokenMock(6);
        BondingCurveMock sixDecimalCurve = new BondingCurveMock(6, 1e6);
        DynamicPriceSale.SaleConfiguration memory configuration = _configuration(
            address(sixDecimalCurve),
            900 ether,
            500
        );
        configuration.quoteToken = address(sixDecimalQuote);
        _deploySaleWithConfiguration(configuration);

        BondingCurveMock wrongDecimals = new BondingCurveMock(6, 1e6);
        vm.expectRevert(abi.encodeWithSelector(DynamicPriceSale.QuoteTokenDecimalsMismatch.selector, 18, 6));
        sale.setBondingCurve(address(wrongDecimals));

        WrongBondingCurveInterface wrongInterface = new WrongBondingCurveInterface();
        vm.expectRevert(abi.encodeWithSelector(DynamicPriceSale.InvalidBondingCurve.selector, address(wrongInterface)));
        sale.setBondingCurve(address(wrongInterface));
    }

    function test_RejectsInvalidInitializationConfiguration() public {
        DynamicPriceSale implementation = new DynamicPriceSale();
        DynamicPriceSale.SaleConfiguration memory configuration = _configuration(address(curve), 900 ether, 500);
        vm.expectRevert(abi.encodeWithSelector(DynamicPriceSale.InvalidOwner.selector, address(0)));
        _proxy(address(implementation), abi.encodeCall(DynamicPriceSale.initialize, (configuration, address(0))));

        configuration = _configuration(address(curve), 900 ether, 500);
        configuration.communityToken = outsider;
        vm.expectRevert(abi.encodeWithSelector(DynamicPriceSale.InvalidCommunityToken.selector, outsider));
        _proxy(address(implementation), abi.encodeCall(DynamicPriceSale.initialize, (configuration, address(this))));

        configuration = _configuration(address(curve), 900 ether, 500);
        configuration.quoteToken = outsider;
        vm.expectRevert(abi.encodeWithSelector(DynamicPriceSale.InvalidQuoteToken.selector, outsider));
        _proxy(address(implementation), abi.encodeCall(DynamicPriceSale.initialize, (configuration, address(this))));

        configuration = _configuration(address(curve), 0, 500);
        vm.expectRevert(abi.encodeWithSelector(DynamicPriceSale.InvalidSaleCap.selector, 0));
        _proxy(address(implementation), abi.encodeCall(DynamicPriceSale.initialize, (configuration, address(this))));

        configuration = _configuration(address(curve), 900 ether, 500);
        configuration.purchaseGranularity = 0;
        vm.expectRevert(
            abi.encodeWithSelector(DynamicPriceSale.InvalidPurchaseLimits.selector, 1 ether, 100 ether, 0, 915 ether)
        );
        _proxy(address(implementation), abi.encodeCall(DynamicPriceSale.initialize, (configuration, address(this))));

        QuoteTokenMock sixDecimalCommunityToken = new QuoteTokenMock(6);
        configuration = _configuration(address(curve), 900 ether, 500);
        configuration.communityToken = address(sixDecimalCommunityToken);
        vm.expectRevert(
            abi.encodeWithSelector(DynamicPriceSale.InvalidCommunityToken.selector, address(sixDecimalCommunityToken))
        );
        _proxy(address(implementation), abi.encodeCall(DynamicPriceSale.initialize, (configuration, address(this))));

        configuration = _configuration(address(curve), 50 ether, 500);
        vm.expectRevert(
            abi.encodeWithSelector(DynamicPriceSale.CurrentSupplyExceedsSaleCap.selector, 100 ether, 50 ether)
        );
        _proxy(address(implementation), abi.encodeCall(DynamicPriceSale.initialize, (configuration, address(this))));

        configuration = _configuration(address(curve), 100 ether, 500);
        vm.expectRevert(
            abi.encodeWithSelector(DynamicPriceSale.InsufficientLaunchCapacity.selector, 100 ether, 1 ether, 100 ether)
        );
        _proxy(address(implementation), abi.encodeCall(DynamicPriceSale.initialize, (configuration, address(this))));

        configuration = _configuration(address(curve), 1_001 ether, 500);
        vm.expectRevert(
            abi.encodeWithSelector(DynamicPriceSale.SaleCapExceedsTokenMaxSupply.selector, 1_001 ether, 1_000 ether)
        );
        _proxy(address(implementation), abi.encodeCall(DynamicPriceSale.initialize, (configuration, address(this))));

        configuration = _configuration(address(curve), 900 ether, 500);
        configuration.villageTreasury = address(0);
        vm.expectRevert(abi.encodeWithSelector(DynamicPriceSale.InvalidVillageTreasury.selector, address(0)));
        _proxy(address(implementation), abi.encodeCall(DynamicPriceSale.initialize, (configuration, address(this))));

        configuration = _configuration(address(curve), 900 ether, 500);
        configuration.closerFeeRecipient = address(0);
        vm.expectRevert(abi.encodeWithSelector(DynamicPriceSale.InvalidCloserFeeRecipient.selector, address(0)));
        _proxy(address(implementation), abi.encodeCall(DynamicPriceSale.initialize, (configuration, address(this))));
    }

    function _deployCommunityToken(uint256 initialSupply, uint256 maxSupply) private returns (CommunityToken) {
        CommunityToken implementation = new CommunityToken();
        return
            CommunityToken(
                _proxy(
                    address(implementation),
                    abi.encodeCall(
                        CommunityToken.initialize,
                        (
                            "Community",
                            "COM",
                            initialSupply,
                            maxSupply,
                            address(this),
                            address(authority),
                            address(0),
                            address(this)
                        )
                    )
                )
            );
    }

    function _deploySale(
        address bondingCurve,
        uint256 saleCap,
        uint16 closerFeeBps
    ) private returns (DynamicPriceSale) {
        return _deploySaleWithConfiguration(_configuration(bondingCurve, saleCap, closerFeeBps));
    }

    function _deploySaleWithConfiguration(
        DynamicPriceSale.SaleConfiguration memory configuration
    ) private returns (DynamicPriceSale) {
        DynamicPriceSale implementation = new DynamicPriceSale();
        return
            DynamicPriceSale(
                _proxy(
                    address(implementation),
                    abi.encodeCall(DynamicPriceSale.initialize, (configuration, address(this)))
                )
            );
    }

    function _configuration(
        address bondingCurve,
        uint256 saleCap,
        uint16 closerFeeBps
    ) private view returns (DynamicPriceSale.SaleConfiguration memory) {
        return
            DynamicPriceSale.SaleConfiguration({
                communityToken: address(communityToken),
                quoteToken: address(quoteToken),
                bondingCurve: bondingCurve,
                villageTreasury: villageTreasury,
                closerFeeRecipient: closerFeeRecipient,
                saleCap: saleCap,
                minimumPurchase: 1 ether,
                maximumPurchase: 100 ether,
                purchaseGranularity: 1 ether,
                maximumRecipientBalance: 915 ether,
                closerFeeBps: closerFeeBps
            });
    }
}
