// SPDX-License-Identifier: AGPL-1.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../Interfaces/ISweatToken.sol";

contract SweatToken is ISweatToken, ERC20, Ownable {
    // 20% of total TDF supply of 18600
    uint256 public constant MAX_SUPPLY = 3720 ether;

    event SweatMinted(address indexed receiver, uint256 indexed amount, uint256 indexed timestamp);

    // solhint-disable-next-line no-empty-blocks
    constructor() ERC20("Sweat", "SW") Ownable() {}

    /**
     * Modifier which reverts when max supply is reached or if buy amount would exeed max supply
     */
    modifier validateMaxSupply(uint256 amount) {
        uint256 totalSupply = totalSupply();

        if (totalSupply == MAX_SUPPLY) revert SweatToken_MaxSweatSupplyReached();
        if ((totalSupply + amount) > MAX_SUPPLY) revert SweatToken_MintAmountExceedsMaxSupply();
        _;
    }

    /**
     * Mint new $Sweat tokens to address
     */
    function mint(address account, uint256 amount) public onlyOwner validateMaxSupply(amount) {
        _mint(account, amount);
        emit SweatMinted(account, amount, block.timestamp);
    }

    /**
     * @dev See {ERC20-_beforeTokenTransfer} - transfer of token is disabled
     *
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);
        if (from != address(0) && to != address(0)) revert SweatToken_SweatIsNonTransferable();
    }
}
