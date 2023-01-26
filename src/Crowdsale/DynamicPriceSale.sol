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
import "hardhat/console.sol";

interface IMinterDAO {
    function mintCommunityTokenTo(address to, uint256 amount) external;
}

contract DynamicSale is ContextUpgradeable, ReentrancyGuardUpgradeable, Ownable2StepUpgradeable, PausableUpgradeable {
    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IERC20Upgradeable public token;
    IERC20Upgradeable public quote;
    IMinterDAO public minter;
    uint256 public currentPrice;
    uint256 public saleHardCap;
    address public treasury;
    /// @dev mininum value for usable part of the curve
    uint256 public priceCurveMinValue = 4109 ether;
    /// @dev maximum safe value for curve to protect against integer overflows
    uint256 public priceCurveMaxValue = 200000 ether;

    event SuccessBuy(address to, uint256 amount);

    modifier buyAmountConstraints(uint256 amount) {
        require(amount >= 1 ether, "DynamicSale: (MinBuy) required 1 ether minimum buy");
        require(amount % 1 ether == 0, "DynamicSale: (NonWholeUnit) only whole units allowed");
        require(amount <= 100 ether, "DynamicSale: (MaxAllowed) max buy allowed is 100");
        require(token.totalSupply() + amount <= saleHardCap, "DynamicSale: (MaxSupply) maximum supply reached");
        _;
    }

    function initialize(
        address token_,
        address quote_,
        address minter_
    ) public initializer {
        __DynamicSale_init(token_, quote_, minter_);
    }

    function __DynamicSale_init(
        address token_,
        address quote_,
        address minter_
    ) internal onlyInitializing {
        __DynamicSale_init_unchained(token_, quote_, minter_);
        __Ownable2Step_init();
    }

    function __DynamicSale_init_unchained(
        address token_,
        address quote_,
        address minter_
    ) internal onlyInitializing {
        token = IERC20Upgradeable(token_);
        quote = IERC20Upgradeable(quote_);
        minter = IMinterDAO(minter_);
        currentPrice = 222 ether;
        saleHardCap = 7000 ether;
        treasury = address(this);
    }

    // Buy:
    // @amount: amount of tokens to buy
    function buy(uint256 amount) public whenNotPaused buyAmountConstraints(amount) nonReentrant {
        _buyFrom(_msgSender(), _msgSender(), amount);
    }

    function buyFrom(
        address spender,
        address to,
        uint256 amount
    ) public whenNotPaused buyAmountConstraints(amount) nonReentrant {
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

    /// @notice calculates the total cost of the amount to be bought from curve
    /// @dev the cost function based on formula as stated in the whitepaper
    /// @param amount amount of token to be bought
    /// @return newPrice TODO
    /// @return totalCost TODO
    function calculateTotalCost(uint256 amount) public view returns (uint256 newPrice, uint256 totalCost) {
        uint256 currentSupply = token.totalSupply();
        require(currentSupply >= priceCurveMinValue, "DynamicSale: current totalSupply too low");
        require(currentSupply + amount <= priceCurveMaxValue, "DynamicSale: totalSupply limit reached");
        /// @dev sale-function coefficients
        uint256 c = 420;
        uint256 b = 32000461777723 * (10**54);
        uint256 a = 11680057722 * (10**36);

        uint256 start = currentSupply;
        uint256 end = start + amount;
        newPrice = c - a / end**2 + b / end**3;
        totalCost = c * (end - start) + a * (1 / end - 1 / start) - (b / 2) * (1 / end**2 - 1 / start**2);
    }

    // endregion:     --- Price Calculations
}
