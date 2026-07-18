// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @title Village UUPS proxy
/// @author Closer DAO
/// @notice ERC-1967 proxy used for Village UUPS deployments.
/// @dev This project-owned wrapper intentionally adds no state or upgrade behavior.
/// It provides a stable artifact for the shared Ignition deployment modules.
/// UUPS upgrade logic and authorization remain in each implementation contract.
contract VillageUUPSProxy is ERC1967Proxy {
    /// @notice Deploys a proxy and optionally initializes it in the same transaction.
    /// @dev Production deployments should always provide initializer calldata; empty `data` leaves the proxy
    /// uninitialized and its public initializer available to another account.
    /// @param implementation Initial UUPS implementation.
    /// @param data Initialization calldata delegate-called atomically by ERC1967Proxy; an empty value skips the call.
    constructor(address implementation, bytes memory data) ERC1967Proxy(implementation, data) {}
}
