// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IBondingCurve} from "../../src/village/interfaces/IBondingCurve.sol";
import {TDFV1BondingCurve} from "../../src/profiles/tdf/TDFV1BondingCurve.sol";
import {TestBase} from "./TestBase.sol";

contract TDFV1BondingCurveTest is TestBase {
    TDFV1BondingCurve internal curve;

    function setUp() public {
        curve = new TDFV1BondingCurve();
    }

    function test_AdvertisesBondingCurveInterfaceAndQuoteDecimals() public view {
        assertTrue(curve.supportsInterface(type(IERC165).interfaceId));
        assertTrue(curve.supportsInterface(type(IBondingCurve).interfaceId));
        assertFalse(curve.supportsInterface(0xffffffff));
        assertEq(curve.quoteTokenDecimals(), 18);
    }

    function test_ReproducesEveryHistoricalV1QuoteVector() public view {
        _assertQuote(5_381 ether, 19 ether, 4_224.39 ether, 223 ether);
        _assertQuote(5_400 ether, 100 ether, 22_444.71 ether, 226 ether);
        _assertQuote(5_500 ether, 100 ether, 22_799.54 ether, 230 ether);
        _assertQuote(5_600 ether, 51 ether, 11_764.14 ether, 232 ether);
        _assertQuote(5_651 ether, 9 ether, 2_085.56 ether, 232 ether);
        _assertQuote(5_660 ether, 40 ether, 9_303.74 ether, 233 ether);
        _assertQuote(5_700 ether, 100 ether, 23_505.32 ether, 237 ether);
        _assertQuote(5_800 ether, 100 ether, 23_854.19 ether, 240 ether);
        _assertQuote(5_900 ether, 100 ether, 24_199.29 ether, 244 ether);
        _assertQuote(6_000 ether, 100 ether, 24_539.98 ether, 247 ether);
        _assertQuote(6_100 ether, 100 ether, 24_875.76 ether, 251 ether);
        _assertQuote(6_200 ether, 100 ether, 25_206.20 ether, 253 ether);
        _assertQuote(10_000 ether, 100 ether, 33_588.26 ether, 337 ether);
        _assertQuote(20_000 ether, 100 ether, 39_491.53 ether, 395 ether);
        _assertQuote(30_000 ether, 100 ether, 40_824.45 ether, 409 ether);
        _assertQuote(40_000 ether, 100 ether, 41_321.63 ether, 413 ether);
        _assertQuote(50_000 ether, 100 ether, 41_559.25 ether, 416 ether);
        _assertQuote(60_000 ether, 100 ether, 41_690.87 ether, 417 ether);
        _assertQuote(70_000 ether, 100 ether, 41_771.28 ether, 418 ether);
        _assertQuote(80_000 ether, 100 ether, 41_823.96 ether, 419 ether);
        _assertQuote(90_000 ether, 100 ether, 41_860.34 ether, 419 ether);
        _assertQuote(100_000 ether, 100 ether, 41_886.51 ether, 419 ether);
        _assertQuote(110_000 ether, 100 ether, 41_905.95 ether, 420 ether);
        _assertQuote(120_000 ether, 100 ether, 41_920.80 ether, 420 ether);
        _assertQuote(130_000 ether, 100 ether, 41_932.39 ether, 420 ether);
        _assertQuote(140_000 ether, 100 ether, 41_941.61 ether, 420 ether);
        _assertQuote(150_000 ether, 100 ether, 41_949.07 ether, 420 ether);
        _assertQuote(160_000 ether, 100 ether, 41_955.18 ether, 420 ether);
        _assertQuote(170_000 ether, 100 ether, 41_960.25 ether, 420 ether);
        _assertQuote(180_000 ether, 100 ether, 41_964.51 ether, 420 ether);
        _assertQuote(190_000 ether, 100 ether, 41_968.12 ether, 420 ether);
    }

    function test_EnforcesCurveDomainAndNormalizesSpotPrice() public {
        uint256 minimumSupply = curve.MIN_CURVE_SUPPLY();
        uint256 maximumSupply = curve.MAX_CURVE_SUPPLY();
        assertEq(curve.currentPrice(5_381 ether), 222 ether);
        curve.currentPrice(minimumSupply);
        curve.currentPrice(maximumSupply);

        vm.expectRevert(abi.encodeWithSelector(TDFV1BondingCurve.InvalidPurchaseAmount.selector, 0));
        curve.quotePurchase(minimumSupply, 0);

        vm.expectRevert(
            abi.encodeWithSelector(TDFV1BondingCurve.SupplyBelowCurveMinimum.selector, minimumSupply - 1, minimumSupply)
        );
        curve.quotePurchase(minimumSupply - 1, 1);

        vm.expectRevert(
            abi.encodeWithSelector(TDFV1BondingCurve.SupplyBelowCurveMinimum.selector, minimumSupply - 1, minimumSupply)
        );
        curve.currentPrice(minimumSupply - 1);

        vm.expectRevert(
            abi.encodeWithSelector(TDFV1BondingCurve.SupplyAboveCurveMaximum.selector, maximumSupply + 1, maximumSupply)
        );
        curve.currentPrice(maximumSupply + 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                TDFV1BondingCurve.SupplyAboveCurveMaximum.selector,
                maximumSupply + 1 ether,
                maximumSupply
            )
        );
        curve.quotePurchase(maximumSupply, 1 ether);

        vm.expectRevert(
            abi.encodeWithSelector(TDFV1BondingCurve.SupplyAboveCurveMaximum.selector, type(uint256).max, maximumSupply)
        );
        curve.quotePurchase(minimumSupply, type(uint256).max);

        vm.expectRevert(
            abi.encodeWithSelector(TDFV1BondingCurve.SupplyAboveCurveMaximum.selector, maximumSupply + 1, maximumSupply)
        );
        curve.quotePurchase(maximumSupply + 1, 1);

        // The V1 evaluation order overflows for some larger buys at the lowest nominal supply.
        // Preserving that revert boundary is part of exact V1 compatibility.
        vm.expectRevert();
        curve.quotePurchase(minimumSupply, 91 ether);
    }

    function test_TdfOperatingFloorSupportsEveryConfiguredWholeTokenPurchase() public view {
        // 5,381 TDF is deliberately an operating floor outside the curve contract, whose V1 math remains unchanged.
        for (uint256 amount = 1 ether; amount <= 100 ether; amount += 1 ether) {
            curve.quotePurchase(5_381 ether, amount);
        }
    }

    function testFuzz_ValidQuotesAreCentRounded(uint96 rawSupply, uint8 rawAmount) public view {
        uint256 currentSupply = bound(uint256(rawSupply), 5_381 ether, curve.MAX_CURVE_SUPPLY() - 100 ether);
        uint256 amount = bound(uint256(rawAmount), 1, 100) * 1 ether;
        if (currentSupply + amount > curve.MAX_CURVE_SUPPLY()) return;
        (uint256 payment, uint256 postPrice) = curve.quotePurchase(currentSupply, amount);
        assertEq(payment % 1e16, 0);
        assertEq(postPrice % 1 ether, 0);
    }

    function _assertQuote(
        uint256 currentSupply,
        uint256 amount,
        uint256 expectedPayment,
        uint256 expectedPostPrice
    ) private view {
        (uint256 payment, uint256 postPrice) = curve.quotePurchase(currentSupply, amount);
        assertEq(payment, expectedPayment);
        assertEq(postPrice, expectedPostPrice);
    }
}
