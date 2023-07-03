// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

/******************************************************************************\
* Author: Nick Mudge <nick@perfectabstractions.com> (https://twitter.com/mudgen)
* EIP-2535 Diamonds: https://eips.ethereum.org/EIPS/eip-2535
*
* Implementation of a diamond.
/******************************************************************************/

import {LibDiamond} from "hardhat-deploy/solc_0.8/diamond/libraries/LibDiamond.sol";
import {AppStorage, LibAppStorage, IERC20, Modifiers} from "../libraries/AppStorage.sol";
import {IDiamondLoupe} from "hardhat-deploy/solc_0.8/diamond/interfaces/IDiamondLoupe.sol";
import {IDiamondCut} from "hardhat-deploy/solc_0.8/diamond/interfaces/IDiamondCut.sol";
import {IERC173} from "hardhat-deploy/solc_0.8/diamond/interfaces/IERC173.sol";
import {IERC165} from "hardhat-deploy/solc_0.8/diamond/interfaces/IERC165.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import "../libraries/BookingMapLib.sol";
import "../libraries/AccessControlLib.sol";
import "../libraries/MembershipLib.sol";

// It is expected that this contract is customized if you want to deploy your diamond
// with data from a deployment script. Use the init function to initialize state variables
// of your diamond. Add parameters to the init funciton if you need to.

contract DiamondInit is Modifiers {
    using BookingMapLib for BookingMapLib.YearsStore;
    using AccessControlLib for AccessControlLib.RoleStore;
    using MembershipLib for MembershipLib.Store;

    // You can add parameters to this function in order to pass in
    // data to set your own state variables
    function init(address token, address _treasury) external onlyOwner whenNotInitalized {
        // adding ERC165 data
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.supportedInterfaces[type(IERC165).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondCut).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondLoupe).interfaceId] = true;
        ds.supportedInterfaces[type(IERC173).interfaceId] = true;
        ds.supportedInterfaces[type(IAccessControl).interfaceId] = true;

        s.communityToken = IERC20(token);
        s.tdfTreasury = _treasury;
        // TODO: disable all years except current
        s._accommodationYears.add(
            BookingMapLib.Year({number: 2022, leapYear: false, start: 1640995200, end: 1672531199, enabled: true})
        );
        s._accommodationYears.add(
            BookingMapLib.Year({number: 2023, leapYear: false, start: 1672531200, end: 1704067199, enabled: true})
        );
        s._accommodationYears.add(
            BookingMapLib.Year({number: 2024, leapYear: true, start: 1704067200, end: 1735689599, enabled: true})
        );
        s._accommodationYears.add(
            BookingMapLib.Year({number: 2025, leapYear: false, start: 1735689600, end: 1767225599, enabled: true})
        );
        s._accommodationYears.add(
            BookingMapLib.Year({number: 2026, leapYear: false, start: 1767225600, end: 1798761599, enabled: true})
        );
        s._accommodationYears.add(
            BookingMapLib.Year({number: 2027, leapYear: false, start: 1798761600, end: 1830297599, enabled: true})
        );
        s._accommodationYears.add(
            BookingMapLib.Year({number: 2028, leapYear: true, start: 1830297600, end: 1861919999, enabled: true})
        );
        s._accommodationYears.add(
            BookingMapLib.Year({number: 2029, leapYear: false, start: 1861920000, end: 1893455999, enabled: true})
        );
        s._accommodationYears.add(
            BookingMapLib.Year({number: 2030, leapYear: false, start: 1893456000, end: 1924991999, enabled: true})
        );

        s._roleStore.grantRole(AccessControlLib.DEFAULT_ADMIN_ROLE, msg.sender);
        s._roleStore.grantRole(AccessControlLib.MINTER_ROLE, msg.sender);
        s._roleStore.grantRole(AccessControlLib.BOOKING_MANAGER_ROLE, msg.sender);
        s._roleStore.grantRole(AccessControlLib.STAKE_MANAGER_ROLE, msg.sender);
        s._roleStore.grantRole(AccessControlLib.VAULT_MANAGER_ROLE, msg.sender);
        s._roleStore.grantRole(AccessControlLib.MEMBERSHIP_MANAGER_ROLE, msg.sender);

        s.members.add(msg.sender);
        // Set the contract as initialized
        s.initialized = true;

        // add your own state variables
        // EIP-2535 specifies that the `diamondCut` function takes two optional
        // arguments: address _init and bytes calldata _calldata
        // These arguments are used to execute an arbitrary function using delegatecall
        // in order to set state variables in the diamond during deployment or an upgrade
        // More info here: https://eips.ethereum.org/EIPS/eip-2535#diamond-interface
    }
}
