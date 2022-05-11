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
import "./ITokenLock.sol";

contract ProofOfPresence is Context, ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Booking {
        uint256 cost;
    }

    IERC20 public immutable token;
    ITokenLock public immutable wallet;

    // TODO: think in year buckets to reduce 1+n complexity
    mapping(address => uint256[]) public dates;
    mapping(address => mapping(uint256 => Booking)) internal _bookings;

    constructor(address _token, address _wallet) {
        token = IERC20(_token);
        wallet = ITokenLock(_wallet);
    }

    function book(uint256[] memory _dates) public {
        uint256 lastDate;
        uint256 totalPrice;
        for (uint256 i = 0; i < _dates.length; i++) {
            require(_dates[i] > block.timestamp, "date should be in the future");
            require(_bookings[_msgSender()][_dates[i]].cost == uint256(0), "Booking already exists");
            // Simplistic pricing
            uint256 price = 1 ether;
            dates[_msgSender()].push(_dates[i]);
            _bookings[_msgSender()][_dates[i]] = Booking(price);

            if (lastDate < _dates[i]) lastDate = _dates[i];
            totalPrice += price;
        }
        wallet.restakeOrDepositAtFor(_msgSender(), totalPrice, lastDate);
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
                    if (_copyDates[i] == _cancelDates[o]) {
                        keep = false;
                        break;
                    }
                }
            }
            if (keep) dates[_msgSender()].push(_copyDates[i]);
        }
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
