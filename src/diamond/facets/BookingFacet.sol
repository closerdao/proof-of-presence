// SPDX-License-Identifier: AGPL-1.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Context.sol";
import "../libraries/BookingMapLib.sol";
import "../libraries/AppStorage.sol";

contract BookingFacet is Modifiers {
    using StakeLibV2 for StakeLibV2.Context;
    using StakeLibV2 for StakeLibV2.BookingContext;
    using BookingMapLib for BookingMapLib.UserStore;
    using BookingMapLib for BookingMapLib.YearsStore;

    event NewBookings(address account, uint16[2][] bookings);
    event CanceledBookings(address account, uint16[2][] bookings);
    event BookingConfirmed(address executer, address account, uint16[2][] bookings);
    event BookingCheckedIn(address executer, address account, uint16[2][] bookings);
    event BookingCheckedOut(address executer, address account, uint16[2][] bookings, uint256 presenceMinted);

    event YearAdded(uint16 number, bool leapYear, uint256 start, uint256 end, bool enabled);
    event YearRemoved(uint16 number);
    event YearUpdated(uint16 number, bool leapYear, uint256 start, uint256 end, bool enabled);

    // TODO: add preview Booking action

    function bookAccommodation(uint16[2][] calldata dates, uint256 price) external whenNotPaused {
        BookingMapLib.BookingStatus status = _isMember(_msgSender())
            ? BookingMapLib.BookingStatus.Confirmed
            : BookingMapLib.BookingStatus.Pending;
        for (uint256 i = 0; i < dates.length; i++) {
            BookingMapLib.Booking memory value = _insertBooking(status, _msgSender(), dates[i][0], dates[i][1], price);
            _stakeLibBookingContext(_msgSender(), dates[i][0]).handleBooking(
                s.staking[_msgSender()],
                price,
                value.timestamp
            );
        }
        emit NewBookings(_msgSender(), dates);
    }

    // TODO: Move to BookingMapLib
    function checkedInNightsByYearFor(address account_) public view returns (uint16[2][] memory) {
        BookingMapLib.Year[] memory yearList = s._accommodationYears.values();
        uint16[2][] memory acc = new uint16[2][](yearList.length);
        for (uint256 i; i < s._accommodationYears.length(); i++) {
            acc[i] = [yearList[i].number, s._accommodationBookings[account_].checkedInNightsOn(yearList[i].number)];
        }
        return acc;
    }

    // Insert booking
    function _insertBooking(
        BookingMapLib.BookingStatus status,
        address account,
        uint16 yearNum,
        uint16 dayOfYear,
        uint256 price
    ) internal returns (BookingMapLib.Booking memory) {
        (bool successBuild, BookingMapLib.Booking memory value) = s._accommodationYears.buildBooking(
            status,
            yearNum,
            dayOfYear,
            price
        );
        require(successBuild, "BookingFacet: Unable to build Booking");
        require(value.timestamp > block.timestamp, "BookingFacet: date should be in the future");
        require(s._accommodationBookings[account].add(value), "BookingFacet: Booking already exists");
        return value;
    }

    // Check-in accommodation
    function checkinAccommodationFor(
        address account,
        uint16[2][] calldata dates
    ) external onlyRole(AccessControlLib.SPACE_HOST_ROLE) {
        uint16 count;
        for (uint256 i = 0; i < dates.length; i++) {
            bool success = s._accommodationBookings[account].updateStatus(
                dates[i][0],
                dates[i][1],
                BookingMapLib.BookingStatus.CheckedIn
            );
            if (success) {
                count += 1;
            }
        }
        if (count > 0) {
            emit BookingCheckedIn(_msgSender(), account, dates);
        }
    }

    // Check-out accommodation and mint $Presence tokens
    function checkOutAccommodationFor(
        address account,
        uint16[2][] calldata dates
    ) external onlyRole(AccessControlLib.SPACE_HOST_ROLE) {
        uint16 totalNights;
        for (uint256 i = 0; i < dates.length; i++) {
            (bool found, BookingMapLib.Booking memory _booking) = s._accommodationBookings[account].get(
                dates[i][0],
                dates[i][1]
            );
            if (!found) {
                continue;
            }
            if (_booking.status == BookingMapLib.BookingStatus.CheckedIn) {
                bool success = s._accommodationBookings[account].updateStatus(
                    dates[i][0],
                    dates[i][1],
                    BookingMapLib.BookingStatus.CheckedOut
                );
                if (success) {
                    totalNights += 1;
                }
            }
        }

        if (totalNights > 0) {
            uint256 presenceMinted = totalNights; // One $Presence token per night
            //_mintPresence(account, presenceMinted); // Uncomment and implement this line to mint tokens
            emit BookingCheckedOut(_msgSender(), account, dates, presenceMinted);
        }
    }

    // Cancel accommodation
    function cancelAccommodation(uint16[2][] calldata dates) external whenNotPaused {
        for (uint256 i = 0; i < dates.length; i++) {
            BookingMapLib.Booking memory booking = _getBooking(_msgSender(), dates[i][0], dates[i][1]);
            _cancel(_msgSender(), booking);
        }
        emit CanceledBookings(_msgSender(), dates);
    }

    function cancelAccommodationFor(
        address account,
        uint16[2][] calldata dates
    ) external onlyRole(AccessControlLib.BOOKING_MANAGER_ROLE) whenNotPaused {
        for (uint256 i = 0; i < dates.length; i++) {
            BookingMapLib.Booking memory booking = _getBooking(account, dates[i][0], dates[i][1]);
            require(
                booking.status == BookingMapLib.BookingStatus.Pending,
                "BookingFacet: (NotPending) Can not cancel confirmed accommodation"
            );
            _cancel(account, booking);
        }
        emit CanceledBookings(account, dates);
    }

    function confirmAccommodationFor(
        address account,
        uint16[2][] calldata dates
    ) external onlyRole(AccessControlLib.BOOKING_MANAGER_ROLE) {
        uint16 count;
        for (uint256 i = 0; i < dates.length; i++) {
            (bool found, BookingMapLib.Booking memory _booking) = s._accommodationBookings[account].get(
                dates[i][0],
                dates[i][1]
            );
            if (!found) {
                continue;
            }
            if (_booking.status == BookingMapLib.BookingStatus.Pending) {
                bool success = s._accommodationBookings[account].updateStatus(
                    dates[i][0],
                    dates[i][1],
                    BookingMapLib.BookingStatus.Confirmed
                );
                if (success) {
                    count += 1;
                }
            }
        }
        if (count > 0) {
            emit BookingConfirmed(_msgSender(), account, dates);
        }
    }

    function _getBooking(
        address account,
        uint16 year,
        uint16 day
    ) internal view returns (BookingMapLib.Booking memory) {
        (bool exists, BookingMapLib.Booking memory booking) = s._accommodationBookings[account].get(year, day);
        require(exists, "BookingFacet: (NonExisting) Reservation does not exist");
        return booking;
    }

    function _cancel(address account, BookingMapLib.Booking memory booking) internal {
        require(booking.timestamp > block.timestamp, "BookingFacet: Can not cancel past booking");
        (bool success, ) = s._accommodationBookings[account].remove(booking.year, booking.dayOfYear);
        require(success, "BookingFacet: Unable to delete Booking");
        _stakeLibBookingContext(account, booking.year).handleCancelation(
            s.staking[account],
            booking.price,
            booking.timestamp
        );
    }

    function unlockedStakeAt(address account, uint16 year, uint16 day) public view returns (uint256) {
        (bool success, uint256 tm) = s._accommodationYears.buildTimestamp(year, day);
        require(success, "unable to build timestamp");
        return _stakeLibContext(_msgSender()).releasableAt(s.staking[account], tm);
    }

    function lockedStakeAt(address account, uint16 year, uint16 day) public view returns (uint256) {
        (bool success, uint256 tm) = s._accommodationYears.buildTimestamp(year, day);
        require(success, "unable to build timestamp");
        return _stakeLibContext(_msgSender()).lockedAt(s.staking[account], tm);
    }

    function getAccommodationBooking(
        address account,
        uint16 yearNum,
        uint16 dayOfYear
    ) external view returns (bool, BookingMapLib.Booking memory) {
        return s._accommodationBookings[account].get(yearNum, dayOfYear);
    }

    function getAccommodationBookings(
        address account,
        uint16 _year
    ) external view returns (BookingMapLib.Booking[] memory) {
        return s._accommodationBookings[account].list(_year);
    }

    // Admin functions
    function addAccommodationYear(
        uint16 number,
        bool leapYear,
        uint256 start,
        uint256 end,
        bool enabled
    ) external onlyRole(AccessControlLib.BOOKING_MANAGER_ROLE) {
        require(
            s._accommodationYears.add(BookingMapLib.Year(number, leapYear, start, end, enabled)),
            "BookingFacet: Unable to add year"
        );
        emit YearAdded(number, leapYear, start, end, enabled);
    }

    function getAccommodationYears() external view returns (BookingMapLib.Year[] memory) {
        return s._accommodationYears.values();
    }

    function getAccommodationYear(uint16 number) external view returns (bool, BookingMapLib.Year memory) {
        return s._accommodationYears.get(number);
    }

    function removeAccommodationYear(uint16 number) external onlyRole(AccessControlLib.BOOKING_MANAGER_ROLE) {
        require(s._accommodationYears.remove(number), "BookingFacet: Unable to remove Year");
        emit YearRemoved(number);
    }

    function updateAccommodationYear(
        uint16 number,
        bool leapYear,
        uint256 start,
        uint256 end,
        bool enabled
    ) external onlyRole(AccessControlLib.BOOKING_MANAGER_ROLE) {
        require(
            s._accommodationYears.update(BookingMapLib.Year(number, leapYear, start, end, enabled)),
            "BookingFacet: Unable to update Year"
        );
        emit YearUpdated(number, leapYear, start, end, enabled);
    }

    function enableAccommodationYear(
        uint16 number,
        bool enable
    ) external onlyRole(AccessControlLib.BOOKING_MANAGER_ROLE) {
        (, BookingMapLib.Year memory y) = s._accommodationYears.get(number);
        y.enabled = enable;
        require(s._accommodationYears.update(y), "BookingFacet: Unable to update year");
        emit YearUpdated(y.number, y.leapYear, y.start, y.end, y.enabled);
    }
}
