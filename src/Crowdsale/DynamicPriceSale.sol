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
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IERC20Upgradeable token;
    IERC20Upgradeable quote;
    IMinterDAO minter;
    uint256 price;
    uint256 lastPrice;

    event SuccessBuy(address to, uint256 amount);

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
    }

    // Buy:
    // @amount: amount of tokens to buy
    function buy(uint256 amount) public {
        // calculatePrice
        quote.safeTransferFrom(_msgSender(), address(this), amount);
        // store lastPrice
        minter.mintCommunityTokenTo(_msgSender(), amount);
        emit SuccessBuy(_msgSender(), amount);
    }

    function calculatePrice(uint256 amount) public view returns (uint256) {
        (, uint256 total) = _calculatePrice(amount);
        return total;
    }

    function _calculatePrice(uint256 amount) internal view returns (uint256, uint256) {
        (, uint256 _lastPrice, uint256 total) = _doCalculatePrice(amount, lastPrice, 0);
        return (_lastPrice, total);
    }

    function _doCalculatePrice(
        uint256 requested,
        uint256 lastPrice_,
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
            return (requested, lastPrice_, sum);
        }
        uint256 currentPrice = lastPrice_ + ((lastPrice_ / 1000) * 5);
        return _doCalculatePrice(requested - 1 ether, currentPrice, sum + currentPrice);
    }
}
