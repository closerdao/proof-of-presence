// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "hardhat/console.sol";

contract Crowdsale is Context, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // Ethereum address
    // Used to protect tokens to not be sent to unrecoverable address
    address internal constant ZERO_ADDRESS = address(0);

    // The token been sold
    IERC20 public token;
    // Token to buy with
    IERC20 public quote;
    // Wallet holding the token
    address payable public wallet;
    // price in wei of single whole unit of token.
    uint256 public price;

    // Minimum token purchase to make a buy
    // To limit small amounts of token sale
    // When set to `1` is allowing almost all buys
    uint256 public minTokenBuyAmount;

    // Amount of wei raised
    uint256 public weiRaised;

    /**
     * Event for token purchase logging
     * @param purchaser who paid for the tokens
     * @param beneficiary who got the tokens
     * @param value weis paid for purchase
     * @param amount amount of tokens purchased
     */
    event TokensPurchased(address indexed purchaser, address indexed beneficiary, uint256 value, uint256 amount);

    constructor(
        address _token,
        address _quote,
        address payable _wallet,
        uint256 _price,
        uint256 _minTokenBuyAmount
    ) {
        require(_price > 0, "Crowdsale: price is 0");
        require(_wallet != ZERO_ADDRESS, "Crowdsale: wallet is the zero address");
        require(address(_token) != ZERO_ADDRESS, "Crowdsale: token is the zero address");
        token = IERC20(_token);
        quote = IERC20(_quote);
        wallet = _wallet;
        price = _price;
        // TODO: review and check if we need to do a minimum divisible amount
        // or remove it completely
        minTokenBuyAmount = _minTokenBuyAmount;
    }

    /**
     * @dev Sender buys tokens to be paid from his wallet and sent to his wallet.
     * @param weiAmount amount of tokens to be bought with min unit of quote token
     * example:
     * 1 ETH = 1000000000000000000 Wei
     */
    function buy(uint256 weiAmount) public nonReentrant {
        _buyFor(_msgSender(), weiAmount);
    }

    /**
     * @dev Sender buys tokens to be sent to another wallet.
     * @param beneficiary address to deliver the tokens
     * @param weiAmount amount of tokens to be bought with min unit of quote token
     * example:
     * 1 ETH = 1000000000000000000 Wei
     */
    function buyFor(address beneficiary, uint256 weiAmount) public nonReentrant {
        _buyFor(beneficiary, weiAmount);
    }

    /**
     * @dev Checks the amount of tokens left in the allowance.
     * @return Amount of tokens left in the allowance
     */
    function remainingTokens() public view returns (uint256) {
        return Math.min(token.balanceOf(wallet), token.allowance(wallet, address(this)));
    }

    function _buyFor(address beneficiary, uint256 weiAmount) private {
        // calculate the cost
        uint256 weiCost = _getCost(weiAmount);

        _preValidatePurchase(beneficiary, weiAmount);

        // update state
        weiRaised = weiRaised.add(weiCost);

        _forwardFunds(weiCost);
        _deliverTokens(beneficiary, weiAmount);

        emit TokensPurchased(beneficiary, _msgSender(), weiAmount, weiCost);

        _postValidatePurchase(beneficiary, weiAmount);
    }

    /**
     * @dev Sends Tokens to buyer
     * @param beneficiary Token purchaser
     * @param weiAmount Amount of tokens purchased
     */
    function _deliverTokens(address beneficiary, uint256 weiAmount) internal {
        token.safeTransferFrom(wallet, beneficiary, weiAmount);
    }

    /**
     * @dev Sends buying tokens to wallet.
     */
    function _forwardFunds(uint256 weiCost) internal {
        quote.safeTransferFrom(_msgSender(), wallet, weiCost);
    }

    /**
     * @dev Validation of an incoming purchase. Use require statements to revert state when conditions are not met.
     * Use `super` in contracts that inherit from Crowdsale to extend their validations.
     * Example from CappedCrowdsale.sol's _preValidatePurchase method:
     *     super._preValidatePurchase(beneficiary, weiAmount);
     *     require(weiRaised().add(weiAmount) <= cap);
     * @param beneficiary Address performing the token purchase
     * @param weiTokens Value in weiTokens involved in the purchase
     */
    function _preValidatePurchase(address beneficiary, uint256 weiTokens) internal view {
        require(beneficiary != ZERO_ADDRESS, "Crowdsale: beneficiary is the zero address");
        // TODO: review
        require(weiTokens >= minTokenBuyAmount, "Crowdsale: minimun amount to buy required");
        this; // silence state mutability warning without generating bytecode - see https://github.com/ethereum/solidity/issues/2691
    }

    /**
     * @dev Validation of an executed purchase. Observe state and use revert statements to undo rollback when valid
     * conditions are not met.
     * @param beneficiary Address performing the token purchase
     * @param weiAmount Value in wei involved in the purchase
     */
    function _postValidatePurchase(address beneficiary, uint256 weiAmount) internal view {
        // solhint-disable-previous-line no-empty-blocks
    }

    /**
     * @dev Override to extend the way in which ether is converted to tokens.
     * @param weiAmount Value in wei to be converted into tokens
     * @return Number of tokens that can be purchased with the specified _weiAmount
     */
    function _getCost(uint256 weiAmount) internal view returns (uint256) {
        return (price / 10**2).mul(weiAmount / 10**16);
    }
}
