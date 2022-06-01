// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./ITokenLock.sol";
import "../Libraries/BookingMapLib.sol";
import "hardhat/console.sol";

contract ProofOfPresence is Context, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using BookingMapLib for BookingMapLib.UserStore;
    using BookingMapLib for BookingMapLib.YearsStore;

    ITokenLock public immutable wallet;
    mapping(address => BookingMapLib.UserStore) internal _bookings;
    BookingMapLib.YearsStore internal _years;

    constructor(address _wallet) {
        wallet = ITokenLock(_wallet);
        _years.add(BookingMapLib.Year(2022, false, 1640995200, 1672531199, true));
        _years.add(BookingMapLib.Year(2023, false, 1672531200, 1704067199, true));
        _years.add(BookingMapLib.Year(2024, true, 1704067200, 1735689599, true));
        _years.add(BookingMapLib.Year(2025, false, 1735689600, 1767225599, true));
    }

    function book(uint16[2][] memory dates) public {
        uint256 lastDate;
        for (uint256 i = 0; i < dates.length; i++) {
            uint256 price = 1 ether;
            BookingMapLib.Booking memory value = _insertBooking(_msgSender(), dates[i][0], dates[i][1], price);

            if (lastDate < value.timestamp) lastDate = value.timestamp;
        }
        wallet.restakeOrDepositAtFor(_msgSender(), _expectedStaked(_msgSender()), lastDate);
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

    function cancel(uint16[2][] memory dates) public {
        for (uint256 i = 0; i < dates.length; i++) {
            _cancel(_msgSender(), dates[i][0], dates[i][1]);
        }
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
}
