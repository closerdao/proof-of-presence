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
    struct Year {
        uint16 number;
        bool leapYear;
        uint256 start;
        uint256 end;
    }
    struct Years {
        Year[] list;
    }

    struct BookingInput {
        uint16 year;
        uint16 dayOfYear;
        uint256 price;
        uint256 timestamp;
    }

    function set(Bookings storage store, BookingInput memory booking) internal returns (bool) {
        bytes32 key = _buildKey(booking.year, booking.dayOfYear);
        if (store.dates[booking.year].set(_buildKey(booking.year, booking.dayOfYear), booking.timestamp)) {
            store.balance[booking.year] += booking.price;
            store.bookings[key] = Booking(booking.price);
            return true;
        }
        return false;
    }

    function get(
        Bookings storage store,
        uint16 _year,
        uint16 dayOfYear
    ) internal view returns (bool, Booking memory) {
        bytes32 key = _buildKey(_year, dayOfYear);
        if (store.dates[_year].contains(key)) {
            return (true, store.bookings[key]);
        }
        return (false, Booking(0));
    }

    function _buildKey(uint16 year, uint16 dayOfYear) internal pure returns (bytes32) {
        return bytes32(abi.encode(year, dayOfYear));
    }

    function _buildTimestamp(
        Years storage _years,
        uint16 yearNum,
        uint16 dayOfTheYear
    ) internal view returns (uint256) {
        Year memory year = _getYear(_years, yearNum);
        uint256 day;

        if (year.leapYear) {
            day = (year.end - year.start) / 366;
        } else {
            day = (year.end - year.start) / 365;
        }
        return year.start + (day * (dayOfTheYear - 1)) + (day / 2);
    }

    function _getYearNum(Years storage _years, uint256 tm) internal view returns (uint16) {
        for (uint16 i; i < _years.list.length; i++) {
            if (_years.list[i].start <= tm && _years.list[i].end >= tm) return _years.list[i].number;
        }
        return uint16(0);
    }

    function _getYear(Years storage _years, uint16 number) internal view returns (Year memory) {
        Year memory year;
        for (uint8 i = 0; i < _years.list.length; i++) {
            if (_years.list[i].number == number) {
                year = _years.list[i];
                break;
            }
        }
        require(year.number == number && number > uint16(0), "year not found");
        return year;
    }
}
