// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import {StorageSlot} from "@openzeppelin/contracts/utils/StorageSlot.sol";
import {ITDFToken} from "../../Interfaces/ITDFToken.sol";
import {Modifiers} from "../libraries/AppStorage.sol";

/**
 * @notice Burns the fixed 41 TDF correction once, through an initializer-only diamondCut.
 * @dev Never register this contract's selectors as facets. Immutable bindings live in
 *      its bytecode; only COMPLETION_SLOT is written in the Diamond's storage.
 *      See docs/tdf-burn-correction.md for the source receipts and execution procedure.
 */
contract TDFBurnCorrection is Modifiers {
    bytes32 public constant COMPLETION_SLOT = keccak256("closer.tdf.burn-correction.7181b78b.fe3880cf.v1");

    address public immutable expectedDiamond;
    address public immutable expectedToken;

    event TDFBurnCorrectionCompleted(uint256 totalBurned);

    constructor(address diamond_, address token_) {
        require(diamond_ != address(0) && token_ != address(0), "TDFBurnCorrection: zero binding");
        expectedDiamond = diamond_;
        expectedToken = token_;
    }

    function execute() external onlyOwner {
        require(address(this) == expectedDiamond, "TDFBurnCorrection: wrong diamond");
        require(address(s.communityToken) == expectedToken, "TDFBurnCorrection: wrong token");

        StorageSlot.BooleanSlot storage completed = StorageSlot.getBooleanSlot(COMPLETION_SLOT);
        require(!completed.value, "TDFBurnCorrection: already executed");
        // Any failure below rolls this back along with every burn.
        completed.value = true;

        ITDFToken token = ITDFToken(expectedToken);
        require(token.getDAOContract() == address(this), "TDFBurnCorrection: wrong DAO");

        address[4] memory accounts = [
            0x39B8eDbC6D6bAB985Bf03B498166DB588c00278e,
            0x5fE4E295A0765Eab77E23711972Fdcce960Dd95B,
            0x2f6b63eA91Ca3E13fcb6911dFee4Af24CdeC37D7,
            0x06f4DB783097c632B888669032B2905F70e08105
        ];
        // First receipt: 3 + 1, 2, 5 TDF. Second receipt: only the specified 30 TDF.
        uint256[4] memory amounts = [uint256(4 ether), 2 ether, 5 ether, 30 ether];

        for (uint256 i = 0; i < accounts.length; i++) {
            require(token.balanceOf(accounts[i]) >= amounts[i], "TDFBurnCorrection: insufficient balance");
        }
        for (uint256 i = 0; i < accounts.length; i++) {
            token.burnFrom(accounts[i], amounts[i]);
        }

        emit TDFBurnCorrectionCompleted(41 ether);
    }
}
