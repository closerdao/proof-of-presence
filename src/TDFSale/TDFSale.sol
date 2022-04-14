// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract TDFSale is Context, ReentrancyGuard {
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
    // How many token units a buyer gets per wei.
    // The rate is the conversion between wei and the smallest and indivisible token unit.
    // So, if you are using a rate of 1 with a ERC20Detailed token with 3 decimals called TOK
    // 1 wei will give you 1 unit, or 0.001 TOK.
    uint256 public rate;

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
        uint256 _rate,
        uint256 _minTokenBuyAmount
    ) {
        require(_rate > 0, "Crowdsale: rate is 0");
        require(_wallet != ZERO_ADDRESS, "Crowdsale: wallet is the zero address");
        require(address(_token) != ZERO_ADDRESS, "Crowdsale: token is the zero address");
        token = IERC20(_token);
        quote = IERC20(_quote);
        wallet = _wallet;
        rate = _rate;
        minTokenBuyAmount = _minTokenBuyAmount;
    }

    /**
     * @dev Sender buys tokens to be paid from his wallet and sent to his wallet.
     * @param weiAmount amount of tokens to be bought with min unit of quote token
     * example:
     * 1 ETH = 1000000000000000000 Wei
     */
    function buy(uint256 weiAmount) public nonReentrant {
        _buyFrom(_msgSender(), weiAmount);
    }

    /**
     * @dev Sender buys tokens to be sent to another wallet.
     * @param beneficiary address to deliver the tokens
     * @param weiAmount amount of tokens to be bought with min unit of quote token
     * example:
     * 1 ETH = 1000000000000000000 Wei
     */
    function buyFrom(address beneficiary, uint256 weiAmount) public nonReentrant {
        _buyFrom(beneficiary, weiAmount);
    }

    /**
     * @dev Checks the amount of tokens left in the allowance.
     * @return Amount of tokens left in the allowance
     */
    function remainingTokens() public view returns (uint256) {
        return Math.min(token.balanceOf(wallet), token.allowance(wallet, address(this)));
    }

    function _buyFrom(address beneficiary, uint256 weiAmount) private {
        // calculate token amount to be bought
        uint256 tokens = _getTokenAmount(weiAmount);

        _preValidatePurchase(beneficiary, tokens);

        // update state
        weiRaised = weiRaised.add(weiAmount);

        _forwardFunds(weiAmount);
        _deliverTokens(beneficiary, tokens);

        emit TokensPurchased(beneficiary, _msgSender(), weiAmount, tokens);

        _postValidatePurchase(beneficiary, weiAmount);
    }

    /**
     * @dev Sends Tokens to buyer
     * @param beneficiary Token purchaser
     * @param tokenAmount Amount of tokens purchased
     */
    function _deliverTokens(address beneficiary, uint256 tokenAmount) internal {
        token.safeTransferFrom(wallet, beneficiary, tokenAmount);
    }

    /**
     * @dev Sends buying tokens to wallet.
     */
    function _forwardFunds(uint256 weiAmount) internal {
        quote.safeTransferFrom(_msgSender(), wallet, weiAmount);
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
    function _getTokenAmount(uint256 weiAmount) internal view returns (uint256) {
        return weiAmount.mul(rate);
    }
}
