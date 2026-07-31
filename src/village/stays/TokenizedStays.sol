// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {VillageRoles} from "../access/VillageRoles.sol";
import {GregorianDateMath} from "../libraries/GregorianDateMath.sol";
import {TokenizedStaysExposure} from "../libraries/TokenizedStaysExposure.sol";

/// @title Tokenized stays escrow
/// @author Closer DAO
/// @notice Holds CommunityToken deposits used to secure booking-date locks.
/// @dev A booking for day D locks its per-date price throughout [D, D + LOCK_DAYS). A user's deposited balance can
/// secure any set of bookings whose lock intervals do not overlap; overlapping prices add. The contract accepts each
/// caller-supplied price, including zero, without authenticating it. Pricing, discounts, inventory, confirmation, and
/// check-in remain backend responsibilities. A future price-authentication improvement may bind the account, dates,
/// prices, nonce, and deadline in a backend-signed EIP-712 quote.
///
/// Exact deposit accounting assumes CommunityToken is neither fee-on-transfer nor rebasing. The transient reentrancy
/// guard also requires EIP-1153 support on the deployment chain. Pausing stops deposit, withdrawal, booking, cancellation,
/// and pruning writes; orphan recovery and read-only queries remain available.
///
/// Balance terminology:
/// - deposited balance: tokens credited to a user and held by this contract; includes locked and unlocked amounts;
/// - required locked balance: maximum simultaneous balance required by current and future booking lock intervals;
/// - locked balance: deposited balance currently required by bookings and therefore not withdrawable;
/// - unlocked balance: deposited balance not currently required by bookings, available for withdrawal or new bookings;
/// - total deposited balance: sum of all user-credited deposited balances;
/// - orphaned token balance: tokens held by this contract but not credited to any user.
/// Aderyn follows UUPSUpgradeable's payable upgrade surface, but OpenZeppelin rejects value when there is no setup call,
/// while every initializer/reinitializer in this implementation is nonpayable.
/// aderyn-fp-next-line(contract-locks-ether)
contract TokenizedStays is
    Initializable,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardTransient,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    /// @notice Number of days for which each booking price remains locked, including its booking day.
    uint32 public constant LOCK_DAYS = 365;

    /// @notice Number of calendar years added to the current year for the booking horizon.
    uint16 public constant MAX_FUTURE_BOOKING_YEARS = 64;
    uint16 private constant EPOCH_YEAR = 1970;
    uint16 private constant MAX_PAGE_DAYS = 366;
    /// @dev An account can have at most one booking per date, and every booking locks [D, D + LOCK_DAYS), so no more
    /// than LOCK_DAYS prices can overlap. Dividing int256.max by LOCK_DAYS guarantees every valid overlapping exposure
    /// sum fits in the signed accumulator.
    uint256 private constant MAX_PRICE_PER_DATE = uint256(type(int256).max) / uint256(LOCK_DAYS);

    /// @notice Calendar date identified by year and one-based day of year.
    struct DateInput {
        uint16 year;
        uint16 dayOfYear;
    }

    /// @notice Calendar date and CommunityToken amount to lock for that date.
    /// @dev `pricePerDate` is expressed in the token's smallest unit and may be zero. Its upper bound guarantees that
    /// every possible set of overlapping 365-day locks fits in the signed exposure accumulator.
    struct BookingInput {
        uint16 year;
        uint16 dayOfYear;
        uint256 pricePerDate;
    }

    /// @notice Stored booking-lock record returned by date queries.
    struct BookingView {
        uint16 year;
        uint16 dayOfYear;
        uint256 pricePerDate;
    }

    /// @notice Cached exposure deltas used to skip day-by-day scans of complete years.
    /// @dev `totalDelta` is the net exposure change across the year. `maxPrefix` is the maximum cumulative daily delta
    /// within the year, relative to zero immediately before January 1.
    struct YearSummary {
        int256 totalDelta;
        int256 maxPrefix;
    }

    /// @notice Snapshot of an account's escrow and booking-horizon state.
    struct DepositState {
        uint256 depositedBalance;
        uint256 requiredLockedBalance;
        uint256 lockedBalance;
        uint256 unlockedBalance;
        uint16 latestBookedYear;
        uint16 maximumBookingYear;
    }

    /// @notice Side-effect-free balance result for a proposed booking batch.
    struct BookingCreationPreview {
        uint256 depositedBalance;
        uint256 requiredLockedBalanceBefore;
        uint256 requiredLockedBalanceAfter;
        uint256 depositDeficit;
    }

    struct BatchAccumulator {
        uint32 today;
        uint16 currentYear;
        uint16 maximumYear;
        uint16 latestBookedYear;
        uint256 countMask;
        uint256 summaryMask;
    }

    /**
     * @dev ERC-7201 namespaced storage. These contracts have not been deployed, so this is the initial layout for
     * the namespace. Once deployed, never rename the namespace or reorder/remove existing fields; append new fields.
     * @custom:storage-location erc7201:closer.storage.TokenizedStays
     */
    struct TokenizedStaysStorage {
        /// @dev Fixed deposited asset. Changing it would mix liabilities denominated in different tokens.
        IERC20 communityToken;
        /// @dev External authority queried for village roles.
        IAccessControl roleAuthority;
        /// @dev Price encoded as `price + 1` so a stored zero-price booking is distinguishable from no booking.
        mapping(address => mapping(uint32 => uint256)) bookingPricePlusOne;
        /// @dev Cached difference-array summaries for future-year lock exposure.
        mapping(address => mapping(uint16 => YearSummary)) yearSummaries;
        /// @dev Number of stored booking records by their booking year, including expired records until pruned.
        mapping(address => mapping(uint16 => uint32)) bookingCountByYear;
        /// @dev Cached upper bound for current/future exposure scans; may remain stale until cancellation or pruning.
        mapping(address => uint16) latestBookedYears;
        /// @dev Per-account tokens credited to escrow, including locked and unlocked amounts.
        mapping(address => uint256) depositedBalances;
        /// @dev Aggregate of all per-account credited balances.
        uint256 totalDepositedBalance;
    }

    /// @notice Emitted once for every newly stored booking-date lock.
    /// @param account Account whose deposit secures the booking.
    /// @param year Booking year.
    /// @param dayOfYear One-based booking day within `year`.
    /// @param pricePerDate CommunityToken amount locked for the date.
    event BookingCreated(address indexed account, uint16 indexed year, uint16 indexed dayOfYear, uint256 pricePerDate);
    /// @notice Emitted once for every future booking canceled by its user or a booking manager.
    /// @param account Account whose booking was canceled.
    /// @param year Canceled booking year.
    /// @param dayOfYear One-based canceled booking day within `year`.
    /// @param pricePerDate CommunityToken amount released from exposure.
    event BookingCanceled(address indexed account, uint16 indexed year, uint16 indexed dayOfYear, uint256 pricePerDate);
    /// @notice Emitted when a fully expired booking record is deleted from current state.
    /// @param account Account whose historical record was deleted.
    /// @param year Pruned booking year.
    /// @param dayOfYear One-based pruned booking day within `year`.
    /// @param pricePerDate CommunityToken amount formerly associated with the record.
    event BookingPruned(address indexed account, uint16 indexed year, uint16 indexed dayOfYear, uint256 pricePerDate);
    /// @notice Reports the account balance state after one complete booking-creation or cancellation batch.
    /// @param account Account whose booking exposure was reconciled.
    /// @param requiredLockedBalance Maximum simultaneous exposure after the batch.
    /// @param depositedBalance Account's credited deposit after the batch.
    /// @param amountDeposited Deficit pulled from the account during this batch, or zero on cancellation.
    event BookingBalanceReconciled(
        address indexed account,
        uint256 requiredLockedBalance,
        uint256 depositedBalance,
        uint256 amountDeposited
    );
    /// @notice Emitted when tokens are credited to an account, including an automatic booking deficit deposit.
    /// @param account Account receiving deposit credit.
    /// @param amount CommunityToken amount credited and transferred in.
    event Deposit(address indexed account, uint256 amount);
    /// @notice Emitted when an account withdraws unlocked deposited tokens.
    /// @param account Account whose deposit credit was reduced.
    /// @param amount CommunityToken amount withdrawn.
    event Withdrawal(address indexed account, uint256 amount);
    /// @notice Emitted when the owner recovers tokens that were never credited to a user deposit.
    /// @param recipient Account receiving the recovered tokens.
    /// @param amount Orphaned CommunityToken amount recovered.
    event OrphanedTokensRecovered(address indexed recipient, uint256 amount);
    /// @notice Emitted during initialization when the immutable-in-practice deposited asset is configured.
    /// @param oldToken Previously configured asset, which is zero during initialization.
    /// @param newToken Configured CommunityToken asset.
    event CommunityTokenChanged(address indexed oldToken, address indexed newToken);
    /// @notice Emitted when the external village role registry changes.
    /// @param oldAuthority Previously configured role authority.
    /// @param newAuthority Newly configured role authority.
    event RoleAuthorityChanged(address indexed oldAuthority, address indexed newAuthority);

    error InvalidCommunityToken(address token);
    error InvalidRoleAuthority(address roleAuthority);
    error InvalidOwner(address owner);
    error Unauthorized(address sender, bytes32 role);
    error InvalidDate(uint16 year, uint16 dayOfYear);
    error DayIdOutOfRange(uint256 dayId);
    error BookingDateInPast(uint16 year, uint16 dayOfYear);
    error BookingBeyondHorizon(uint16 year, uint16 maximumYear);
    error BookingConflict(uint16 year, uint16 dayOfYear);
    error BookingNotFound(uint16 year, uint16 dayOfYear);
    error BookingNotCancelable(uint16 year, uint16 dayOfYear);
    error BookingNotExpired(uint16 year, uint16 dayOfYear);
    error InvalidPricePerDate(uint256 pricePerDate);
    error InvalidBookingPage(uint16 startDayOfYear, uint16 limit);
    error EmptyBookingBatch();
    error NoBookingDepositDeficit();
    error WithdrawalAmountExceedsUnlockedBalance(uint256 requested, uint256 available);
    error RecoveryAmountExceedsOrphanedTokenBalance(uint256 requested, uint256 available);
    error InvalidRecoveryRecipient(address recipient);
    error DepositedBalanceInvariantViolation(uint256 tokenBalance, uint256 totalDepositedBalance);
    error RequiredBalanceQueryInPast(uint16 year, uint16 dayOfYear);
    error RequiredBalanceQueryBeyondHorizon(uint16 year, uint16 dayOfYear);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes a TokenizedStays proxy with its escrow asset, role authority, and owner.
    /// @dev `communityToken_` and `roleAuthority_` are checked for contract code, but interface and token-behavior
    /// compatibility remain deployment invariants. Its transfer policy, if any, must allow transfers in both directions
    /// between users and this contract. The deposited asset has no post-initialization setter.
    /// @param communityToken_ Standard, non-rebasing, non-fee-on-transfer ERC-20 used for deposits.
    /// @param roleAuthority_ VillageAccess-compatible contract queried for operational roles.
    /// @param owner_ Initial owner responsible for configuration, recovery, and UUPS upgrades.
    function initialize(address communityToken_, address roleAuthority_, address owner_) external initializer {
        if (owner_ == address(0)) revert InvalidOwner(owner_);
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __Pausable_init();

        _setCommunityToken(communityToken_);
        _setRoleAuthority(roleAuthority_);
    }

    /// @notice Repoints this module to a replacement role authority.
    /// @dev Configure and verify all roles on the replacement first, then update every village module in one
    /// coordinated owner/Safe migration. Adding a role never requires changing the authority address. Only contract
    /// code is validated here; an incompatible authority can make all role-gated operations revert.
    /// @param newAuthority Replacement VillageAccess-compatible contract.
    function setRoleAuthority(address newAuthority) external onlyOwner {
        _setRoleAuthority(newAuthority);
    }

    /// @notice Returns the fixed ERC-20 asset in which all deposits and booking prices are denominated.
    /// @dev The deposited asset cannot change because doing so would mix balances denominated in different tokens.
    function communityToken() public view returns (IERC20) {
        return _getTokenizedStaysStorage().communityToken;
    }

    /// @notice Returns the external authority currently queried for village roles.
    function roleAuthority() public view returns (IAccessControl) {
        return _getTokenizedStaysStorage().roleAuthority;
    }

    /// @notice Pauses user deposits, withdrawals, and booking-record mutations.
    /// @dev Callable by the owner or VillageAccess default admin.
    function pause() external onlyOwnerOrRole(VillageRoles.DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /// @notice Resumes user deposits, withdrawals, and booking-record mutations.
    /// @dev Callable by the owner or VillageAccess default admin.
    function unpause() external onlyOwnerOrRole(VillageRoles.DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Credits a deposit. It is immediately withdrawable unless bookings require it.
    /// @dev A future rewards product should use a separately accounted reward-bearing balance rather than changing this
    /// booking deposit into a duration-based manual lock. An amount of zero is a no-op.
    /// @param amount CommunityToken amount to transfer and credit.
    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        _depositFor(_msgSender(), amount);
    }

    /// @notice Credits a deposit using an exact EIP-2612 permit or sufficient existing allowance.
    /// @dev The deposited token must implement EIP-2612. If `permit` fails for any reason, the deposit may continue
    /// when the account already has sufficient allowance. A failed transfer or deposit reverts atomically.
    /// @param amount CommunityToken amount to permit, transfer, and credit.
    /// @param deadline Last timestamp at which the permit signature is valid.
    /// @param v ECDSA signature recovery byte.
    /// @param r ECDSA signature R component.
    /// @param s ECDSA signature S component.
    function depositWithPermit(
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        // The function-level transient guard rejects token callbacks before any escrow accounting is changed.
        // wake-disable-next-line reentrancy
        _permitOrUseAllowance(_msgSender(), amount, deadline, v, r, s);
        _depositFor(_msgSender(), amount);
    }

    /// @notice Withdraws the caller's complete currently unlocked balance.
    /// @return amount CommunityToken amount withdrawn; zero is a valid no-op result.
    function withdrawMax() external nonReentrant whenNotPaused returns (uint256 amount) {
        amount = unlockedBalanceOf(_msgSender());
        _withdrawUnlocked(_msgSender(), amount);
    }

    /// @notice Withdraws part of the caller's currently unlocked balance.
    /// @param requested CommunityToken amount to withdraw.
    function withdraw(uint256 requested) external nonReentrant whenNotPaused {
        _withdrawUnlocked(_msgSender(), requested);
    }

    /// @notice Stores booking-date locks and deposits only any resulting balance deficit.
    /// @dev The batch is atomic. Dates may include today, zero prices are valid, and every nonzero deficit requires
    /// sufficient allowance. The contract does not verify off-chain pricing or inventory decisions.
    /// @param bookings Dates and per-date prices to store.
    function createBookings(BookingInput[] calldata bookings) external nonReentrant whenNotPaused {
        _createBookings(_msgSender(), bookings);
    }

    /// @notice Creates bookings using an exact EIP-2612 permit or sufficient existing allowance for the live deficit.
    /// @dev Booking changes are staged before the live deficit is known. If `permit` fails for any reason, the
    /// transaction may continue when the account already has sufficient allowance for the live deficit. Otherwise the
    /// complete transaction rolls back atomically. Use `createBookings` when no additional deposit is required.
    /// @param bookings Dates and per-date prices to store.
    /// @param deadline Last timestamp at which the permit signature is valid.
    /// @param v ECDSA signature recovery byte.
    /// @param r ECDSA signature R component.
    /// @param s ECDSA signature S component.
    function createBookingsWithPermit(
        BookingInput[] calldata bookings,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        TokenizedStaysStorage storage $ = _getTokenizedStaysStorage();
        uint256 required = _storeBookings($, _msgSender(), bookings);
        uint256 deposited = $.depositedBalances[_msgSender()];
        if (required <= deposited) revert NoBookingDepositDeficit();
        uint256 depositDeficit = required - deposited;

        // The function-level transient guard rejects token callbacks before they can make reentrant accounting changes.
        // wake-disable-next-line reentrancy
        _permitOrUseAllowance(_msgSender(), depositDeficit, deadline, v, r, s);
        _reconcileBookingBalance($, _msgSender(), required);
    }

    /// @notice Cancels the caller's specified future bookings and recalculates its locked balance once.
    /// @dev Only dates strictly after today are cancelable. Released tokens stay deposited until explicitly withdrawn.
    /// @param dates Future booking dates to cancel atomically.
    function cancelBookings(DateInput[] calldata dates) external nonReentrant whenNotPaused {
        _cancelBookings(_msgSender(), dates);
    }

    /// @notice Lets a booking manager cancel specified future bookings for an account.
    /// @dev Released tokens stay credited to `account`; they are never transferred to the manager.
    /// @param account Account whose future bookings are canceled.
    /// @param dates Future booking dates to cancel atomically.
    function cancelBookingsFor(
        address account,
        DateInput[] calldata dates
    ) external nonReentrant whenNotPaused onlyRole(VillageRoles.BOOKING_MANAGER_ROLE) {
        _cancelBookings(account, dates);
    }

    /// @notice Deletes caller-specified historical records after their complete lock interval has expired.
    /// @dev Pruning is permissionless for any account. Historical booking events remain the durable audit trail, and a
    /// record becomes prunable only when its full [booking day, booking day + LOCK_DAYS) interval is over. Pruning cannot
    /// change current or future exposure.
    /// @param account Account whose historical booking records are pruned.
    /// @param dates Fully expired booking dates to delete atomically.
    function pruneExpiredBookings(address account, DateInput[] calldata dates) external nonReentrant whenNotPaused {
        if (dates.length == 0) revert EmptyBookingBatch();
        TokenizedStaysStorage storage $ = _getTokenizedStaysStorage();
        uint32 today = currentDayId();

        for (uint256 i = 0; i < dates.length; ) {
            DateInput calldata date = dates[i];
            uint32 dayId = _toDayId(date.year, date.dayOfYear);
            uint256 encodedPrice = $.bookingPricePlusOne[account][dayId];
            if (encodedPrice == 0) revert BookingNotFound(date.year, date.dayOfYear);
            if (dayId + LOCK_DAYS > today) revert BookingNotExpired(date.year, date.dayOfYear);

            uint256 pricePerDate = encodedPrice - 1;
            delete $.bookingPricePlusOne[account][dayId];
            $.bookingCountByYear[account][date.year] -= 1;
            emit BookingPruned(account, date.year, date.dayOfYear, pricePerDate);

            unchecked {
                ++i;
            }
        }

        _refreshLatestBookedYear(account, _currentYear());
    }

    /// @notice Looks up one stored booking record, including a zero-price record.
    /// @dev Consumers must use `exists` rather than infer existence from `booking.pricePerDate`.
    /// @param account Account whose record is requested.
    /// @param year Booking year.
    /// @param dayOfYear One-based booking day within `year`.
    /// @return exists Whether a record is stored for the date.
    /// @return booking Stored date and price; its price is zero when absent or when a zero-price booking exists.
    function getBooking(
        address account,
        uint16 year,
        uint16 dayOfYear
    ) external view returns (bool exists, BookingView memory booking) {
        uint32 dayId = _toDayId(year, dayOfYear);
        uint256 encodedPrice = _getTokenizedStaysStorage().bookingPricePlusOne[account][dayId];
        exists = encodedPrice != 0;
        booking = BookingView(year, dayOfYear, exists ? encodedPrice - 1 : 0);
    }

    /// @notice Scans at most `limit` calendar days and returns the stored records in that window.
    /// @dev `startDayOfYear` is one-based. `limit` bounds days scanned, not the number of records returned, and cannot
    /// exceed one leap year.
    /// @param account Account whose records are requested.
    /// @param year Booking year to scan.
    /// @param startDayOfYear First one-based day to scan.
    /// @param limit Maximum number of calendar days to scan.
    /// @return bookings The records found in the requested calendar-day window.
    /// @return nextDayOfYear The next day to request, or zero when the year is complete.
    function getBookings(
        address account,
        uint16 year,
        uint16 startDayOfYear,
        uint16 limit
    ) external view returns (BookingView[] memory bookings, uint16 nextDayOfYear) {
        uint16 yearDays = daysInYear(year);
        if (startDayOfYear == 0 || startDayOfYear > yearDays || limit == 0 || limit > MAX_PAGE_DAYS) {
            revert InvalidBookingPage(startDayOfYear, limit);
        }

        uint256 lastDay = uint256(startDayOfYear) + limit - 1;
        if (lastDay > yearDays) lastDay = yearDays;
        bookings = new BookingView[](limit);
        uint256 count = 0;
        TokenizedStaysStorage storage $ = _getTokenizedStaysStorage();
        uint32 dayId = _toDayId(year, startDayOfYear);

        for (uint256 day = startDayOfYear; day <= lastDay; ) {
            uint256 encodedPrice = $.bookingPricePlusOne[account][dayId];
            if (encodedPrice != 0) {
                bookings[count] = BookingView(year, uint16(day), encodedPrice - 1);
                count += 1;
            }
            unchecked {
                ++day;
                ++dayId;
            }
        }

        // Truncate the preallocated memory array to the number of populated booking results.
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            mstore(bookings, count)
        }
        nextDayOfYear = lastDay < yearDays ? uint16(lastDay + 1) : 0;
    }

    /// @notice Returns the account's current deposited, required, locked, and unlocked balance summary.
    /// @param account Account whose escrow state is requested.
    /// @return state Current escrow balances and booking-year bounds.
    function getDepositState(address account) external view returns (DepositState memory state) {
        TokenizedStaysStorage storage $ = _getTokenizedStaysStorage();
        state.depositedBalance = $.depositedBalances[account];
        state.requiredLockedBalance = requiredLockedBalance(account);
        state.lockedBalance =
            state.depositedBalance < state.requiredLockedBalance ? state.depositedBalance : state.requiredLockedBalance;
        state.unlockedBalance = state.depositedBalance - state.lockedBalance;
        state.latestBookedYear = $.latestBookedYears[account];
        state.maximumBookingYear = currentMaximumBookingYear();
    }

    /// @notice Validates a proposed batch and returns its exact booking-deposit effect without changing state.
    /// @dev The scan is limited to the union of the proposed 365-day lock intervals. Existing exposure outside those
    /// intervals cannot increase, so the current required balance remains the lower bound.
    /// @param account Account whose existing bookings and deposit are used.
    /// @param bookings Dates and per-date prices to preview.
    /// @return preview Current deposit and required-balance values before and after the proposed batch.
    function previewCreateBookings(
        address account,
        BookingInput[] calldata bookings
    ) external view returns (BookingCreationPreview memory preview) {
        TokenizedStaysStorage storage $ = _getTokenizedStaysStorage();
        (uint32[] memory dayIds, uint256[] memory prices) = _validatedSortedBookingBatch($, account, bookings);

        preview.depositedBalance = $.depositedBalances[account];
        preview.requiredLockedBalanceBefore = requiredLockedBalance(account);
        preview.requiredLockedBalanceAfter = _requiredBalanceWithProposals(
            $,
            account,
            dayIds,
            prices,
            preview.requiredLockedBalanceBefore
        );
        if (preview.requiredLockedBalanceAfter > preview.depositedBalance) {
            preview.depositDeficit = preview.requiredLockedBalanceAfter - preview.depositedBalance;
        }
    }

    /// @notice Recomputes the account's net and maximum-prefix exposure deltas for a calendar year.
    /// @dev Primarily an accounting/debugging view for the cached summary model; it does not return the absolute locked
    /// balance entering the year.
    /// @param account Account whose exposure is summarized.
    /// @param year Calendar year to scan.
    function getYearExposureSummary(address account, uint16 year) external view returns (YearSummary memory) {
        return _calculateYearSummary(_getTokenizedStaysStorage(), account, year);
    }

    /// @notice Returns stored booking records for a booking year, including expired records until they are pruned.
    /// @param account Account whose records are counted.
    /// @param year Booking year to count.
    function bookingCountForYear(address account, uint16 year) external view returns (uint32) {
        return _getTokenizedStaysStorage().bookingCountByYear[account][year];
    }

    /// @notice Returns the cached upper booking-year bound used for exposure scans.
    /// @dev The value may include expired records until cancellation or pruning refreshes it. Historical records earlier
    /// than the current year are not represented once the cache is refreshed; use `bookingCountForYear` to inspect them.
    /// @param account Account whose cached booking-year bound is requested.
    function latestBookedYear(address account) external view returns (uint16) {
        return _getTokenizedStaysStorage().latestBookedYears[account];
    }

    /// @notice Returns tokens credited to the account, including both locked and unlocked amounts.
    /// @param account Account whose credited balance is requested.
    function depositedBalanceOf(address account) public view returns (uint256) {
        return _getTokenizedStaysStorage().depositedBalances[account];
    }

    /// @notice Returns the aggregate tokens credited to all accounts.
    function totalDepositedBalance() public view returns (uint256) {
        return _getTokenizedStaysStorage().totalDepositedBalance;
    }

    /// @notice Returns the account's deposited balance currently required by bookings.
    /// @param account Account whose locked deposit is requested.
    function lockedBalanceOf(address account) public view returns (uint256) {
        uint256 deposited = depositedBalanceOf(account);
        uint256 required = requiredLockedBalance(account);
        return deposited < required ? deposited : required;
    }

    /// @notice Returns the account's deposited balance available for withdrawal or another booking.
    /// @param account Account whose unlocked deposit is requested.
    function unlockedBalanceOf(address account) public view returns (uint256) {
        return depositedBalanceOf(account) - lockedBalanceOf(account);
    }

    /// @notice Maximum simultaneous booking balance still required from today onward.
    /// @param account Account whose current and future exposure is requested.
    function requiredLockedBalance(address account) public view returns (uint256) {
        return _requiredLockedBalanceAt(_getTokenizedStaysStorage(), account, currentDayId());
    }

    /// @notice Maximum simultaneous booking balance that would be required if `year/dayOfYear` were today.
    /// @dev Past queries are rejected because expired booking records may have been pruned.
    /// @param account Account whose projected exposure is requested.
    /// @param year Projected current year.
    /// @param dayOfYear Projected one-based current day within `year`.
    function requiredLockedBalanceAt(address account, uint16 year, uint16 dayOfYear) external view returns (uint256) {
        uint32 queryDayId = _toDayId(year, dayOfYear);
        if (queryDayId < currentDayId()) revert RequiredBalanceQueryInPast(year, dayOfYear);

        uint16 maximumBookingYear = currentMaximumBookingYear();
        uint32 latestBookingDayId = _toDayId(maximumBookingYear, daysInYear(maximumBookingYear));
        if (uint256(queryDayId) > uint256(latestBookingDayId) + LOCK_DAYS) {
            revert RequiredBalanceQueryBeyondHorizon(year, dayOfYear);
        }

        return _requiredLockedBalanceAt(_getTokenizedStaysStorage(), account, queryDayId);
    }

    /// @notice Returns tokens held by this contract that are not credited to any user's deposited balance.
    /// @dev Direct ERC-20 transfers create orphaned tokens rather than user deposits. A rebasing or fee-on-transfer asset
    /// would violate the exact accounting assumptions used by this calculation.
    function orphanedTokenBalance() public view returns (uint256) {
        TokenizedStaysStorage storage $ = _getTokenizedStaysStorage();
        uint256 tokenBalance = $.communityToken.balanceOf(address(this));
        uint256 deposited = $.totalDepositedBalance;
        if (tokenBalance < deposited) revert DepositedBalanceInvariantViolation(tokenBalance, deposited);
        return tokenBalance - deposited;
    }

    /// @notice Recovers tokens that were transferred directly and therefore were never credited as a deposit.
    /// @dev This remains available while paused so an owner can recover orphaned tokens during incident response.
    /// @param recipient Account receiving the recovered tokens; cannot be zero or this contract.
    /// @param amount Orphaned CommunityToken amount to recover.
    function recoverOrphanedTokens(address recipient, uint256 amount) external nonReentrant onlyOwner {
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecoveryRecipient(recipient);
        uint256 available = orphanedTokenBalance();
        if (amount > available) revert RecoveryAmountExceedsOrphanedTokenBalance(amount, available);

        communityToken().safeTransfer(recipient, amount);
        emit OrphanedTokensRecovered(recipient, amount);
    }

    /// @dev Exposure is represented as a daily difference array: a booking adds its price on the booking day and
    /// subtracts it LOCK_DAYS later. The current year is scanned by day; complete future years use cached prefix maxima.
    function _requiredLockedBalanceAt(
        TokenizedStaysStorage storage $,
        address account,
        uint32 dayId
    ) internal view returns (uint256) {
        (uint16 currentYear, ) = _fromDayId(dayId);
        mapping(uint32 => uint256) storage bookingPrices = $.bookingPricePlusOne[account];
        int256 exposure = TokenizedStaysExposure.activeExposure(bookingPrices, dayId, LOCK_DAYS);
        uint32 yearEnd = _toDayId(currentYear, daysInYear(currentYear));
        int256 maximum;
        (exposure, maximum) = TokenizedStaysExposure.scanRange(bookingPrices, dayId + 1, yearEnd, LOCK_DAYS, exposure);
        maximum = _scanFutureYearSummaries($, account, currentYear, exposure, maximum);
        return uint256(maximum);
    }

    function _scanFutureYearSummaries(
        TokenizedStaysStorage storage $,
        address account,
        uint16 currentYear,
        int256 exposure,
        int256 maximum
    ) internal view returns (int256) {
        uint16 latest = $.latestBookedYears[account];
        if (latest < currentYear) return maximum;
        // Scan one year past the last booking year because a late-year lock can expire in the following year.
        uint256 throughYear = uint256(latest) + 1;
        uint256 maximumSummaryYear = uint256(currentYear) + MAX_FUTURE_BOOKING_YEARS + 1;
        if (throughYear > maximumSummaryYear) throughYear = maximumSummaryYear;

        for (uint256 year = uint256(currentYear) + 1; year <= throughYear; ) {
            YearSummary storage summary = $.yearSummaries[account][uint16(year)];
            (exposure, maximum) = TokenizedStaysExposure.applyYearSummary(
                exposure,
                maximum,
                summary.totalDelta,
                summary.maxPrefix
            );
            unchecked {
                ++year;
            }
        }
        return maximum;
    }

    /// @notice Returns the current UTC day as a zero-based count from 1970-01-01.
    function currentDayId() public view returns (uint32) {
        uint256 dayId = block.timestamp / 1 days;
        if (dayId > type(uint32).max) revert DayIdOutOfRange(dayId);
        return uint32(dayId);
    }

    /// @notice Returns the last calendar year accepted for new bookings.
    /// @dev The horizon includes that entire year, so its furthest date may be more than exactly
    /// MAX_FUTURE_BOOKING_YEARS * 365 days away.
    function currentMaximumBookingYear() public view returns (uint16) {
        uint256 maximumYear = uint256(_currentYear()) + MAX_FUTURE_BOOKING_YEARS;
        if (maximumYear > type(uint16).max) revert DayIdOutOfRange(maximumYear);
        return uint16(maximumYear);
    }

    /// @notice Converts a Gregorian year and one-based day of year to a zero-based Unix day ID.
    /// @param year Gregorian year at or after 1970.
    /// @param dayOfYear One-based day within `year`.
    function toDayId(uint16 year, uint16 dayOfYear) external pure returns (uint32) {
        return _toDayId(year, dayOfYear);
    }

    /// @notice Converts a zero-based Unix day ID to a Gregorian year and one-based day of year.
    /// @param dayId Zero-based day count from 1970-01-01.
    /// @return year Gregorian year containing `dayId`.
    /// @return dayOfYear One-based day within `year`.
    function fromDayId(uint32 dayId) external pure returns (uint16 year, uint16 dayOfYear) {
        return _fromDayId(dayId);
    }

    /// @notice Returns 365 or 366 according to Gregorian leap-year rules.
    /// @param year Gregorian year at or after 1970.
    function daysInYear(uint16 year) public pure returns (uint16) {
        if (year < EPOCH_YEAR) revert InvalidDate(year, 0);
        return GregorianDateMath.daysInYear(year);
    }

    modifier onlyRole(bytes32 role) {
        _checkRole(role);
        _;
    }

    modifier onlyOwnerOrRole(bytes32 role) {
        address sender = _msgSender();
        if (sender != owner() && !roleAuthority().hasRole(role, sender)) {
            revert Unauthorized(sender, role);
        }
        _;
    }

    /// @dev UUPS implementation upgrades remain an ownership-only action, independent of operational roles.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    function _createBookings(address account, BookingInput[] calldata bookings) internal {
        TokenizedStaysStorage storage $ = _getTokenizedStaysStorage();
        uint256 required = _storeBookings($, account, bookings);
        _reconcileBookingBalance($, account, required);
    }

    function _storeBookings(
        TokenizedStaysStorage storage $,
        address account,
        BookingInput[] calldata bookings
    ) internal returns (uint256 required) {
        if (bookings.length == 0) revert EmptyBookingBatch();
        BatchAccumulator memory accumulator = BatchAccumulator({
            today: currentDayId(),
            currentYear: _currentYear(),
            maximumYear: currentMaximumBookingYear(),
            latestBookedYear: $.latestBookedYears[account],
            countMask: 0,
            summaryMask: 0
        });
        int256[] memory countDeltas = new int256[](uint256(MAX_FUTURE_BOOKING_YEARS) + 1);

        for (uint256 i = 0; i < bookings.length; ) {
            _storeBooking($, account, bookings[i], countDeltas, accumulator);
            unchecked {
                ++i;
            }
        }

        _applyBookingCountDeltas($, account, accumulator.currentYear, countDeltas, accumulator.countMask);
        $.latestBookedYears[account] = accumulator.latestBookedYear;
        _refreshYearSummaries($, account, accumulator.currentYear, accumulator.summaryMask);
        required = requiredLockedBalance(account);
    }

    function _cancelBookings(address account, DateInput[] calldata dates) internal {
        if (dates.length == 0) revert EmptyBookingBatch();
        TokenizedStaysStorage storage $ = _getTokenizedStaysStorage();
        BatchAccumulator memory accumulator = BatchAccumulator({
            today: currentDayId(),
            currentYear: _currentYear(),
            maximumYear: 0,
            latestBookedYear: 0,
            countMask: 0,
            summaryMask: 0
        });
        int256[] memory countDeltas = new int256[](uint256(MAX_FUTURE_BOOKING_YEARS) + 1);

        for (uint256 i = 0; i < dates.length; ) {
            _removeBooking($, account, dates[i], countDeltas, accumulator);
            unchecked {
                ++i;
            }
        }

        _applyBookingCountDeltas($, account, accumulator.currentYear, countDeltas, accumulator.countMask);
        _refreshLatestBookedYear(account, accumulator.currentYear);
        _refreshYearSummaries($, account, accumulator.currentYear, accumulator.summaryMask);
        uint256 required = requiredLockedBalance(account);
        emit BookingBalanceReconciled(account, required, $.depositedBalances[account], 0);
    }

    function _storeBooking(
        TokenizedStaysStorage storage $,
        address account,
        BookingInput calldata booking,
        int256[] memory countDeltas,
        BatchAccumulator memory accumulator
    ) internal {
        uint32 dayId = _validateBookingInput($, account, booking, accumulator.today, accumulator.maximumYear);

        // Plus-one encoding preserves the distinction between a valid zero-price booking and an empty slot.
        $.bookingPricePlusOne[account][dayId] = booking.pricePerDate + 1;
        uint256 yearOffset = uint256(booking.year) - accumulator.currentYear;
        countDeltas[yearOffset] += 1;
        accumulator.countMask |= uint256(1) << yearOffset;
        // Only the lock's start and expiry years need refreshed annual difference summaries.
        accumulator.summaryMask = TokenizedStaysExposure.markSummaryYear(
            accumulator.summaryMask,
            accumulator.currentYear,
            booking.year
        );
        uint16 expiryYear = _expiryYear(booking.year, dayId);
        accumulator.summaryMask = TokenizedStaysExposure.markSummaryYear(
            accumulator.summaryMask,
            accumulator.currentYear,
            expiryYear
        );
        if (booking.year > accumulator.latestBookedYear) accumulator.latestBookedYear = booking.year;

        emit BookingCreated(account, booking.year, booking.dayOfYear, booking.pricePerDate);
    }

    function _removeBooking(
        TokenizedStaysStorage storage $,
        address account,
        DateInput calldata date,
        int256[] memory countDeltas,
        BatchAccumulator memory accumulator
    ) internal {
        uint32 dayId = _toDayId(date.year, date.dayOfYear);
        uint256 encodedPrice = $.bookingPricePlusOne[account][dayId];
        if (encodedPrice == 0) revert BookingNotFound(date.year, date.dayOfYear);
        if (dayId <= accumulator.today) revert BookingNotCancelable(date.year, date.dayOfYear);

        uint256 pricePerDate = encodedPrice - 1;
        delete $.bookingPricePlusOne[account][dayId];
        uint256 yearOffset = uint256(date.year) - accumulator.currentYear;
        countDeltas[yearOffset] -= 1;
        accumulator.countMask |= uint256(1) << yearOffset;
        accumulator.summaryMask = TokenizedStaysExposure.markSummaryYear(
            accumulator.summaryMask,
            accumulator.currentYear,
            date.year
        );
        uint16 expiryYear = _expiryYear(date.year, dayId);
        accumulator.summaryMask = TokenizedStaysExposure.markSummaryYear(
            accumulator.summaryMask,
            accumulator.currentYear,
            expiryYear
        );
        emit BookingCanceled(account, date.year, date.dayOfYear, pricePerDate);
    }

    function _applyBookingCountDeltas(
        TokenizedStaysStorage storage $,
        address account,
        uint16 baseYear,
        int256[] memory deltas,
        uint256 mask
    ) internal {
        for (uint256 offset = 0; offset <= MAX_FUTURE_BOOKING_YEARS && mask != 0; ) {
            uint256 bit = uint256(1) << offset;
            if (mask & bit != 0) {
                uint16 year = uint16(uint256(baseYear) + offset);
                int256 updated = int256(uint256($.bookingCountByYear[account][year])) + deltas[offset];
                $.bookingCountByYear[account][year] = uint32(uint256(updated));
                mask &= ~bit;
            }
            unchecked {
                ++offset;
            }
        }
    }

    function _refreshYearSummaries(
        TokenizedStaysStorage storage $,
        address account,
        uint16 baseYear,
        uint256 mask
    ) internal {
        uint256 maximumOffset = uint256(MAX_FUTURE_BOOKING_YEARS) + 1;
        for (uint256 offset = 1; offset <= maximumOffset && mask != 0; ) {
            uint256 bit = uint256(1) << offset;
            if (mask & bit != 0) {
                uint16 year = uint16(uint256(baseYear) + offset);
                $.yearSummaries[account][year] = _calculateYearSummary($, account, year);
                mask &= ~bit;
            }
            unchecked {
                ++offset;
            }
        }
    }

    /// @dev Builds the annual prefix summary over daily start-minus-expiry exposure deltas.
    function _calculateYearSummary(
        TokenizedStaysStorage storage $,
        address account,
        uint16 year
    ) internal view returns (YearSummary memory summary) {
        uint32 dayId = _toDayId(year, 1);
        uint16 yearDays = daysInYear(year);
        (int256 totalDelta, int256 maxPrefix) = TokenizedStaysExposure.summarizeYear(
            $.bookingPricePlusOne[account],
            dayId,
            yearDays,
            LOCK_DAYS
        );
        summary = YearSummary(totalDelta, maxPrefix);
    }

    function _reconcileBookingBalance(TokenizedStaysStorage storage $, address account, uint256 required) internal {
        uint256 deposited = $.depositedBalances[account];
        uint256 amountDeposited = 0;
        if (required > deposited) {
            amountDeposited = required - deposited;
            $.depositedBalances[account] = required;
            $.totalDepositedBalance += amountDeposited;
            communityToken().safeTransferFrom(account, address(this), amountDeposited);
            emit Deposit(account, amountDeposited);
            deposited = required;
        }
        emit BookingBalanceReconciled(account, required, deposited, amountDeposited);
    }

    function _validatedSortedBookingBatch(
        TokenizedStaysStorage storage $,
        address account,
        BookingInput[] calldata bookings
    ) internal view returns (uint32[] memory dayIds, uint256[] memory prices) {
        uint256 length = bookings.length;
        if (length == 0) revert EmptyBookingBatch();
        dayIds = new uint32[](length);
        prices = new uint256[](length);
        uint32 today = currentDayId();
        uint16 maximumYear = currentMaximumBookingYear();

        for (uint256 i = 0; i < length; ) {
            uint32 dayId = _validateBookingInput($, account, bookings[i], today, maximumYear);
            uint256 price = bookings[i].pricePerDate;
            uint256 insertAt = i;
            while (insertAt > 0 && dayIds[insertAt - 1] > dayId) {
                dayIds[insertAt] = dayIds[insertAt - 1];
                prices[insertAt] = prices[insertAt - 1];
                unchecked {
                    --insertAt;
                }
            }
            // Equality detects duplicate dates after insertion-sort placement.
            // slither-disable-next-line incorrect-equality
            if (insertAt > 0 && dayIds[insertAt - 1] == dayId) {
                revert BookingConflict(bookings[i].year, bookings[i].dayOfYear);
            }
            dayIds[insertAt] = dayId;
            prices[insertAt] = price;
            unchecked {
                ++i;
            }
        }
    }

    function _validateBookingInput(
        TokenizedStaysStorage storage $,
        address account,
        BookingInput calldata booking,
        uint32 today,
        uint16 maximumYear
    ) internal view returns (uint32 dayId) {
        if (booking.pricePerDate > MAX_PRICE_PER_DATE) revert InvalidPricePerDate(booking.pricePerDate);
        dayId = _toDayId(booking.year, booking.dayOfYear);
        if (dayId < today) revert BookingDateInPast(booking.year, booking.dayOfYear);
        if (booking.year > maximumYear) revert BookingBeyondHorizon(booking.year, maximumYear);
        if ($.bookingPricePlusOne[account][dayId] != 0) revert BookingConflict(booking.year, booking.dayOfYear);
    }

    function _requiredBalanceWithProposals(
        TokenizedStaysStorage storage $,
        address account,
        uint32[] memory dayIds,
        uint256[] memory prices,
        uint256 requiredBefore
    ) internal view returns (uint256 requiredAfter) {
        requiredAfter = requiredBefore;
        uint256 first = 0;
        while (first < dayIds.length) {
            uint32 rangeStart = dayIds[first];
            uint32 rangeEnd = rangeStart + LOCK_DAYS - 1;
            uint256 afterRange = first + 1;
            while (afterRange < dayIds.length && dayIds[afterRange] <= rangeEnd + 1) {
                rangeEnd = dayIds[afterRange] + LOCK_DAYS - 1;
                unchecked {
                    ++afterRange;
                }
            }
            uint256 rangeMaximum = _scanProposalRange(
                $,
                account,
                dayIds,
                prices,
                first,
                afterRange,
                rangeStart,
                rangeEnd
            );
            if (rangeMaximum > requiredAfter) requiredAfter = rangeMaximum;
            first = afterRange;
        }
    }

    function _scanProposalRange(
        TokenizedStaysStorage storage $,
        address account,
        uint32[] memory dayIds,
        uint256[] memory prices,
        uint256 first,
        uint256 afterRange,
        uint32 rangeStart,
        uint32 rangeEnd
    ) internal view returns (uint256 maximum) {
        mapping(uint32 => uint256) storage bookingPrices = $.bookingPricePlusOne[account];
        int256 existingExposure = TokenizedStaysExposure.activeExposure(bookingPrices, rangeStart, LOCK_DAYS);
        int256 proposedExposure = 0;
        uint256 starting = first;
        uint256 expiring = first;

        for (uint32 dayId = rangeStart; ; ) {
            if (dayId != rangeStart) {
                existingExposure += TokenizedStaysExposure.dailyDelta(bookingPrices, dayId, LOCK_DAYS);
            }
            // Proposed exposure expires exactly LOCK_DAYS after its booking date.
            // slither-disable-next-line incorrect-equality
            while (expiring < afterRange && dayIds[expiring] + LOCK_DAYS == dayId) {
                proposedExposure -= int256(prices[expiring]);
                unchecked {
                    ++expiring;
                }
            }
            // Proposed exposure starts on its exact booking date.
            // slither-disable-next-line incorrect-equality
            while (starting < afterRange && dayIds[starting] == dayId) {
                proposedExposure += int256(prices[starting]);
                unchecked {
                    ++starting;
                }
            }
            uint256 combined = uint256(existingExposure + proposedExposure);
            if (combined > maximum) maximum = combined;
            // Equality is the inclusive range scan's termination condition.
            // slither-disable-next-line incorrect-equality
            if (dayId == rangeEnd) break;
            unchecked {
                ++dayId;
            }
        }
    }

    function _depositFor(address account, uint256 amount) internal {
        if (amount == 0) return;
        TokenizedStaysStorage storage $ = _getTokenizedStaysStorage();
        $.depositedBalances[account] += amount;
        $.totalDepositedBalance += amount;
        communityToken().safeTransferFrom(account, address(this), amount);
        emit Deposit(account, amount);
    }

    function _permitOrUseAllowance(
        address account,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private {
        IERC20 token = communityToken();
        try IERC20Permit(address(token)).permit(account, address(this), amount, deadline, v, r, s) {} catch (
            bytes memory reason
        ) {
            // A failed permit is safe to ignore only when the current allowance already authorizes the exact transfer
            // performed by the calling flow.
            if (token.allowance(account, address(this)) < amount) {
                // The successful return is unreachable because `success` is fixed false; this call only bubbles `reason`.
                // slither-disable-next-line unused-return
                Address.verifyCallResult(false, reason);
            }
        }
    }

    function _withdrawUnlocked(address account, uint256 requested) internal {
        uint256 available = unlockedBalanceOf(account);
        if (requested > available) revert WithdrawalAmountExceedsUnlockedBalance(requested, available);
        // Zero means there is nothing to transfer; this is not a balance-dependent authorization check.
        // slither-disable-next-line incorrect-equality
        if (requested == 0) return;

        TokenizedStaysStorage storage $ = _getTokenizedStaysStorage();
        $.depositedBalances[account] -= requested;
        $.totalDepositedBalance -= requested;
        communityToken().safeTransfer(account, requested);
        emit Withdrawal(account, requested);
    }

    function _refreshLatestBookedYear(address account, uint16 currentYear) internal {
        TokenizedStaysStorage storage $ = _getTokenizedStaysStorage();
        uint16 candidate = $.latestBookedYears[account];
        uint16 maximumYear = uint16(uint256(currentYear) + MAX_FUTURE_BOOKING_YEARS);
        if (candidate > maximumYear) candidate = maximumYear;
        if (candidate < currentYear) {
            $.latestBookedYears[account] = 0;
            return;
        }

        while ($.bookingCountByYear[account][candidate] == 0) {
            // Equality is the loop's lower-bound termination condition.
            // slither-disable-next-line incorrect-equality
            if (candidate == currentYear) {
                $.latestBookedYears[account] = 0;
                return;
            }
            unchecked {
                --candidate;
            }
        }
        $.latestBookedYears[account] = candidate;
    }

    function _expiryYear(uint16 bookingYear, uint32 bookingDayId) internal pure returns (uint16) {
        uint16 nextYear = bookingYear + 1;
        return TokenizedStaysExposure.expiryYear(bookingYear, bookingDayId, _toDayId(nextYear, 1), LOCK_DAYS);
    }

    function _currentYear() internal view returns (uint16 year) {
        (year, ) = _fromDayId(currentDayId());
    }

    function _toDayId(uint16 year, uint16 dayOfYear) internal pure returns (uint32) {
        uint16 yearDays = daysInYear(year);
        // Days are one-based, so equality with zero is the required lower-bound validation.
        // slither-disable-next-line incorrect-equality
        if (dayOfYear == 0 || dayOfYear > yearDays) revert InvalidDate(year, dayOfYear);
        uint256 dayId = GregorianDateMath.toDayId(EPOCH_YEAR, year, dayOfYear);
        if (dayId > type(uint32).max) revert DayIdOutOfRange(dayId);
        return uint32(dayId);
    }

    function _fromDayId(uint32 dayId) internal pure returns (uint16 year, uint16 dayOfYear) {
        uint256 absoluteDay = uint256(dayId) + GregorianDateMath.daysBeforeYear(EPOCH_YEAR);
        uint256 maximumDay = GregorianDateMath.daysBeforeYear(uint256(type(uint16).max) + 1) - 1;
        if (absoluteDay > maximumDay) revert DayIdOutOfRange(dayId);
        return GregorianDateMath.fromDayId(EPOCH_YEAR, dayId);
    }

    function _checkRole(bytes32 role) internal view {
        address sender = _msgSender();
        if (!roleAuthority().hasRole(role, sender)) revert Unauthorized(sender, role);
    }

    function _setCommunityToken(address newToken) internal {
        if (newToken == address(0) || newToken.code.length == 0) revert InvalidCommunityToken(newToken);
        TokenizedStaysStorage storage $ = _getTokenizedStaysStorage();
        address oldToken = address($.communityToken);
        $.communityToken = IERC20(newToken);
        emit CommunityTokenChanged(oldToken, newToken);
    }

    function _setRoleAuthority(address newAuthority) internal {
        if (newAuthority == address(0) || newAuthority.code.length == 0) {
            revert InvalidRoleAuthority(newAuthority);
        }
        TokenizedStaysStorage storage $ = _getTokenizedStaysStorage();
        address oldAuthority = address($.roleAuthority);
        $.roleAuthority = IAccessControl(newAuthority);
        emit RoleAuthorityChanged(oldAuthority, newAuthority);
    }

    function _getTokenizedStaysStorage() private pure returns (TokenizedStaysStorage storage $) {
        uint256 storageLocation = erc7201("closer.storage.TokenizedStays");
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            $.slot := storageLocation
        }
    }
}
