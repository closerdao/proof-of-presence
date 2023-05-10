// SPDX-License-Identifier: AGPL-1.0
pragma solidity 0.8.9;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITransferPermitter} from "./Interfaces/ITransferPermitter.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {ITDFToken} from "./Interfaces/ITDFToken.sol";

contract PrelaunchDAO is ITransferPermitter, Ownable, Pausable {
    IERC20 public communityToken;
    address public saleContract;

    modifier onlyDAOorOwner() {
        require(
            owner() == _msgSender() || address(saleContract) == _msgSender(),
            "Ownable: caller is not the owner or Sale contract"
        );
        _;
    }

    constructor(address _communityToken, address _saleContract) Ownable() {
        communityToken = IERC20(_communityToken);
        saleContract = _saleContract;
    }

    function isTokenTransferPermitted(
        address from,
        address,
        uint256
    ) external view returns (bool) {
        if (paused()) return false;
        // minting
        if (from == address(0)) return true;
        return false;
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function mintCommunityTokenTo(address account, uint256 amount) public onlyDAOorOwner {
        ITDFToken(address(communityToken)).mint(account, amount);
    }

    function setSaleContract(address _saleContract) public onlyOwner {
        saleContract = _saleContract;
    }

    function setCommunityToken(address _communityToken) public onlyOwner {
        communityToken = IERC20(_communityToken);
    }
}
