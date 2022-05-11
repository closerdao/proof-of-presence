// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;

library BookingLib {
    struct Booking {
        uint256 cost;
    }

    struct YearlyBookings {
        uint16 year;
        uint256[] dates;
        mapping(uint256 => Booking) bookings;
    }

    struct Year {
        uint16 number;
        uint256 start;
        uint256 end;
    }

    function _add(YearlyBookings storage map, uint256[] memory dates) internal {}
}
