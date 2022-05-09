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
import "hardhat/console.sol";

contract ProofOfPresence is Context, ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Booking {
        uint256 cost;
    }
    struct Year {
        uint16 number;
        uint256 start;
        uint256 end;
    }

    IERC20 public immutable token;

    // TODO: think in year buckets to reduce 1+n complexity
    mapping(address => mapping(uint16 => uint256[])) public dates;
    mapping(address => mapping(uint256 => Booking)) internal _bookings;
    // mapping(uint16 => uint256[2]) internal _years;
    Year[] internal _years;

    constructor(address _token) {
        token = IERC20(_token);
        _years.push(Year(2022, block.timestamp, 1672531199));
        _years.push(Year(2023, 1672531200, 1704067199));
        _years.push(Year(2024, 1704067200, 1735689599));
    }

    function book(uint256[] memory _dates) public {
        for (uint256 i = 0; i < _dates.length; i++) {
            require(_dates[i] > block.timestamp, "date should be in the future");
            require(_bookings[_msgSender()][_dates[i]].cost == uint256(0), "Booking already exists");
            uint16 year = getYear(_dates[i]);
            require(year > uint16(2021), "booking not allowed for requested date");
            dates[_msgSender()][year].push(_dates[i]);
            _bookings[_msgSender()][_dates[i]] = Booking(1 ether);
        }
        // Really simplistic pricing
        token.safeTransferFrom(_msgSender(), address(this), _dates.length * 10**18);
    }

    function getYear(uint256 tm) internal view returns (uint16) {
        for (uint16 i; i < _years.length; i++) {
            if (_years[i].start <= tm && _years[i].end >= tm) return _years[i].number;
        }
        return uint16(0);
    }

    // TODO: optimize array iteration now is 3*n complexity: horrible performance
    function cancel(uint256[] memory _cancelDates) public {
        for (uint256 i = 0; i < _cancelDates.length; i++) {
            require(_cancelDates[i] > block.timestamp, "Can not cancel past booking");
            // check booking existance
            require(_bookings[_msgSender()][_cancelDates[i]].cost != uint256(0), "Booking does not exists");
            delete _bookings[_msgSender()][_cancelDates[i]];
        }
        uint256[] memory _copyDates = dates[_msgSender()];
        delete dates[_msgSender()];

        for (uint256 i; i < _copyDates.length; i++) {
            bool keep = true;
            if (_copyDates[i] > block.timestamp) {
                for (uint256 o; o < _cancelDates.length; o++) {
                    // TODO: use POP to not reiterate over the whole array
                    // uint256 localDate = _copyDates.pop();
                    if (_copyDates[i] == _cancelDates[o]) {
                        keep = false;
                        break;
                    }
                }
            }
            if (keep) dates[_msgSender()].push(_copyDates[i]);
        }
        token.safeTransfer(_msgSender(), (_copyDates.length - dates[_msgSender()].length) * 10**18);
    }

    function balanceOf(address account) public view returns (uint256) {
        // TODO: really simplistic balance
        return dates[account].length * 10**18;
    }

    function getDates(address account) public view returns (uint256[] memory) {
        return dates[account];
    }

    function getBooking(address account, uint256 _date) public view returns (uint256, uint256) {
        Booking storage booking = _bookings[account][_date];
        return (_date, booking.cost);
    }
}
