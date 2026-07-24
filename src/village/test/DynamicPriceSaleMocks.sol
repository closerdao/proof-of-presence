// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IBondingCurve} from "../interfaces/IBondingCurve.sol";

contract QuoteTokenMock is ERC20 {
    uint8 private immutable _tokenDecimals;

    constructor(uint8 tokenDecimals) ERC20("Quote Token", "QUOTE") {
        _tokenDecimals = tokenDecimals;
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

contract BondingCurveMock is IBondingCurve, ERC165 {
    uint8 private immutable _quoteDecimals;
    uint256 public price;
    bool public priceReverts;
    bool public quoteReverts;

    error MockCurveError();

    constructor(uint8 quoteDecimals_, uint256 price_) {
        _quoteDecimals = quoteDecimals_;
        price = price_;
    }

    function setPrice(uint256 newPrice) external {
        price = newPrice;
    }

    function setReverts(bool priceReverts_, bool quoteReverts_) external {
        priceReverts = priceReverts_;
        quoteReverts = quoteReverts_;
    }

    function quoteTokenDecimals() external view returns (uint8) {
        return _quoteDecimals;
    }

    function currentPrice(uint256) external view returns (uint256) {
        if (priceReverts) revert MockCurveError();
        return price;
    }

    function quotePurchase(
        uint256,
        uint256 amount
    ) external view returns (uint256 totalPayment, uint256 postPurchasePrice) {
        if (quoteReverts) revert MockCurveError();
        totalPayment = Math.mulDiv(amount, price, 1 ether);
        postPurchasePrice = price;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IBondingCurve).interfaceId || super.supportsInterface(interfaceId);
    }
}

contract WrongBondingCurveInterface is ERC165 {}

contract SupplyTrackingBondingCurveMock is IBondingCurve, ERC165 {
    function quoteTokenDecimals() external pure returns (uint8) {
        return 18;
    }

    function currentPrice(uint256 currentSupply) external pure returns (uint256) {
        return currentSupply;
    }

    function quotePurchase(
        uint256 currentSupply,
        uint256 amount
    ) external pure returns (uint256 totalPayment, uint256 postPurchasePrice) {
        return (amount, currentSupply + amount);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IBondingCurve).interfaceId || super.supportsInterface(interfaceId);
    }
}

contract ReentrantQuoteTokenMock is QuoteTokenMock {
    address private _target;
    bytes private _payload;
    bool private _attack;

    constructor() QuoteTokenMock(18) {}

    function configureReentrancy(address target, bytes calldata payload) external {
        _target = target;
        _payload = payload;
        _attack = true;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (_attack) {
            _attack = false;
            (bool success, bytes memory returnData) = _target.call(_payload);
            if (!success) {
                assembly ("memory-safe") {
                    revert(add(returnData, 0x20), mload(returnData))
                }
            }
        }
        return super.transferFrom(from, to, value);
    }
}

contract ZeroTransferRevertingQuoteTokenMock is QuoteTokenMock {
    error ZeroTransfer();

    constructor() QuoteTokenMock(18) {}

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (value == 0) revert ZeroTransfer();
        return super.transferFrom(from, to, value);
    }
}
