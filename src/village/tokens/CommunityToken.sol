// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {VillageRoles} from "../access/VillageRoles.sol";
import {ITransferPolicy} from "../interfaces/ITransferPolicy.sol";

/// @title CommunityToken
/// @author Closer DAO
/// @notice Upgradeable village currency with permit, emergency pausing, role-based minting, and an optional transfer
/// policy.
/// @dev A configured policy is consulted for transfers, mints, and burns. The owner alone authorizes UUPS upgrades and
/// role-authority replacement; the owner or VillageAccess default admin may pause the token or replace its policy.
/// Pausing blocks every balance update, including minting and burning. Ownership transfers require two-step acceptance.
/// Aderyn follows UUPSUpgradeable's payable upgrade surface, but OpenZeppelin rejects value when there is no setup call,
/// while every initializer/reinitializer in this implementation is nonpayable.
/// aderyn-fp-next-line(contract-locks-ether)
contract CommunityToken is
    Initializable,
    ERC20Upgradeable,
    ERC20PermitUpgradeable,
    ERC20PausableUpgradeable,
    Ownable2StepUpgradeable,
    UUPSUpgradeable
{
    /**
     * @dev ERC-7201 namespaced application storage isolates CommunityToken state from
     * OpenZeppelin base-contract layout changes. Never rename this namespace after a
     * proxy is deployed; append new fields to this struct in future implementations.
     * @custom:storage-location erc7201:closer.storage.CommunityToken
     */
    struct CommunityTokenStorage {
        /// @dev External authority queried for village roles.
        IAccessControl roleAuthority;
        /// @dev Optional policy called before each ERC-20 balance update; zero means no policy checks.
        ITransferPolicy transferPolicy;
        /// @dev Owner-governed ceiling enforced for every minting path.
        uint256 maxSupply;
    }

    /// @notice Emitted when the external village role registry changes.
    /// @param oldAuthority Previously configured role authority.
    /// @param newAuthority Newly configured role authority.
    event RoleAuthorityChanged(address indexed oldAuthority, address indexed newAuthority);
    /// @notice Emitted when policy enforcement is enabled, disabled, or redirected.
    /// @param oldPolicy Previously configured policy, or the zero address.
    /// @param newPolicy Newly configured policy, or the zero address.
    event TransferPolicyChanged(address indexed oldPolicy, address indexed newPolicy);
    /// @notice Emitted when the token-wide minting ceiling changes.
    /// @param oldMaxSupply Previously configured maximum supply.
    /// @param newMaxSupply Newly configured maximum supply.
    event MaxSupplyChanged(uint256 oldMaxSupply, uint256 newMaxSupply);

    error InvalidRoleAuthority(address roleAuthority);
    error InvalidTransferPolicy(address transferPolicy);
    error InvalidOwner(address owner);
    error InvalidInitialRecipient(address recipient);
    error InvalidMaxSupply(uint256 maxSupply);
    error MaxSupplyBelowCurrentSupply(uint256 maxSupply, uint256 currentSupply);
    error MaxSupplyExceeded(uint256 currentSupply, uint256 mintAmount, uint256 maxSupply);
    error Unauthorized(address sender, bytes32 role);
    error TransferBlockedByPolicy(address operator, address from, address to, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes a CommunityToken proxy and optionally creates its initial supply.
    /// @dev `transferPolicy_` may be zero; otherwise it must advertise ITransferPolicy through ERC-165. The policy is
    /// installed before `initialSupply` is minted, so it must allow a mint from the zero address or initialization will
    /// revert. `roleAuthority_` is checked for contract code but not probed for full IAccessControl compatibility.
    /// @param name_ ERC-20 name and EIP-712 signing-domain name.
    /// @param symbol_ ERC-20 symbol.
    /// @param initialSupply Amount minted during initialization, in the token's smallest unit.
    /// @param maxSupply_ Initial token-wide minting ceiling, in the token's smallest unit.
    /// @param initialRecipient Recipient of `initialSupply`; may be zero only when the supply is zero.
    /// @param roleAuthority_ VillageAccess-compatible contract queried for operational roles.
    /// @param transferPolicy_ Optional ITransferPolicy implementation, or the zero address for unrestricted updates.
    /// @param owner_ Initial owner responsible for configuration and UUPS upgrades.
    function initialize(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply,
        uint256 maxSupply_,
        address initialRecipient,
        address roleAuthority_,
        address transferPolicy_,
        address owner_
    ) external initializer {
        if (owner_ == address(0)) revert InvalidOwner(owner_);
        if (roleAuthority_ == address(0) || roleAuthority_.code.length == 0) {
            revert InvalidRoleAuthority(roleAuthority_);
        }
        if (initialSupply > 0 && initialRecipient == address(0)) {
            revert InvalidInitialRecipient(initialRecipient);
        }
        if (maxSupply_ == 0) revert InvalidMaxSupply(maxSupply_);
        if (initialSupply > maxSupply_) revert MaxSupplyExceeded(0, initialSupply, maxSupply_);

        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);
        __ERC20Pausable_init();
        __Ownable_init(owner_);
        __Ownable2Step_init();

        CommunityTokenStorage storage $ = _getCommunityTokenStorage();
        $.roleAuthority = IAccessControl(roleAuthority_);
        _setMaxSupply($, maxSupply_);
        _setTransferPolicy($, transferPolicy_);

        if (initialSupply > 0) {
            _mint(initialRecipient, initialSupply);
        }
    }

    /// @notice Repoints this module to a replacement role authority.
    /// @dev Configure and verify all roles on the replacement first, then update every village module in one
    /// coordinated owner/Safe migration. Adding a role never requires changing the authority address. Only contract
    /// code is validated here; an incompatible authority can make all role-gated operations revert.
    /// @param newAuthority Replacement VillageAccess-compatible contract.
    function setRoleAuthority(address newAuthority) external onlyOwner {
        if (newAuthority == address(0) || newAuthority.code.length == 0) {
            revert InvalidRoleAuthority(newAuthority);
        }

        CommunityTokenStorage storage $ = _getCommunityTokenStorage();
        address oldAuthority = address($.roleAuthority);
        $.roleAuthority = IAccessControl(newAuthority);
        emit RoleAuthorityChanged(oldAuthority, newAuthority);
    }

    /// @notice Sets the optional transfer policy; the zero address explicitly disables policy checks.
    /// @dev The new policy takes effect immediately for transfers, mints, and burns and must advertise ITransferPolicy
    /// through ERC-165. Callable by the owner or VillageAccess default admin, including while paused.
    /// @param newPolicy Replacement policy, or the zero address to disable policy checks.
    function setTransferPolicy(address newPolicy) external onlyOwnerOrRole(VillageRoles.DEFAULT_ADMIN_ROLE) {
        _setTransferPolicy(_getCommunityTokenStorage(), newPolicy);
    }

    /// @notice Returns the external authority currently queried for village roles.
    function roleAuthority() public view returns (IAccessControl) {
        return _getCommunityTokenStorage().roleAuthority;
    }

    /// @notice Returns the active transfer policy, or the zero-address interface when checks are disabled.
    function transferPolicy() public view returns (ITransferPolicy) {
        return _getCommunityTokenStorage().transferPolicy;
    }

    /// @notice Returns the owner-governed ceiling enforced for the token's total supply.
    /// @dev A zero storage value can exist only on proxies upgraded from the pre-cap implementation and is treated
    /// as unlimited until the owner explicitly configures a ceiling. New proxies must initialize a nonzero ceiling.
    function maxSupply() public view returns (uint256) {
        uint256 configuredMaxSupply = _getCommunityTokenStorage().maxSupply;
        return configuredMaxSupply == 0 ? type(uint256).max : configuredMaxSupply;
    }

    /// @notice Changes the token-wide minting ceiling.
    /// @dev The ceiling may be raised or lowered, but never to zero or below the current total supply.
    /// @param newMaxSupply New supply ceiling in the token's smallest unit.
    function setMaxSupply(uint256 newMaxSupply) external onlyOwner {
        _setMaxSupply(_getCommunityTokenStorage(), newMaxSupply);
    }

    /// @notice Mints tokens to an account under MINTER_ROLE authorization.
    /// @param account Recipient of the minted tokens.
    /// @param amount Amount in the token's smallest unit.
    function mint(address account, uint256 amount) external onlyRole(VillageRoles.MINTER_ROLE) {
        _mint(account, amount);
    }

    /// @notice Burns tokens from the caller's balance.
    /// @param amount Amount in the token's smallest unit.
    function burn(uint256 amount) external {
        _burn(_msgSender(), amount);
    }

    /// @notice Burns tokens from an account after spending the caller's allowance.
    /// @param account Account whose balance and allowance are reduced.
    /// @param amount Amount in the token's smallest unit.
    function burnFrom(address account, uint256 amount) external {
        _spendAllowance(account, _msgSender(), amount);
        _burn(account, amount);
    }

    /// @notice Burns tokens from an account without allowance under MINTER_ROLE authorization.
    /// @param account Account whose balance is reduced.
    /// @param amount Amount in the token's smallest unit.
    function burnFromByRole(address account, uint256 amount) external onlyRole(VillageRoles.MINTER_ROLE) {
        _burn(account, amount);
    }

    /// @notice Pauses transfers, minting, and burning.
    /// @dev Callable by the owner or VillageAccess default admin.
    function pause() external onlyOwnerOrRole(VillageRoles.DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /// @notice Resumes transfers, minting, and burning.
    /// @dev Callable by the owner or VillageAccess default admin.
    function unpause() external onlyOwnerOrRole(VillageRoles.DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    modifier onlyRole(bytes32 role) {
        _checkRole(role);
        _;
    }

    modifier onlyOwnerOrRole(bytes32 role) {
        address sender = _msgSender();
        if (sender != owner() && !roleAuthority().hasRole(role, sender)) {
            revert Unauthorized(sender, role);
        }
        _;
    }

    function _checkRole(bytes32 role) internal view {
        address sender = _msgSender();
        if (!roleAuthority().hasRole(role, sender)) {
            revert Unauthorized(sender, role);
        }
    }

    /// @dev UUPS implementation upgrades remain an ownership-only action, independent of operational roles.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @dev Runs the optional policy before OpenZeppelin applies pausing checks and changes balances. Policy reverts are
    /// propagated; a false result is normalized to TransferBlockedByPolicy. Zero `from`/`to` values represent mint/burn.
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20Upgradeable, ERC20PausableUpgradeable) {
        if (from == address(0)) {
            uint256 currentSupply = totalSupply();
            uint256 configuredMaxSupply = maxSupply();
            if (amount > configuredMaxSupply - currentSupply) {
                revert MaxSupplyExceeded(currentSupply, amount, configuredMaxSupply);
            }
        }

        ITransferPolicy policy = transferPolicy();
        if (address(policy) != address(0) && !policy.isTransferAllowed(address(this), _msgSender(), from, to, amount)) {
            revert TransferBlockedByPolicy(_msgSender(), from, to, amount);
        }

        super._update(from, to, amount);
    }

    function _setTransferPolicy(CommunityTokenStorage storage $, address newPolicy) internal {
        if (
            newPolicy != address(0) &&
            (newPolicy.code.length == 0 ||
                !ERC165Checker.supportsInterface(newPolicy, type(ITransferPolicy).interfaceId))
        ) {
            revert InvalidTransferPolicy(newPolicy);
        }
        address oldPolicy = address($.transferPolicy);
        $.transferPolicy = ITransferPolicy(newPolicy);
        emit TransferPolicyChanged(oldPolicy, newPolicy);
    }

    function _setMaxSupply(CommunityTokenStorage storage $, uint256 newMaxSupply) internal {
        if (newMaxSupply == 0) revert InvalidMaxSupply(newMaxSupply);
        uint256 currentSupply = totalSupply();
        if (newMaxSupply < currentSupply) revert MaxSupplyBelowCurrentSupply(newMaxSupply, currentSupply);
        uint256 oldMaxSupply = $.maxSupply;
        $.maxSupply = newMaxSupply;
        emit MaxSupplyChanged(oldMaxSupply, newMaxSupply);
    }

    function _getCommunityTokenStorage() private pure returns (CommunityTokenStorage storage $) {
        uint256 storageLocation = erc7201("closer.storage.CommunityToken");
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            $.slot := storageLocation
        }
    }
}
