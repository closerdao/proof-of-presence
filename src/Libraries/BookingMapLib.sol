// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;

import "../Libraries/EnumerableMapLib.sol";
import "hardhat/console.sol";

library BookingMapLib {
    using EnumerableMapLib for EnumerableMapLib.Bytes32ToUintMap;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    struct Booking {
        uint16 year;
        uint16 dayOfYear;
        uint256 price;
        uint256 timestamp;
    }

    struct UserStore {
        mapping(uint16 => uint256) balance;
        mapping(uint16 => EnumerableMapLib.Bytes32ToUintMap) dates;
        mapping(bytes32 => Booking) bookings;
    }
    struct Year {
        uint16 number;
        bool leapYear;
        uint256 start;
        uint256 end;
    }
    struct YearsStore {
        EnumerableSet.Bytes32Set _inner;
        mapping(bytes32 => Year) elems;
    }

    function set(UserStore storage store, Booking memory booking) internal returns (bool) {
        bytes32 key = _buildKey(booking.year, booking.dayOfYear);
        if (store.dates[booking.year].set(_buildKey(booking.year, booking.dayOfYear), booking.timestamp)) {
            store.balance[booking.year] += booking.price;
            store.bookings[key] = booking; //Booking(booking.price, booking.timestamp);
            return true;
        }
        return false;
    }

    function get(
        UserStore storage store,
        uint16 _year,
        uint16 dayOfYear
    ) internal view returns (bool, Booking memory) {
        bytes32 key = _buildKey(_year, dayOfYear);
        if (store.dates[_year].contains(key)) {
            return (true, store.bookings[key]);
        }
        return (false, Booking(0, 0, 0, 0));
    }

    function list(UserStore storage store, uint16 _year) internal view returns (Booking[] memory) {
        Booking[] memory bookings = new Booking[](store.dates[_year].length());
        for (uint256 i; i < store.dates[_year].length(); i++) {
            (bytes32 key, ) = store.dates[_year].at(i);
            bookings[i] = store.bookings[key];
        }
        return bookings;
    }

    function remove(
        UserStore storage store,
        uint16 _year,
        uint16 _dayOfYear
    ) internal returns (bool, Booking memory) {
        bytes32 key = _buildKey(_year, _dayOfYear);
        if (store.dates[_year].remove(key)) {
            Booking memory booking = store.bookings[key];
            store.balance[_year] -= booking.price;
            delete store.bookings[key];
            return (true, booking);
        }
        return (false, Booking(0, 0, 0, 0));
    }

    function _buildKey(uint16 year, uint16 dayOfYear) internal pure returns (bytes32) {
        return bytes32(abi.encodePacked(year, dayOfYear));
    }

    /// YearsStore -------------------------------------------

    function add(YearsStore storage store, Year memory _year) internal returns (bool) {
        bytes32 k = _buildYearKey(_year.number);
        if (store._inner.add(k)) {
            store.elems[k] = _year;
            return true;
        }
        return false;
    }

    function values(YearsStore storage store) internal view returns (Year[] memory) {
        bytes32[] memory ks = store._inner.values();
        Year[] memory elems = new Year[](ks.length);
        for (uint256 i; i < ks.length; i++) {
            elems[i] = store.elems[ks[i]];
        }
        return elems;
    }

    function get(YearsStore storage store, uint16 num) internal view returns (bool, Year memory) {
        bytes32 k = _buildYearKey(num);
        if (store._inner.contains(k)) {
            return (true, store.elems[k]);
        }
        return (false, Year(0, false, 0, 0));
    }

    // function remove
    // function update
    // function contains
    // function length
    // function values

    function _buildYearKey(uint16 num) internal pure returns (bytes32) {
        return bytes32(abi.encodePacked(num));
    }

    // function _buildTimestamp(
    //     YearsStore storage _years,
    //     uint16 yearNum,
    //     uint16 dayOfTheYear
    // ) internal view returns (uint256) {
    //     Year memory year = _getYear(_years, yearNum);
    //     uint256 day;

    //     if (year.leapYear) {
    //         day = (year.end - year.start) / 366;
    //     } else {
    //         day = (year.end - year.start) / 365;
    //     }
    //     return year.start + (day * (dayOfTheYear - 1)) + (day / 2);
    // }

    // function _getYearFromTm(YearsStore storage _years, uint256 tm) internal view returns (uint16) {
    //     for (uint16 i; i < _years.list.length; i++) {
    //         if (_years.list[i].start <= tm && _years.list[i].end >= tm) return _years.list[i].number;
    //     }
    //     return uint16(0);
    // }

    // function _getYear(YearsStore storage _years, uint16 number) internal view returns (Year memory) {
    //     Year memory year;
    //     for (uint8 i = 0; i < _years.list.length; i++) {
    //         if (_years.list[i].number == number) {
    //             year = _years.list[i];
    //             break;
    //         }
    //     }
    //     require(year.number == number && number > uint16(0), "year not found");
    //     return year;
    // }
}
