// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;

import "../Libraries/EnumerableMapLib.sol";

library BookingMapLib {
    using EnumerableMapLib for EnumerableMapLib.Bytes32ToUintMap;
    struct Booking {
        uint256 cost;
    }

    struct Bookings {
        mapping(uint16 => uint256) balance;
        mapping(uint16 => EnumerableMapLib.Bytes32ToUintMap) dates;
        mapping(bytes32 => Booking) bookings;
    }

    struct BookingInput {
        uint16 year;
        uint16 dayOfYear;
        uint256 price;
        uint256 timestamp;
    }

    function set(
        Bookings storage store,
        uint16 year,
        uint16 dayOfYear,
        uint16 price
    ) internal returns (bool) {
        uint256 tm = 1;
        bytes32 key = _buildKey(year, dayOfYear);
        if (store.dates[year].set(_buildKey(year, dayOfYear), tm)) {
            store.balance[year] += price;
            store.bookings[key] = Booking(price);
            return true;
        }
        return false;
    }

    function _buildKey(uint16 year, uint16 dayOfYear) internal pure returns (bytes32) {
        return bytes32(abi.encode(year, dayOfYear));
    }
}
