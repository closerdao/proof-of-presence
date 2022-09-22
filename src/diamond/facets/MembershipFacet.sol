// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import {LibDiamond} from "hardhat-deploy/solc_0.8/diamond/libraries/LibDiamond.sol";
import {Modifiers} from "../libraries/AppStorage.sol";
import "../libraries/AccessControlLib.sol";
import "../libraries/MembershipLib.sol";

contract MembershipFacet is Modifiers {
    using MembershipLib for MembershipLib.Store;

    event MemberAdded(address account, address executer);
    event MemberRemoved(address account, address executer);

    function addMember(address account) public onlyRole(AccessControlLib.MEMBERSHIP_MANAGER_ROLE) {
        require(s.members.add(account), "MembershipFacet: member exists");
        emit MemberAdded(account, _msgSender());
    }

    function removeMember(address account) public onlyRole(AccessControlLib.MEMBERSHIP_MANAGER_ROLE) {
        require(s.members.remove(account), "MembershipFacet: member does not exists");
        emit MemberRemoved(account, _msgSender());
    }

    function isMember(address account) public view returns (bool) {
        return s.members.contains(account);
    }

    function membersLength() public view returns (uint256) {
        return s.members.length();
    }

    function memberAt(uint256 index_) public view returns (address) {
        return s.members.at(index_);
    }

    function memberList() public view returns (address[] memory) {
        return s.members.values();
    }
}
