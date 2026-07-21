// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

/// @dev Deliberately unsafe test implementation used only by storage-layout validation tests.
contract CommunityTokenIncompatibleUpgradeMock is
    Initializable,
    ERC20Upgradeable,
    ERC20PermitUpgradeable,
    ERC20PausableUpgradeable,
    Ownable2StepUpgradeable,
    UUPSUpgradeable
{
    /**
     * The production namespace starts with two contract-address fields. Changing the
     * first field to uint256 must be rejected before an upgrade can be prepared.
     * @custom:storage-location erc7201:closer.storage.CommunityToken
     */
    struct IncompatibleCommunityTokenStorage {
        uint256 roleAuthority;
        address transferPolicy;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        __ERC20_init("Incompatible", "BAD");
        __ERC20Permit_init("Incompatible");
        __ERC20Pausable_init();
        __Ownable_init(owner_);
        __Ownable2Step_init();
    }

    function incompatibleValue() external view returns (uint256) {
        return _getIncompatibleStorage().roleAuthority;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20Upgradeable, ERC20PausableUpgradeable) {
        super._update(from, to, amount);
    }

    function _getIncompatibleStorage() private pure returns (IncompatibleCommunityTokenStorage storage $) {
        uint256 storageLocation = erc7201("closer.storage.CommunityToken");
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            $.slot := storageLocation
        }
    }
}
