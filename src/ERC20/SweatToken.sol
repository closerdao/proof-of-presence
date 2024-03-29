// SPDX-License-Identifier: AGPL-1.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "../Interfaces/ISweatToken.sol";

contract SweatToken is ISweatToken, ERC20Upgradeable, Ownable2StepUpgradeable {
    // Address of treasury, which is allowed to transfer tokens from its address to another
    address public treasury;

    event SweatMinted(address indexed receiver, uint256 indexed amount, uint256 indexed timestamp);

    function initialize(address _treasury) public initializer {
        __SweatToken_init(_treasury);
    }

    function __SweatToken_init(address _treasury) internal onlyInitializing {
        __ERC20_init("TDF Sweat", "SWEAT");
        __SweatToken_init_unchained(_treasury);
        __Ownable2Step_init();
    }

    function __SweatToken_init_unchained(address _treasury) internal onlyInitializing {
        treasury = _treasury;
    }

    /**
     * Mint new $Sweat tokens to address
     */
    function mint(address account, uint256 amount) public onlyOwner {
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
        if (from != treasury && from != address(0) && to != address(0)) revert SweatToken_SweatIsNonTransferable();
    }
}
