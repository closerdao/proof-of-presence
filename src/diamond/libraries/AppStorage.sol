// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;
import {LibDiamond} from "./LibDiamond.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../../Libraries/BookingMapLib.sol";

struct Deposit {
    uint256 timestamp;
    uint256 amount;
}

struct AppStorage {
    IERC20 tdfToken;
    mapping(address => BookingMapLib.UserStore) _bookings;
    BookingMapLib.YearsStore _years;
    mapping(address => uint256) _balances;
    mapping(address => Deposit[]) _deposits;
    uint256 lockingPeriod;
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
}
