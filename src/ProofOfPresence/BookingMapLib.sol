// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;

library BookingMapLib {
    struct Booking {
        uint256 cost;
    }

    struct Bookings {
        uint256[] keys;
        mapping(uint256 => Booking) value;
    }

    struct YearBookings {
        mapping(uint16 => Bookings) values;
    }
}
