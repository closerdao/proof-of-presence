// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IBondingCurve} from "../interfaces/IBondingCurve.sol";
import {ICommunityToken} from "../interfaces/ICommunityToken.sol";

/// @title Dynamic price primary sale
/// @author Closer DAO
/// @notice Buy-only CommunityToken issuance priced by a replaceable stateless bonding curve.
/// @dev The curve-calculated payment includes the Closer fee. The caller always funds a purchase, while `recipient`
/// enables caller-funded gifts. Supply pricing intentionally follows CommunityToken.totalSupply(), so external mints
/// and burns move both price and remaining sale capacity. Quote tokens must be ordinary, non-rebasing,
/// non-fee-on-transfer ERC-20 metadata tokens.
/// aderyn-fp-next-line(contract-locks-ether)
contract DynamicPriceSale is
    Initializable,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardTransient,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    /// @notice Denominator and inclusive-fee ceiling, representing 100%.
    uint16 public constant MAX_CLOSER_FEE_BPS = 10_000;
    /// @notice Decimal precision required from the issued CommunityToken.
    uint8 public constant COMMUNITY_TOKEN_DECIMALS = 18;

    /// @notice Complete current sale configuration.
    // solhint-disable-next-line gas-struct-packing
    struct SaleConfiguration {
        address communityToken;
        address quoteToken;
        address bondingCurve;
        address villageTreasury;
        address closerFeeRecipient;
        uint256 saleCap;
        uint256 minimumPurchase;
        uint256 maximumPurchase;
        uint256 purchaseGranularity;
        uint256 maximumRecipientBalance;
        uint16 closerFeeBps;
    }

    /// @notice Live supply state derived from CommunityToken and sale configuration.
    struct SaleStatus {
        uint256 currentSupply;
        uint256 tokenMaxSupply;
        uint256 effectiveSupplyCap;
        uint256 remainingSaleCapacity;
    }

    struct PurchaseQuote {
        uint256 totalPayment;
        uint256 closerFee;
        uint256 villageProceeds;
        uint256 postPurchasePrice;
        uint256 prePurchaseSupply;
    }

    /**
     * @dev Never rename this namespace after a proxy is deployed. Append fields to the struct for future versions.
     * @custom:storage-location erc7201:closer.storage.DynamicPriceSale
     */
    struct DynamicPriceSaleStorage {
        SaleConfiguration configuration;
    }

    // keccak256(abi.encode(uint256(keccak256("closer.storage.DynamicPriceSale")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant DYNAMIC_PRICE_SALE_STORAGE_LOCATION =
        0x47cc57c26ba13bc8fa073a8b68b43a700d83f268495e19bf274532fd17891d00;

    /// @notice Emitted when the village proceeds recipient changes.
    /// @param oldTreasury Previously configured village treasury.
    /// @param newTreasury Newly configured village treasury.
    event VillageTreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    /// @notice Emitted when the inclusive Closer fee percentage or recipient changes.
    /// @param oldCloserFeeBps Previously configured fee in basis points.
    /// @param newCloserFeeBps Newly configured fee in basis points.
    /// @param oldCloserFeeRecipient Previously configured Closer fee recipient.
    /// @param newCloserFeeRecipient Newly configured Closer fee recipient.
    event CloserFeeConfigurationChanged(
        uint16 oldCloserFeeBps,
        uint16 newCloserFeeBps,
        address indexed oldCloserFeeRecipient,
        address indexed newCloserFeeRecipient
    );
    /// @notice Emitted when the active pricing curve changes.
    /// @param oldBondingCurve Previously configured curve.
    /// @param newBondingCurve Newly configured curve.
    event BondingCurveChanged(address indexed oldBondingCurve, address indexed newBondingCurve);
    /// @notice Emitted after payment is split and CommunityToken is minted.
    /// @param payer Caller that funded the purchase.
    /// @param recipient Account that received CommunityToken.
    /// @param bondingCurve Curve used for this purchase.
    /// @param amount CommunityToken amount minted.
    /// @param totalPayment Total quote-token payment inclusive of the Closer fee.
    /// @param closerFee Quote-token amount sent to the Closer fee recipient.
    /// @param villageProceeds Quote-token amount sent to the village treasury.
    /// @param prePurchaseSupply CommunityToken total supply used by the curve.
    /// @param postPurchasePrice Curve spot price following the purchase.
    event TokensPurchased(
        address indexed payer,
        address indexed recipient,
        address indexed bondingCurve,
        uint256 amount,
        uint256 totalPayment,
        uint256 closerFee,
        uint256 villageProceeds,
        uint256 prePurchaseSupply,
        uint256 postPurchasePrice
    );

    error InvalidOwner(address owner);
    error InvalidCommunityToken(address communityToken);
    error InvalidQuoteToken(address quoteToken);
    error InvalidBondingCurve(address bondingCurve);
    error QuoteTokenDecimalsMismatch(uint8 quoteTokenDecimals, uint8 curveQuoteTokenDecimals);
    error InvalidVillageTreasury(address villageTreasury);
    error InvalidCloserFeeRecipient(address closerFeeRecipient);
    error InvalidCloserFeeBps(uint16 closerFeeBps);
    error InvalidSaleCap(uint256 saleCap);
    error SaleCapExceedsTokenMaxSupply(uint256 saleCap, uint256 tokenMaxSupply);
    error CurrentSupplyExceedsSaleCap(uint256 currentSupply, uint256 saleCap);
    error InsufficientLaunchCapacity(uint256 currentSupply, uint256 minimumPurchase, uint256 effectiveSupplyCap);
    error InvalidPurchaseLimits(
        uint256 minimumPurchase,
        uint256 maximumPurchase,
        uint256 purchaseGranularity,
        uint256 maximumRecipientBalance
    );
    error InvalidRecipient(address recipient);
    error PurchaseExpired(uint256 deadline, uint256 currentTimestamp);
    error PurchaseAmountTooSmall(uint256 amount, uint256 minimumPurchase);
    error PurchaseAmountTooLarge(uint256 amount, uint256 maximumPurchase);
    error InvalidPurchaseGranularity(uint256 amount, uint256 purchaseGranularity);
    error SaleSupplyCapExceeded(uint256 currentSupply, uint256 amount, uint256 effectiveSupplyCap);
    error RecipientBalanceLimitExceeded(
        address recipient,
        uint256 currentBalance,
        uint256 amount,
        uint256 maximumRecipientBalance
    );
    error MaximumPaymentExceeded(uint256 totalPayment, uint256 maximumPayment);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes a sale proxy with fixed launch limits and current owner-controlled routing configuration.
    /// @param configuration_ Complete initial sale configuration.
    /// @param owner_ Initial owner responsible for administration and UUPS upgrades.
    function initialize(SaleConfiguration calldata configuration_, address owner_) external initializer {
        if (owner_ == address(0)) revert InvalidOwner(owner_);

        __Ownable_init(owner_);
        __Ownable2Step_init();
        __Pausable_init();

        _validateInitialConfiguration(configuration_);
        _getDynamicPriceSaleStorage().configuration = configuration_;

        emit VillageTreasuryChanged(address(0), configuration_.villageTreasury);
        emit CloserFeeConfigurationChanged(
            0,
            configuration_.closerFeeBps,
            address(0),
            configuration_.closerFeeRecipient
        );
        emit BondingCurveChanged(address(0), configuration_.bondingCurve);
    }

    /// @notice Returns the complete current sale configuration in one call.
    function saleConfiguration() external view returns (SaleConfiguration memory) {
        return _getDynamicPriceSaleStorage().configuration;
    }

    /// @notice Returns live supply and remaining-capacity values in one call.
    /// @return status Current token supply, configured token maximum, effective cap, and remaining capacity.
    function saleStatus() public view returns (SaleStatus memory status) {
        SaleConfiguration storage configuration = _getDynamicPriceSaleStorage().configuration;
        ICommunityToken token = ICommunityToken(configuration.communityToken);
        status.currentSupply = token.totalSupply();
        status.tokenMaxSupply = token.maxSupply();
        status.effectiveSupplyCap = Math.min(configuration.saleCap, status.tokenMaxSupply);
        if (status.currentSupply < status.effectiveSupplyCap) {
            status.remainingSaleCapacity = status.effectiveSupplyCap - status.currentSupply;
        }
    }

    /// @notice Returns the current curve spot price for one whole CommunityToken.
    function currentPrice() external view returns (uint256) {
        SaleConfiguration storage configuration = _getDynamicPriceSaleStorage().configuration;
        return
            IBondingCurve(configuration.bondingCurve).currentPrice(
                ICommunityToken(configuration.communityToken).totalSupply()
            );
    }

    /// @notice Quotes an amount using current total supply and the inclusive Closer fee.
    /// @dev This validates amount, granularity, cap, and curve constraints, but not recipient balance, allowance,
    /// deadline, or pause state.
    /// @param amount CommunityToken amount to quote.
    /// @return totalPayment Total quote-token payment inclusive of the Closer fee.
    /// @return closerFee Quote-token amount routed to the Closer fee recipient.
    /// @return villageProceeds Quote-token amount routed to the village treasury.
    /// @return postPurchasePrice Curve spot price following the quoted purchase.
    /// @return prePurchaseSupply CommunityToken total supply used by the quote.
    function quotePurchase(
        uint256 amount
    )
        external
        view
        returns (
            uint256 totalPayment,
            uint256 closerFee,
            uint256 villageProceeds,
            uint256 postPurchasePrice,
            uint256 prePurchaseSupply
        )
    {
        PurchaseQuote memory purchaseQuote = _quotePurchase(amount);
        return (
            purchaseQuote.totalPayment,
            purchaseQuote.closerFee,
            purchaseQuote.villageProceeds,
            purchaseQuote.postPurchasePrice,
            purchaseQuote.prePurchaseSupply
        );
    }

    /// @notice Purchases CommunityToken for `recipient`, funded exclusively by the caller.
    /// @param amount CommunityToken amount to mint in 18-decimal base units.
    /// @param recipient Account receiving the newly minted tokens.
    /// @param maxPayment Maximum quote-token amount the caller permits.
    /// @param deadline Last timestamp at which the purchase may execute.
    function buy(
        uint256 amount,
        address recipient,
        uint256 maxPayment,
        uint256 deadline
    ) external nonReentrant whenNotPaused {
        if (recipient == address(0)) revert InvalidRecipient(recipient);
        if (block.timestamp > deadline) revert PurchaseExpired(deadline, block.timestamp);

        PurchaseQuote memory purchaseQuote = _quotePurchase(amount);
        if (purchaseQuote.totalPayment > maxPayment) {
            revert MaximumPaymentExceeded(purchaseQuote.totalPayment, maxPayment);
        }

        SaleConfiguration storage configuration = _getDynamicPriceSaleStorage().configuration;
        ICommunityToken communityToken = ICommunityToken(configuration.communityToken);
        uint256 recipientBalance = communityToken.balanceOf(recipient);
        if (
            recipientBalance > configuration.maximumRecipientBalance ||
            amount > configuration.maximumRecipientBalance - recipientBalance
        ) {
            revert RecipientBalanceLimitExceeded(
                recipient,
                recipientBalance,
                amount,
                configuration.maximumRecipientBalance
            );
        }

        IERC20 quoteToken = IERC20(configuration.quoteToken);
        if (purchaseQuote.closerFee > 0) {
            quoteToken.safeTransferFrom(_msgSender(), configuration.closerFeeRecipient, purchaseQuote.closerFee);
        }
        if (purchaseQuote.villageProceeds > 0) {
            quoteToken.safeTransferFrom(_msgSender(), configuration.villageTreasury, purchaseQuote.villageProceeds);
        }
        communityToken.mint(recipient, amount);

        emit TokensPurchased(
            _msgSender(),
            recipient,
            configuration.bondingCurve,
            amount,
            purchaseQuote.totalPayment,
            purchaseQuote.closerFee,
            purchaseQuote.villageProceeds,
            purchaseQuote.prePurchaseSupply,
            purchaseQuote.postPurchasePrice
        );
    }

    /// @notice Replaces the village quote-token proceeds recipient immediately.
    /// @param newVillageTreasury New nonzero village treasury.
    function setVillageTreasury(address newVillageTreasury) external onlyOwner {
        if (newVillageTreasury == address(0)) revert InvalidVillageTreasury(newVillageTreasury);
        SaleConfiguration storage configuration = _getDynamicPriceSaleStorage().configuration;
        address oldVillageTreasury = configuration.villageTreasury;
        configuration.villageTreasury = newVillageTreasury;
        emit VillageTreasuryChanged(oldVillageTreasury, newVillageTreasury);
    }

    /// @notice Atomically replaces the inclusive Closer fee percentage and recipient.
    /// @param newCloserFeeBps New inclusive fee from 0 through 10,000 basis points.
    /// @param newCloserFeeRecipient New nonzero Closer fee recipient.
    function setCloserFeeConfiguration(uint16 newCloserFeeBps, address newCloserFeeRecipient) external onlyOwner {
        _validateCloserFeeConfiguration(newCloserFeeBps, newCloserFeeRecipient);
        SaleConfiguration storage configuration = _getDynamicPriceSaleStorage().configuration;
        uint16 oldCloserFeeBps = configuration.closerFeeBps;
        address oldCloserFeeRecipient = configuration.closerFeeRecipient;
        configuration.closerFeeBps = newCloserFeeBps;
        configuration.closerFeeRecipient = newCloserFeeRecipient;
        emit CloserFeeConfigurationChanged(
            oldCloserFeeBps,
            newCloserFeeBps,
            oldCloserFeeRecipient,
            newCloserFeeRecipient
        );
    }

    /// @notice Replaces the stateless pricing adapter immediately.
    /// @dev Existing pending transactions remain protected by their `maxPayment` and `deadline`.
    /// @param newBondingCurve New ERC-165-compatible curve using the configured quote-token decimals.
    function setBondingCurve(address newBondingCurve) external nonReentrant onlyOwner {
        SaleConfiguration storage configuration = _getDynamicPriceSaleStorage().configuration;
        // The guard prevents callbacks while interface and decimal compatibility are checked.
        // aderyn-fp-next-line(reentrancy-state-change)
        _validateBondingCurve(newBondingCurve, IERC20Metadata(configuration.quoteToken).decimals());
        address oldBondingCurve = configuration.bondingCurve;
        configuration.bondingCurve = newBondingCurve;
        emit BondingCurveChanged(oldBondingCurve, newBondingCurve);
    }

    /// @notice Pauses purchases while leaving read-only pricing and configuration available.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes purchases.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @dev UUPS implementation upgrades are controlled by the village owner.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    function _quotePurchase(uint256 amount) internal view returns (PurchaseQuote memory purchaseQuote) {
        SaleConfiguration storage configuration = _getDynamicPriceSaleStorage().configuration;
        if (amount < configuration.minimumPurchase) {
            revert PurchaseAmountTooSmall(amount, configuration.minimumPurchase);
        }
        if (amount > configuration.maximumPurchase) {
            revert PurchaseAmountTooLarge(amount, configuration.maximumPurchase);
        }
        if (amount % configuration.purchaseGranularity != 0) {
            revert InvalidPurchaseGranularity(amount, configuration.purchaseGranularity);
        }

        SaleStatus memory status = saleStatus();
        if (amount > status.remainingSaleCapacity) {
            revert SaleSupplyCapExceeded(status.currentSupply, amount, status.effectiveSupplyCap);
        }
        purchaseQuote.prePurchaseSupply = status.currentSupply;
        (purchaseQuote.totalPayment, purchaseQuote.postPurchasePrice) = IBondingCurve(configuration.bondingCurve)
            .quotePurchase(purchaseQuote.prePurchaseSupply, amount);
        purchaseQuote.closerFee = Math.mulDiv(
            purchaseQuote.totalPayment,
            configuration.closerFeeBps,
            MAX_CLOSER_FEE_BPS
        );
        purchaseQuote.villageProceeds = purchaseQuote.totalPayment - purchaseQuote.closerFee;
    }

    function _validateInitialConfiguration(SaleConfiguration calldata configuration) private view {
        if (configuration.communityToken.code.length == 0) {
            revert InvalidCommunityToken(configuration.communityToken);
        }
        if (configuration.quoteToken.code.length == 0) revert InvalidQuoteToken(configuration.quoteToken);
        if (configuration.villageTreasury == address(0)) {
            revert InvalidVillageTreasury(configuration.villageTreasury);
        }
        _validateCloserFeeConfiguration(configuration.closerFeeBps, configuration.closerFeeRecipient);
        _validatePurchaseLimits(configuration);
        _validateCommunityTokenCapacity(configuration);

        uint8 quoteTokenDecimals = IERC20Metadata(configuration.quoteToken).decimals();
        _validateBondingCurve(configuration.bondingCurve, quoteTokenDecimals);
    }

    function _validatePurchaseLimits(SaleConfiguration calldata configuration) private pure {
        if (configuration.saleCap == 0) revert InvalidSaleCap(configuration.saleCap);
        if (
            configuration.minimumPurchase == 0 ||
            configuration.maximumPurchase < configuration.minimumPurchase ||
            configuration.purchaseGranularity == 0 ||
            configuration.minimumPurchase % configuration.purchaseGranularity != 0 ||
            configuration.maximumPurchase % configuration.purchaseGranularity != 0 ||
            configuration.maximumRecipientBalance < configuration.minimumPurchase
        ) {
            revert InvalidPurchaseLimits(
                configuration.minimumPurchase,
                configuration.maximumPurchase,
                configuration.purchaseGranularity,
                configuration.maximumRecipientBalance
            );
        }
    }

    function _validateCommunityTokenCapacity(SaleConfiguration calldata configuration) private view {
        ICommunityToken communityToken = ICommunityToken(configuration.communityToken);
        if (communityToken.decimals() != COMMUNITY_TOKEN_DECIMALS) {
            revert InvalidCommunityToken(configuration.communityToken);
        }
        uint256 tokenMaxSupply = communityToken.maxSupply();
        if (configuration.saleCap > tokenMaxSupply) {
            revert SaleCapExceedsTokenMaxSupply(configuration.saleCap, tokenMaxSupply);
        }
        uint256 currentSupply = communityToken.totalSupply();
        if (currentSupply > configuration.saleCap) {
            revert CurrentSupplyExceedsSaleCap(currentSupply, configuration.saleCap);
        }
        if (configuration.minimumPurchase > configuration.saleCap - currentSupply) {
            revert InsufficientLaunchCapacity(currentSupply, configuration.minimumPurchase, configuration.saleCap);
        }
    }

    function _validateCloserFeeConfiguration(uint16 closerFeeBps, address closerFeeRecipient) private pure {
        if (closerFeeBps > MAX_CLOSER_FEE_BPS) revert InvalidCloserFeeBps(closerFeeBps);
        if (closerFeeRecipient == address(0)) revert InvalidCloserFeeRecipient(closerFeeRecipient);
    }

    function _validateBondingCurve(address bondingCurve, uint8 quoteTokenDecimals) private view {
        if (
            bondingCurve.code.length == 0 ||
            !ERC165Checker.supportsInterface(bondingCurve, type(IBondingCurve).interfaceId)
        ) {
            revert InvalidBondingCurve(bondingCurve);
        }
        uint8 curveQuoteTokenDecimals = IBondingCurve(bondingCurve).quoteTokenDecimals();
        if (curveQuoteTokenDecimals != quoteTokenDecimals) {
            revert QuoteTokenDecimalsMismatch(quoteTokenDecimals, curveQuoteTokenDecimals);
        }
    }

    function _getDynamicPriceSaleStorage() private pure returns (DynamicPriceSaleStorage storage $) {
        bytes32 location = DYNAMIC_PRICE_SALE_STORAGE_LOCATION;
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            $.slot := location
        }
    }
}
