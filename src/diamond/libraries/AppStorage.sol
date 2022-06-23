// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;
import "hardhat-deploy/solc_0.8/diamond/libraries/LibDiamond.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../libraries/BookingMapLib.sol";
import "../libraries/StakeManagerLib.sol";

struct Deposit {
    uint256 timestamp;
    uint256 amount;
}

struct AppStorage {
    IERC20 tdfToken;
    // ProofOfPressence
    mapping(address => BookingMapLib.UserStore) _bookings;
    BookingMapLib.YearsStore _years;
    // TokenLock
    mapping(address => uint256) _balances;
    mapping(address => Deposit[]) _deposits;
    uint256 lockingPeriod;
    // General
    bool paused;
    bool initialized;
}

library LibAppStorage {
    function diamondStorage() internal pure returns (AppStorage storage ds) {
        assembly {
            ds.slot := 0
        }
    }
}

contract Modifiers {
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
}
