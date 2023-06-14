// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;
import "hardhat-deploy/solc_0.8/diamond/libraries/LibDiamond.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/access/IAccessControl.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "../libraries/BookingMapLib.sol";
import "../libraries/AccessControlLib.sol";
import "../libraries/MembershipLib.sol";
import "../libraries/StakeLibV2.sol";

// when upgrading AppStorage add new state vars to the end of the struct
// structs can only be upgraded if they are referred to within AppStorage by a mapping
struct AppStorage {
    bool initialized;
    // execution
    bool paused;
    // The ERC!!
    IERC20 communityToken;
    // Roles; the AccessControlLib.RoleStore struct can be upgraded
    AccessControlLib.RoleStore _roleStore;
    // Booking; the BookingMapLib.UserStore struct can be upgraded
    // BookingMapLib.YearsStore cannot be upgraded
    mapping(address => BookingMapLib.UserStore) _accommodationBookings;
    BookingMapLib.YearsStore _accommodationYears;
    // Stake; the OrderedStakeLib.Store struct can be upgraded
    mapping(address => OrderedStakeLib.Store) staking;
    // Members; the MembershipLib.Store struct cannot be upgraded
    MembershipLib.Store members;
}

library LibAppStorage {
    function diamondStorage() internal pure returns (AppStorage storage ds) {
        assembly {
            ds.slot := 0
        }
    }
}

contract Modifiers {
    using AccessControlLib for AccessControlLib.RoleStore;
    using MembershipLib for MembershipLib.Store;
    using StakeLibV2 for StakeLibV2.Context;
    using BookingMapLib for BookingMapLib.UserStore;
    using BookingMapLib for BookingMapLib.YearsStore;

    AppStorage internal s;

    modifier onlyOwner() {
        LibDiamond.enforceIsContractOwner();
        _;
    }

    modifier whenNotInitalized() {
        if (s.initialized) {
            revert("Already initialized");
        }
        _;
    }

    /**
     * @dev Modifier that checks that an account has a specific role. Reverts
     * with a standardized message including the required role.
     *
     * The format of the revert reason is given by the following regular expression:
     *
     *  /^AccessControl: account (0x[0-9a-f]{40}) is missing role (0x[0-9a-f]{64})$/
     *
     * _Available since v4.1._
     */
    modifier onlyRole(bytes32 role) {
        s._roleStore.checkRole(role);
        _;
    }

    /**
     * @dev Modifier to make a function callable only when the contract is not paused.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    modifier whenNotPaused() {
        _requireNotPaused();
        _;
    }

    /**
     * @dev Modifier to make a function callable only when the contract is paused.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    modifier whenPaused() {
        _requirePaused();
        _;
    }

    modifier onlyMember() {
        _requireMember(_msgSender());
        _;
    }

    function _requireMember(address account) internal view {
        require(_isMember(account), "Membership: only members allowed");
    }

    function _isMember(address account) internal view returns (bool) {
        return s.members.contains(account);
    }

    /**
     * @dev Throws if the contract is paused.
     */
    function _requireNotPaused() internal view virtual {
        require(!s.paused, "Pausable: paused");
    }

    /**
     * @dev Throws if the contract is not paused.
     */
    function _requirePaused() internal view virtual {
        require(s.paused, "Pausable: not paused");
    }

    function _stakeLibContext(address account) internal view returns (StakeLibV2.Context memory) {
        return
            StakeLibV2.Context({account: account, token: s.communityToken, requiredBalance: _expectedStaked(account)});
    }

    function _stakeLibBookingContext(address account, uint16 year_)
        internal
        view
        returns (StakeLibV2.BookingContext memory)
    {
        (, BookingMapLib.Year memory year) = s._accommodationYears.get(year_);
        return
            StakeLibV2.BookingContext({
                account: account,
                token: s.communityToken,
                requiredBalance: _expectedStaked(account),
                initYearTm: year.start,
                endYearTm: year.end
            });
    }

    function _expectedStaked(address account) internal view returns (uint256) {
        uint256 max;
        BookingMapLib.Year[] memory _yearList = s._accommodationYears.values();
        for (uint16 i = 0; i < _yearList.length; i++) {
            // TODO: should it be + 1 year?
            if (_yearList[i].end < block.timestamp) continue;
            uint256 amount = s._accommodationBookings[account].getBalance(_yearList[i].number);
            if (amount > max) max = amount;
        }
        return max;
    }

    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }
}
