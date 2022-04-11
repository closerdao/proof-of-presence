// SPDX-License-Identifier: AGPL-1.0
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

pragma solidity 0.8.9;

contract TDFSale {
    IERC20 internal asset;
    IERC20 internal quote;
    address payable internal wallet;
    uint256 price;

    constructor(
        address _asset,
        address _quote,
        address _wallet,
        uint256 _price
    ) {
        asset = IERC20(_asset);
        quote = IERC20(_quote);
        wallet = payable(_wallet);
        price = _price;
    }

    function buy(uint256 amount) external returns (bool) {
        require(quote.transferFrom(msg.sender, wallet, amount), "unable to pay tokens");
        require(asset.transferFrom(wallet, msg.sender, amount), "unable to send buied tokens");
        return true;
    }
}
