// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;

import "../BookingMapLib.sol";

contract BookingMapLibMock {
    using BookingMapLib for BookingMapLib.UserStore;

    mapping(address => BookingMapLib.UserStore) internal _bookings;
    BookingMapLib.YearsStore internal _years;

    event OperationResult(bool success);

    constructor() {
        // _years.list.push(BookingMapLib.Year(2022, false, 1640995200, 1672531199));
        // _years.list.push(BookingMapLib.Year(2023, false, 1672531200, 1704067199));
        // _years.list.push(BookingMapLib.Year(2024, true, 1704067200, 1735689599));
        // _years.list.push(BookingMapLib.Year(2025, false, 1735689600, 1767225599));
    }

    function book(
        address _user,
        uint16 _year,
        uint16 _dayYear
    ) public {
        bool result = _bookings[_user].set(BookingMapLib.Booking(_year, _dayYear, 1 ether, block.timestamp));
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
}
