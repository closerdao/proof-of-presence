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
        uint256 C = 420;
        uint256 B = 32000461777723 * (10**54);
        uint256 A = 11680057722 * (10**36);
        uint256 start = token.totalSupply();
        uint256 end = start + amount;
        uint256 _lastPrice = C - A / end**2 + B / end**3;
        uint256 totalCost = C * (end - start) + A * (1 / end - 1 / start) - (B / 2) * (1 / end**2 - 1 / start**2);
        return (_lastPrice, totalCost);
    }

    // endregion:     --- Price Calculations
}
