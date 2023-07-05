// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

interface IMinterDAO {
    function mintCommunityTokenTo(address to, uint256 amount) external;
}

contract DynamicSale is ContextUpgradeable, ReentrancyGuardUpgradeable, Ownable2StepUpgradeable, PausableUpgradeable {
    using SafeMathUpgradeable for uint256;
    using SafeMathUpgradeable for int256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IERC20Upgradeable public token;
    IERC20Upgradeable public quote;
    IMinterDAO public minter;
    uint256 public currentPrice;
    uint256 public saleHardCap;
    address public treasury;
    /// @dev mininum value for usable part of the curve
    uint256 public priceCurveMinValue;
    /// @dev maximum safe value for curve to protect against integer overflows
    uint256 public priceCurveMaxValue;
    uint256 public constant MAX_BUYABLE_AMOUNT_PER_WALLET = 915 ether;

    event SuccessBuy(address to, uint256 amount);

    modifier buyAmountConstraints(uint256 amount, address receiver) {
        require(amount >= 1 ether, "DynamicSale: (MinBuy) required 1 ether minimum buy");
        require(amount % 1 ether == 0, "DynamicSale: (NonWholeUnit) only whole units allowed");
        require(amount <= 100 ether, "DynamicSale: (maxBuyAllowed) maximum buyable amount is 100");
        require(
            token.balanceOf(receiver) + amount <= MAX_BUYABLE_AMOUNT_PER_WALLET,
            "DynamicSale: wallet balance + buy amount exceeds maxBuyableAmountPerWallet"
        );
        require(token.totalSupply() + amount <= saleHardCap, "DynamicSale: (MaxSupply) maximum supply reached");
        _;
    }

    function initialize(
        address token_,
        address quote_,
        address minter_,
        address treasury_
    ) public initializer {
        __DynamicSale_init(token_, quote_, minter_, treasury_);
    }

    function __DynamicSale_init(
        address token_,
        address quote_,
        address minter_,
        address treasury_
    ) internal onlyInitializing {
        __DynamicSale_init_unchained(token_, quote_, minter_, treasury_);
        __Ownable2Step_init();
    }

    function __DynamicSale_init_unchained(
        address token_,
        address quote_,
        address minter_,
        address treasury_
    ) internal onlyInitializing {
        token = IERC20Upgradeable(token_);
        quote = IERC20Upgradeable(quote_);
        minter = IMinterDAO(minter_);
        saleHardCap = 6668 ether;
        treasury = treasury_;
        priceCurveMinValue = 4109 ether;
        priceCurveMaxValue = 200000 ether;
    }

    // Buy:
    // @amount: amount of tokens to buy
    function buy(uint256 amount) public whenNotPaused buyAmountConstraints(amount, _msgSender()) nonReentrant {
        _buyFrom(_msgSender(), _msgSender(), amount);
    }

    function buyFrom(
        address spender,
        address to,
        uint256 amount
    ) public whenNotPaused buyAmountConstraints(amount, to) nonReentrant {
        _buyFrom(spender, to, amount);
    }

    function _buyFrom(
        address spender,
        address to,
        uint256 amount
    ) internal {
        (uint256 newPrice, uint256 totalCost) = calculateTotalCost(amount); // 18 decimals
        quote.safeTransferFrom(spender, treasury, totalCost);
        currentPrice = newPrice;
        minter.mintCommunityTokenTo(to, amount);
        emit SuccessBuy(to, amount);
    }

    // region:   --- ADMIN

    function setNewPrice(uint256 newPrice) public onlyOwner {
        require(newPrice > currentPrice, "New price cannot be smaller than previous price");
        currentPrice = newPrice;
    }

    function setMaxLiquidSupply(uint256 supply) public onlyOwner {
        saleHardCap = supply;
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function setTreasury(address treasury_) public onlyOwner {
        treasury = treasury_;
    }

    // endregion:    --- ADMIN

    // region:     --- Price Calculations

    /// @notice calculates the current price on the bonding curve
    /// @dev calculates the current price of the token
    /// @return _currentPrice The current price of the token, based on the current supply
    function calculateCurrentPrice() public view returns (uint256 _currentPrice) {
        int256 currentSupply = int256(token.totalSupply());

        _currentPrice = _calculatePrice(currentSupply);
    }

    /// @notice calculates the total cost of the amount to be bought from curve
    /// @dev the cost function based on formula as stated in the whitepaper
    /// @param amount amount of token to be bought
    /// @return newPrice TODO
    /// @return totalCost TODO
    function calculateTotalCost(uint256 amount) public view returns (uint256 newPrice, uint256 totalCost) {
        uint256 currentSupply = token.totalSupply();
        require(currentSupply >= priceCurveMinValue, "DynamicSale: current totalSupply too low");
        require(currentSupply + amount <= priceCurveMaxValue, "DynamicSale: totalSupply limit reached");
        // /// @dev sale-function coefficients

        int256 c = 420;
        int256 b = 32000461777723 * (10**54);
        int256 a = 11680057722 * (10**36);

        // Get current supply
        int256 supplyBeforeBuy = int256(currentSupply);
        // Calculate supply after buying
        int256 supplyAfterBuy = supplyBeforeBuy + int256(amount);
        // Calculate total induced cost
        int256 _totalCost = c *
            (10**54) *
            (supplyAfterBuy - supplyBeforeBuy) +
            a *
            ((10**54 / supplyAfterBuy) - (10**54 / supplyBeforeBuy)) -
            (b / 2) *
            ((10**54 / supplyAfterBuy**2) - (10**54 / supplyBeforeBuy**2));

        // Get unit price after amount has been bought
        newPrice = _calculatePrice(supplyAfterBuy);
        totalCost = uint256((_totalCost / 10**70) * 10**16);
    }

    function _calculatePrice(int256 _tokenSupply) private pure returns (uint256 _tokenPrice) {
        int256 c = 420;
        int256 b = 32000461777723 * (10**54);
        int256 a = 11680057722 * (10**36);

        _tokenPrice = uint256(c - (a / _tokenSupply**2) + (b / _tokenSupply**3));
    }
    // endregion:     --- Price Calculations
}
