// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ITransferPolicy} from "../../village/interfaces/ITransferPolicy.sol";

/// @title TDF CommunityToken transfer policy
/// @author Closer DAO
/// @notice Restricts CommunityToken transfers to routes involving the treasury or an approved counterparty.
/// @dev Minting is always permitted. Burning must retain the TDF operating supply required by the V1 curve.
/// The policy is intentionally replaceable rather than upgradeable: CommunityToken governance can point the token
/// at a new policy. Ownership transfer uses two-step acceptance.
contract TDFTransferPolicy is ITransferPolicy, ERC165, Ownable2Step {
    /// @notice Lowest live TDF supply permitted after a burn.
    /// @dev 5,381 TDF is the lowest historical V1 quote-vector supply. It also safely supports every configured
    /// whole-token purchase from 1 through 100 TDF without changing the V1 curve's exact checked arithmetic.
    /// The curve's nominal 4,109 TDF mathematical boundary remains unchanged.
    uint256 public constant MINIMUM_OPERATING_SUPPLY = 5_381 ether;

    /// @notice Account permitted on either side of every transfer while restrictions are enabled.
    address public treasury;

    /// @notice Whether an account may send or receive while restrictions are enabled.
    mapping(address => bool) public allowedCounterparty;

    /// @notice Whether treasury/counterparty routing rules are currently enforced.
    bool public transfersRestricted;

    /// @notice Emitted when the globally permitted treasury account changes.
    /// @param oldTreasury Previously permitted treasury account.
    /// @param newTreasury Newly permitted treasury account.
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    /// @notice Emitted when an account's transfer exemption changes.
    /// @param account Account whose exemption changed.
    /// @param allowed Whether the account is now exempt from routing restrictions.
    event AllowedCounterpartyChanged(address indexed account, bool allowed);
    /// @notice Emitted when transfer restrictions are enabled or disabled.
    /// @param restricted Whether routing restrictions are now enforced.
    event TransfersRestrictedChanged(bool restricted);

    error InvalidTreasury(address treasury);

    /// @notice Deploys a policy that starts with transfer restrictions enabled.
    /// @dev Transfers start restricted so every deployment fails closed. The owner may explicitly
    /// enable ordinary transfers later with `setTransfersRestricted(false)`.
    /// @param treasury_ Initial account permitted as either sender or recipient.
    /// @param owner_ Initial policy owner; ownership transfers require acceptance by the successor.
    constructor(address treasury_, address owner_) Ownable(owner_) {
        _setTreasury(treasury_);
        _setTransfersRestricted(true);
    }

    /// @notice Replaces the account that is always permitted as a sender or recipient.
    /// @param newTreasury New nonzero treasury account.
    function setTreasury(address newTreasury) external onlyOwner {
        _setTreasury(newTreasury);
    }

    /// @notice Adds or removes a sender/recipient exemption.
    /// @dev In a TokenizedStays deployment, the stays contract must be allowed before the deployment becomes
    /// operational so user deposits and withdrawals can move through the restricted policy.
    /// @param account Account whose exemption is changing.
    /// @param allowed Whether `account` may send or receive without involving the treasury.
    function setAllowedCounterparty(address account, bool allowed) external onlyOwner {
        allowedCounterparty[account] = allowed;
        emit AllowedCounterpartyChanged(account, allowed);
    }

    /// @notice Enables or disables all transfer restrictions without replacing the policy.
    /// @dev When disabled, CommunityToken remains wired to this policy but every transfer is allowed.
    /// @param restricted Whether routing restrictions should be enforced.
    function setTransfersRestricted(bool restricted) external onlyOwner {
        _setTransfersRestricted(restricted);
    }

    /// @inheritdoc ITransferPolicy
    /// @dev The burn floor remains active when ordinary transfer restrictions are disabled so a holder cannot make
    /// the sale unquotable. Mints remain available to recover a deployment that started below the operating floor.
    function isTransferAllowed(
        address token,
        address,
        address from,
        address to,
        uint256 amount
    ) external view returns (bool) {
        if (from == address(0)) return true;
        if (to == address(0)) {
            uint256 currentSupply = IERC20(token).totalSupply();
            return currentSupply >= MINIMUM_OPERATING_SUPPLY && amount <= currentSupply - MINIMUM_OPERATING_SUPPLY;
        }
        if (!transfersRestricted) return true;
        if (from == treasury || to == treasury) return true;
        if (allowedCounterparty[from] || allowedCounterparty[to]) return true;
        return false;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(ITransferPolicy).interfaceId || super.supportsInterface(interfaceId);
    }

    function _setTreasury(address newTreasury) internal {
        if (newTreasury == address(0)) revert InvalidTreasury(newTreasury);
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryChanged(oldTreasury, newTreasury);
    }

    function _setTransfersRestricted(bool restricted) internal {
        transfersRestricted = restricted;
        emit TransfersRestrictedChanged(restricted);
    }
}
