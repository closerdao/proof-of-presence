// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "../Interfaces/ITokenLock.sol";
import "../Libraries/BookingMapLib.sol";

contract ProofOfPresence is Context, Ownable, Pausable {
    using BookingMapLib for BookingMapLib.UserStore;
    using BookingMapLib for BookingMapLib.YearsStore;

    ITokenLock public immutable tokenLock;
    mapping(address => BookingMapLib.UserStore) internal _bookings;
    BookingMapLib.YearsStore internal _years;

    event NewBookings(address account, uint16[2][] bookings);
    event CanceledBookings(address account, uint16[2][] bookings);

    event YearAdded(uint16 number, bool leapYear, uint256 start, uint256 end, bool enabled);
    event YearRemoved(uint16 number);
    event YearUpdated(uint16 number, bool leapYear, uint256 start, uint256 end, bool enabled);

    constructor(address _tokenLock) {
        tokenLock = ITokenLock(_tokenLock);
        _years.add(BookingMapLib.Year(2022, false, 1640995200, 1672531199, true));
        _years.add(BookingMapLib.Year(2023, false, 1672531200, 1704067199, true));
        _years.add(BookingMapLib.Year(2024, true, 1704067200, 1735689599, true));
        _years.add(BookingMapLib.Year(2025, false, 1735689600, 1767225599, true));
    }

    function book(uint16[2][] calldata dates) public whenNotPaused {
        uint256 lastDate;
        for (uint256 i = 0; i < dates.length; i++) {
            uint256 price = 1 ether;
            BookingMapLib.Booking memory value = _insertBooking(_msgSender(), dates[i][0], dates[i][1], price);

            if (lastDate < value.timestamp) lastDate = value.timestamp;
        }
        tokenLock.restakeOrDepositAtFor(_msgSender(), _expectedStaked(_msgSender()), lastDate);
        emit NewBookings(_msgSender(), dates);
    }

    function _insertBooking(
        address account,
        uint16 yearNum,
        uint16 dayOfYear,
        uint256 price
    ) internal returns (BookingMapLib.Booking memory) {
        (bool successBuild, BookingMapLib.Booking memory value) = _years.buildBooking(yearNum, dayOfYear, price);
        require(successBuild, "Unable to build Booking");

        require(value.timestamp > block.timestamp, "date should be in the future");
        require(_bookings[account].add(value), "Booking already exists");
        return value;
    }

    function cancel(uint16[2][] calldata dates) public whenNotPaused {
        for (uint256 i = 0; i < dates.length; i++) {
            _cancel(_msgSender(), dates[i][0], dates[i][1]);
        }
        emit CanceledBookings(_msgSender(), dates);
    }

    function _cancel(
        address account,
        uint16 yearNum,
        uint16 dayOfYear
    ) internal {
        (bool succesBuild, uint256 tm) = _years.buildTimestamp(yearNum, dayOfYear);
        require(succesBuild, "unable to build Timestamp");
        require(tm > block.timestamp, "Can not cancel past booking");
        (bool success, ) = _bookings[account].remove(yearNum, dayOfYear);
        require(success, "Booking does not exists");
    }

    function _expectedStaked(address account) internal view returns (uint256) {
        uint256 max;
        BookingMapLib.Year[] memory _yearList = _years.values();
        for (uint16 i = 0; i < _yearList.length; i++) {
            // TODO: should it be + 1 year?
            if (_yearList[i].end < block.timestamp) continue;
            uint256 amount = _bookings[account].getBalance(_yearList[i].number);
            if (amount > max) max = amount;
        }
        return max;
    }

    function getBooking(
        address account,
        uint16 yearNum,
        uint16 dayOfYear
    ) public view returns (bool, BookingMapLib.Booking memory) {
        return _bookings[account].get(yearNum, dayOfYear);
    }

    function getBookings(address account, uint16 _year) public view returns (BookingMapLib.Booking[] memory) {
        return _bookings[account].list(_year);
    }

    // Admin functions
    function addYear(
        uint16 number,
        bool leapYear,
        uint256 start,
        uint256 end,
        bool enabled
    ) public onlyOwner {
        require(_years.add(BookingMapLib.Year(number, leapYear, start, end, enabled)), "Unable to add year");
        emit YearAdded(number, leapYear, start, end, enabled);
    }

    function getYears() public view returns (BookingMapLib.Year[] memory) {
        return _years.values();
    }

    function getYear(uint16 number) public view returns (bool, BookingMapLib.Year memory) {
        return _years.get(number);
    }

    function removeYear(uint16 number) public onlyOwner {
        require(_years.remove(number), "Unable to remove Year");
        emit YearRemoved(number);
    }

    function updateYear(
        uint16 number,
        bool leapYear,
        uint256 start,
        uint256 end,
        bool enabled
    ) public onlyOwner {
        require(_years.update(BookingMapLib.Year(number, leapYear, start, end, enabled)), "Unable to update Year");
        emit YearUpdated(number, leapYear, start, end, enabled);
    }

    function enableYear(uint16 number, bool enable) public onlyOwner {
        (, BookingMapLib.Year memory y) = _years.get(number);
        y.enabled = enable;
        require(_years.update(y), "Unable to update year");
        emit YearUpdated(y.number, y.leapYear, y.start, y.end, y.enabled);
    }

    /**
     * @dev Pause bookings.
     *
     * Requirements:
     *
     * - Only Owner.
     */
    function pause() public onlyOwner {
        _pause();
    }

    /**
     * @dev Unpause bookings.
     *
     * Requirements:
     *
     * - Only Owner.
     */
    function unpause() public onlyOwner {
        _unpause();
    }
}
