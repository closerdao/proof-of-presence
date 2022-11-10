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

    IERC20Upgradeable token;
    IERC20Upgradeable quote;
    IMinterDAO minter;
    uint256 lastPrice;
    uint256 maxLiquidSupply;
    address treasury;

    event SuccessBuy(address to, uint256 amount);

    modifier amountConstrains(uint256 amount) {
        require(amount >= 1 ether, "DynamicSale: (MinBuy) required 1 ether minimum buy");
        require(amount % 1 ether == 0, "DynamicSale: (NonWholeUnit) only whole units allowed");
        require(amount <= 100 ether, "DynamicSale: (MaxAllowed) max buy allowed is 100");
        require(token.totalSupply() + amount <= maxLiquidSupply, "DynamicSale: (MaxSupply) maximum supply reached");
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
        lastPrice = 222 ether;
        maxLiquidSupply = 7000 ether;
        treasury = address(this);
    }

    // Buy:
    // @amount: amount of tokens to buy
    function buy(uint256 amount) public whenNotPaused amountConstrains(amount) nonReentrant {
        _buyFrom(_msgSender(), _msgSender(), amount);
    }

    function buyFrom(
        address spender,
        address to,
        uint256 amount
    ) public whenNotPaused amountConstrains(amount) nonReentrant {
        _buyFrom(spender, to, amount);
    }

    function _buyFrom(
        address spender,
        address to,
        uint256 amount
    ) internal {
        (uint256 _lastPrice, uint256 totalCost) = _calculatePrice(amount); // 18 decimals
        quote.safeTransferFrom(spender, treasury, totalCost);
        lastPrice = _lastPrice;
        minter.mintCommunityTokenTo(to, amount);
        emit SuccessBuy(to, amount);
    }

    // region:   --- ADMIN

    function setNewPrice(uint256 newPrice) public onlyOwner {
        require(newPrice > lastPrice, "DynamicSale: (OnlyPriceIncrease) price can not be smaller than previous price");
        lastPrice = newPrice;
    }

    function setMaxLiquidSupply(uint256 supply) public onlyOwner {
        maxLiquidSupply = supply;
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

    function calculatePrice(uint256 amount) public view amountConstrains(amount) returns (uint256) {
        (, uint256 total) = _calculatePrice(amount);
        return total;
    }

    function _calculatePrice(uint256 amount) internal view returns (uint256, uint256) {
        (, uint256 _lastPrice, uint256 total) = _doCalculatePrice(amount, lastPrice, token.totalSupply(), 0);
        return (_lastPrice, total);
    }

    function _doCalculatePrice(
        uint256 requested,
        uint256 lastPrice_,
        uint256 supply_,
        uint256 sum
    )
        internal
        view
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        if (requested < 1 ether) {
            return (requested, ceil(lastPrice_), ceil(sum));
        }

        uint256 currentPrice = _tokenPriceAtSupply(supply_ + 1 ether);
        return _doCalculatePrice(requested - 1 ether, currentPrice, supply_ + 1 ether, sum + currentPrice);
    }

    function _tokenPriceAtSupply(uint256 supply_) internal pure returns (uint256) {
        uint256 c = 420;
        uint256 b = 1584 ether;
        uint256 a = 790043 ether;
        uint256 result = c - a / (supply_ + b);
        result *= 10**18;
        return result;
    }

    /**
     * @dev The denominator with which to interpret the fee set in {_priceIncreasesBy} as a
     * fraction of the sale price. Defaults to 10000 so fees are expressed in basis points, but may be customized by an
     * override.
     */
    function _increaseDenominator() internal pure virtual returns (uint96) {
        // 250 = 0.025 %
        // 5 = 0.0005 %
        //
        return 1_000_000;
    }

    // it ceils to two decimals
    function ceil(uint256 a) internal pure returns (uint256) {
        uint256 m = 10 * 10**15;
        return ((a + m + 1) / m) * m;
    }

    // endregion:     --- Price Calculations
}
