// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title Village role identifiers
/// @author Closer DAO
/// @notice Shared role IDs used by the standalone village modules.
/// @dev Defining the IDs once prevents role-name drift between the authority, contracts, and deployment tooling.
library VillageRoles {
    /// @notice Root governance role used for role administration and selected emergency actions.
    /// @dev This is OpenZeppelin's conventional default-admin role ID.
    bytes32 internal constant DEFAULT_ADMIN_ROLE = 0x00;

    /// @notice Authorizes CommunityToken minting and role-based burns.
    bytes32 internal constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Authorizes managed booking cancellation and point-token minting and burning.
    bytes32 internal constant BOOKING_MANAGER_ROLE = keccak256("BOOKING_MANAGER_ROLE");

    /// @notice Authorizes booking-platform operators to mint and burn point tokens.
    bytes32 internal constant BOOKING_PLATFORM_ROLE = keccak256("BOOKING_PLATFORM_ROLE");
}
