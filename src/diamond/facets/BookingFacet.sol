// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;
import "@openzeppelin/contracts/utils/Context.sol";
import "../libraries/BookingMapLib.sol";
import "../libraries/AppStorage.sol";

contract BookingFacet is Modifiers {
    using StakeLibV2 for StakeLibV2.Context;
    using BookingMapLib for BookingMapLib.UserStore;
    using BookingMapLib for BookingMapLib.YearsStore;

    event NewBookings(address account, uint16[2][] bookings);
    event CanceledBookings(address account, uint16[2][] bookings);

    event YearAdded(uint16 number, bool leapYear, uint256 start, uint256 end, bool enabled);
    event YearRemoved(uint16 number);
    event YearUpdated(uint16 number, bool leapYear, uint256 start, uint256 end, bool enabled);

    function bookAccommodation(uint16[2][] calldata dates) external whenNotPaused onlyMember {
        for (uint256 i = 0; i < dates.length; i++) {
            uint256 price = 1 ether;
            BookingMapLib.Booking memory value = _insertBooking(_msgSender(), dates[i][0], dates[i][1], price);
            _stakeLibContext(_msgSender()).addAt(s.staking[_msgSender()], price, value.timestamp);
        }

        emit NewBookings(_msgSender(), dates);
    }

    function _insertBooking(
        address account,
        uint16 yearNum,
        uint16 dayOfYear,
        uint256 price
    ) internal returns (BookingMapLib.Booking memory) {
        (bool successBuild, BookingMapLib.Booking memory value) = s._accommodationYears.buildBooking(
            yearNum,
            dayOfYear,
            price
        );
        require(successBuild, "BookingFacet: Unable to build Booking");
        require(value.timestamp > block.timestamp, "BookingFacet: date should be in the future");
        require(s._accommodationBookings[account].add(value), "BookingFacet: Booking already exists");
        return value;
    }

    function cancelAccommodation(uint16[2][] calldata dates) external whenNotPaused {
        uint256 lastDate;
        uint256 firstDate = type(uint256).max;
        for (uint256 i = 0; i < dates.length; i++) {
            (bool exists, BookingMapLib.Booking memory booking) = s._accommodationBookings[_msgSender()].get(
                dates[i][0],
                dates[i][1]
            );
            require(exists, "Reservation does not exits");
            _cancel(_msgSender(), booking.timestamp, dates[i][0], dates[i][1]);
            if (booking.timestamp > lastDate) lastDate = booking.timestamp;
            if (booking.timestamp < firstDate) firstDate = booking.timestamp;

            // BookingMapLib.Booking[] memory prevYear = s._accommodationBookings[_msgSender()].list(dates[i][0]);

            // uint256 prevTmtarget;
            // if (prevYear.length == 0) {
            //     console.log("there is bookings in previous year");
            //     prevTmtarget = booking.timestamp - s._lockingTimePeriod;
            // } else {
            //     console.log("no bookings in previous year");
            //     prevTmtarget = prevYear[prevYear.length - 1].timestamp;
            // }
        }
        _stakeLibContext(_msgSender()).handleCancelations(s.staking[_msgSender()], firstDate, lastDate);

        // we should get how many and when should be moved to
        // _expectedStaked(_msgSender())
        // to remove: balance - expectedStake
        // to move is :
        // - for
        // how many we have to give back to the user

        // _stakeLibContext(_msgSender()).keepUntilRemoveRest(
        //     s.staking[_msgSender()],
        //     _expectedStaked(_msgSender()),
        //     lastDate
        // );

        emit CanceledBookings(_msgSender(), dates);
    }

    function _cancel(
        address account,
        uint256 timestamp,
        uint16 yearNum,
        uint16 dayOfYear
    ) internal {
        require(timestamp > block.timestamp, "BookingFacet: Can not cancel past booking");
        (bool success, ) = s._accommodationBookings[account].remove(yearNum, dayOfYear);
        require(success, "BookingFacet: Booking does not exists");
    }

    function unlockedStakeAt(
        address account,
        uint16 year,
        uint16 day
    ) public view returns (uint256) {
        (bool success, uint256 tm) = s._accommodationYears.buildTimestamp(year, day);
        require(success, "unable to build timestamp");
        return _stakeLibContext(_msgSender()).releasableAt(s.staking[account], tm);
    }

    function lockedStakeAt(
        address account,
        uint16 year,
        uint16 day
    ) public view returns (uint256) {
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

    function getAccommodationBookings(address account, uint16 _year)
        external
        view
        returns (BookingMapLib.Booking[] memory)
    {
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

    function enableAccommodationYear(uint16 number, bool enable)
        external
        onlyRole(AccessControlLib.BOOKING_MANAGER_ROLE)
    {
        (, BookingMapLib.Year memory y) = s._accommodationYears.get(number);
        y.enabled = enable;
        require(s._accommodationYears.update(y), "BookingFacet: Unable to update year");
        emit YearUpdated(y.number, y.leapYear, y.start, y.end, y.enabled);
    }
}
