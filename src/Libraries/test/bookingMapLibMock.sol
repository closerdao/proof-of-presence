// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;

import "../BookingMapLib.sol";

contract BookingMapLibMock {
    using BookingMapLib for BookingMapLib.Bookings;

    mapping(address => BookingMapLib.Bookings) internal _bookings;
    BookingMapLib.Years internal _years;

    event OperationResult(bool success);

    constructor() {
        _years.list.push(BookingMapLib.Year(2022, false, 1640995200, 1672531199));
        _years.list.push(BookingMapLib.Year(2023, false, 1672531200, 1704067199));
        _years.list.push(BookingMapLib.Year(2024, true, 1704067200, 1735689599));
        _years.list.push(BookingMapLib.Year(2025, false, 1735689600, 1767225599));
    }

    function book(
        address _user,
        uint16 _year,
        uint16 _dayYear
    ) public {
        _bookings[_user].set(BookingMapLib.BookingInput(_year, _dayYear, 1 ether, block.timestamp));
        emit OperationResult(true);
    }

    function getBooking(
        address _user,
        uint16 _year,
        uint16 _dayYear
    ) public view returns (bool, BookingMapLib.Booking memory) {
        return _bookings[_user].get(_year, _dayYear);
    }
}
