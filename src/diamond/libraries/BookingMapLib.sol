// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

library BookingMapLib {
    using EnumerableMap for EnumerableMap.Bytes32ToUintMap;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    enum BookingStatus {
        Pending,
        Confirmed,
        CheckedIn,
        CheckedOut
    }

    struct Booking {
        BookingStatus status;
        uint16 year;
        uint16 dayOfYear;
        uint256 price;
        uint256 timestamp;
    }

    struct UserStore {
        mapping(uint16 => uint16) nights;
        mapping(uint16 => uint256) balance;
        mapping(uint16 => EnumerableMap.Bytes32ToUintMap) dates;
        mapping(bytes32 => Booking) bookings;
        // TODO: still not in use but added here to optimize proofOfPresence calculations
        mapping(uint16 => uint16) checkedInNights;
    }

    struct Year {
        uint16 number;
        bool leapYear;
        uint256 start;
        uint256 end;
        bool enabled;
    }

    struct YearsStore {
        EnumerableSet.Bytes32Set _inner;
        mapping(bytes32 => Year) elems;
    }

    function checkedInNightsOn(UserStore storage store, uint16 year_) internal view returns (uint16) {
        Booking[] memory localList = list(store, year_);
        uint16 acc;
        for (uint256 i; i < localList.length; i++) {
            if (localList[i].status == BookingMapLib.BookingStatus.CheckedIn) {
                acc++;
            }
        }
        return acc;
    }

    function add(UserStore storage store, Booking memory booking) internal returns (bool) {
        bytes32 key = _buildKey(booking.year, booking.dayOfYear);
        if (store.dates[booking.year].set(key, booking.timestamp)) {
            store.balance[booking.year] += booking.price;
            store.bookings[key] = booking; //Booking(booking.price, booking.timestamp);
            store.nights[booking.year] += uint16(1);
            return true;
        }
        return false;
    }

    function get(UserStore storage store, uint16 _year, uint16 dayOfYear) internal view returns (bool, Booking memory) {
        bytes32 key = _buildKey(_year, dayOfYear);
        if (store.dates[_year].contains(key)) {
            return (true, store.bookings[key]);
        }
        return (false, Booking(BookingStatus.Pending, 0, 0, 0, 0));
    }

    function getBalance(UserStore storage store, uint16 _year) internal view returns (uint256) {
        return store.balance[_year];
    }

    function getNights(UserStore storage store, uint16 _year) internal view returns (uint256) {
        return store.nights[_year];
    }

    function list(UserStore storage store, uint16 _year) internal view returns (Booking[] memory) {
        Booking[] memory bookings = new Booking[](store.dates[_year].length());
        for (uint256 i; i < store.dates[_year].length(); i++) {
            (bytes32 key, ) = store.dates[_year].at(i);
            bookings[i] = store.bookings[key];
        }
        return bookings;
    }

    function remove(UserStore storage store, uint16 _year, uint16 _dayOfYear) internal returns (bool, Booking memory) {
        bytes32 key = _buildKey(_year, _dayOfYear);
        if (store.dates[_year].remove(key)) {
            Booking memory booking = store.bookings[key];
            store.balance[_year] -= booking.price;
            store.nights[_year] -= uint16(1);
            delete store.bookings[key];
            return (true, booking);
        }
        return (false, Booking(BookingStatus.Pending, 0, 0, 0, 0));
    }

    function updateStatus(
        UserStore storage store,
        uint16 _year,
        uint16 _dayOfYear,
        BookingStatus _status
    ) internal returns (bool) {
        bytes32 key = _buildKey(_year, _dayOfYear);
        if (store.dates[_year].contains(key)) {
            Booking memory booking = store.bookings[key];
            booking.status = _status;
            store.bookings[key] = booking;
            return true;
        }
        return false;
    }

    function _buildKey(uint16 year, uint16 dayOfYear) internal pure returns (bytes32) {
        return bytes32(abi.encodePacked(year, dayOfYear));
    }

    // ==========================================================
    // Years
    // ==========================================================
    function buildTimestamp(
        YearsStore storage _years,
        uint16 yearNum,
        uint16 dayOfTheYear
    ) internal view returns (bool, uint256) {
        (bool found, Year memory year) = get(_years, yearNum);
        if (found && year.enabled) {
            uint256 day;

            if (year.leapYear) {
                day = (year.end - year.start) / 366;
            } else {
                day = (year.end - year.start) / 365;
            }
            return (true, year.start + (day * (dayOfTheYear - 1)) + (day / 2));
        }
        return (false, uint256(0));
    }

    function buildBooking(
        YearsStore storage _years,
        BookingStatus status,
        uint16 yearNum,
        uint16 dayOfTheYear,
        uint256 price
    ) internal view returns (bool, Booking memory) {
        (bool success, uint256 tm) = buildTimestamp(_years, yearNum, dayOfTheYear);
        if (success) {
            return (true, Booking(status, yearNum, dayOfTheYear, price, tm));
        }
        return (false, Booking(BookingStatus.Pending, 0, 0, 0, 0));
    }

    /// YearsStore -------------------------------------------

    function length(YearsStore storage store) internal view returns (uint256) {
        return store._inner.length();
    }

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
        return (false, Year(0, false, 0, 0, false));
    }

    function remove(YearsStore storage store, uint16 num) internal returns (bool) {
        bytes32 k = _buildYearKey(num);
        if (store._inner.remove(k)) {
            delete store.elems[k];
            return true;
        }
        return false;
    }

    function contains(YearsStore storage store, uint16 num) internal view returns (bool) {
        bytes32 k = _buildYearKey(num);
        return store._inner.contains(k);
    }

    function update(YearsStore storage store, Year memory _year) internal returns (bool) {
        bytes32 k = _buildYearKey(_year.number);
        if (store._inner.contains(k)) {
            store.elems[k] = _year;
            return true;
        }
        return false;
    }

    // function length

    function _buildYearKey(uint16 num) internal pure returns (bytes32) {
        return bytes32(abi.encodePacked(num));
    }
}
