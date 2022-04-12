// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract TDFSale is Context, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

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
        uint256 _rate
    ) {
        require(_rate > 0, "Crowdsale: rate is 0");
        require(_wallet != address(0), "Crowdsale: wallet is the zero address");
        require(address(_token) != address(0), "Crowdsale: token is the zero address");
        token = IERC20(_token);
        quote = IERC20(_quote);
        wallet = _wallet;
        rate = _rate;
    }

    function buy(uint256 weiAmount) public {
        _buyFrom(_msgSender(), weiAmount);
    }

    function buyFrom(address beneficiary, uint256 weiAmount) public {
        _buyFrom(beneficiary, weiAmount);
    }

    function _buyFrom(address beneficiary, uint256 weiAmount) internal nonReentrant {
        _preValidatePurchase(beneficiary, weiAmount);

        // calculate token amount to be bought
        uint256 tokens = _getTokenAmount(weiAmount);

        // update state
        weiRaised = weiRaised.add(weiAmount);

        quote.safeTransferFrom(_msgSender(), wallet, weiAmount);
        token.safeTransferFrom(wallet, beneficiary, tokens);

        emit TokensPurchased(beneficiary, _msgSender(), weiAmount, tokens);

        _postValidatePurchase(beneficiary, weiAmount);
    }

    /**
     * @dev Validation of an incoming purchase. Use require statements to revert state when conditions are not met.
     * Use `super` in contracts that inherit from Crowdsale to extend their validations.
     * Example from CappedCrowdsale.sol's _preValidatePurchase method:
     *     super._preValidatePurchase(beneficiary, weiAmount);
     *     require(weiRaised().add(weiAmount) <= cap);
     * @param beneficiary Address performing the token purchase
     * @param weiAmount Value in wei involved in the purchase
     */
    function _preValidatePurchase(address beneficiary, uint256 weiAmount) internal view {
        require(beneficiary != address(0), "Crowdsale: beneficiary is the zero address");
        require(weiAmount != 0, "Crowdsale: weiAmount is 0");
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
