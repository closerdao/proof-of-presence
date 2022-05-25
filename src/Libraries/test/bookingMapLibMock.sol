// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;

import "../BookingMapLib.sol";

contract BookingMapLibMock {
    using BookingMapLib for BookingMapLib.UserStore;
    using BookingMapLib for BookingMapLib.YearsStore;

    mapping(address => BookingMapLib.UserStore) internal _bookings;
    BookingMapLib.YearsStore internal _years;

    event OperationResult(bool success);

    constructor() {
        _years.add(BookingMapLib.Year(2022, false, 1640995200, 1672531199));
        _years.add(BookingMapLib.Year(2023, false, 1672531200, 1704067199));
        _years.add(BookingMapLib.Year(2024, true, 1704067200, 1735689599));
        _years.add(BookingMapLib.Year(2025, false, 1735689600, 1767225599));
    }

    function book(
        address _user,
        uint16 _year,
        uint16 _dayYear
    ) public {
        bool result = _bookings[_user].add(BookingMapLib.Booking(_year, _dayYear, 1 ether, block.timestamp));
        emit OperationResult(result);
    }

    function getBooking(
        address _user,
        uint16 _year,
        uint16 _dayYear
    ) public view returns (bool, BookingMapLib.Booking memory) {
        return _bookings[_user].get(_year, _dayYear);
    }

    function getBookings(address _user, uint16 _year) public view returns (BookingMapLib.Booking[] memory) {
        return _bookings[_user].list(_year);
    }

    function remove(
        address _user,
        uint16 _year,
        uint16 _dayOfYear
    ) public {
        (bool res, ) = _bookings[_user].remove(_year, _dayOfYear);
        emit OperationResult(res);
    }

    function addYear(
        uint16 number,
        bool leapYear,
        uint256 start,
        uint256 end
    ) public {
        bool res = _years.add(BookingMapLib.Year(number, leapYear, start, end));
        emit OperationResult(res);
    }

    function getYears() public view returns (BookingMapLib.Year[] memory) {
        return _years.values();
    }

    function getYear(uint16 number) public view returns (bool, BookingMapLib.Year memory) {
        return _years.get(number);
    }

    function removeYear(uint16 number) public {
        bool res = _years.remove(number);
        emit OperationResult(res);
    }

    function containsYear(uint16 number) public view returns (bool) {
        return _years.contains(number);
    }

    function updateYear(
        uint16 number,
        bool leapYear,
        uint256 start,
        uint256 end
    ) public {
        bool res = _years.update(BookingMapLib.Year(number, leapYear, start, end));
        emit OperationResult(res);
    }

    function buildTimestamp(uint16 yearNum, uint16 dayOfTheYear) public view returns (uint256) {
        (bool success, uint256 value) = _years.buildTimestamp(yearNum, dayOfTheYear);
        require(success, "Unable to build Timestamp");
        return value;
    }

    function buildBooking(
        uint16 yearNum,
        uint16 dayOfTheYear,
        uint256 price
    ) public view returns (BookingMapLib.Booking memory) {
        (bool success, BookingMapLib.Booking memory value) = _years.buildBooking(yearNum, dayOfTheYear, price);
        require(success, "Unable to build Booking");

        return value;
    }
}
