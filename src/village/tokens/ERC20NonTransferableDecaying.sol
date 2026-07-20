// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {VillageRoles} from "../access/VillageRoles.sol";
import {DecayMath} from "../libraries/DecayMath.sol";

/// @title Non-transferable decaying ERC-20 points
/// @author Closer DAO
/// @notice Base contract for point balances whose displayed value decays over time.
/// @dev OpenZeppelin's ERC-20 storage tracks non-decayed minted units, while `balanceOf` and `totalSupply` expose a
/// separate decayed view. Use the explicit `nonDecayed*` getters when reconciling mint/burn provenance or Transfer
/// events. Transfers and approvals are disabled; balances change only through authorized mint and burn flows. Holders
/// are append-only, so the decayed `totalSupply()` scan grows with every address ever minted to and is intended for
/// occasional off-chain reads rather than calls from state-changing contracts.
///
/// IMPORTANT MODEL LIMITATIONS: decay accrues in whole-day steps. New mints join the recipient's existing account-level
/// schedule and may therefore reach their first decay boundary in less than 24 hours. Burn callers provide the age
/// buckets used to calculate the decayed burn amount; the contract does not prove those buckets against mint lots.
/// `setDecayRatePerDay` changes one global rate without checkpointing a rate epoch or cumulative decay index, so changing
/// the rate after balances exist can apply old/new rates inconsistently between accounts checkpointed at different
/// times. A future version should use a cumulative index with rate epochs and authenticated or proportional burn
/// accounting before mutable production rates are relied upon.
abstract contract ERC20NonTransferableDecaying is
    Initializable,
    ERC20Upgradeable,
    Ownable2StepUpgradeable,
    UUPSUpgradeable
{
    /// @notice Maximum absolute smallest-unit mismatch tolerated when a decayed burn is rounded above the balance.
    uint256 public constant MAX_ALLOWED_ROUNDING_ERROR = 100_000;

    /// @notice Number of decimal places used by daily and annual decay-rate inputs and outputs.
    uint256 public constant DECAY_RATE_PER_DAY_DECIMALS = 9;

    /// @notice Largest daily rate accepted by initialization or `setDecayRatePerDay`.
    /// @dev Approximately equivalent to 80% decay compounded over 365 days.
    uint256 public constant MAX_DECAY_RATE_PER_DAY = 4_399_711;

    /// @notice Fixed-point representation of one used for internal retention calculations.
    uint256 public constant PRECISION_SCALE = 1e18;

    /**
     * @dev ERC-7201 namespaced application storage prevents this reusable upgradeable
     * base from colliding with parent or child storage. Never rename this namespace
     * after deployment; append future fields to the struct.
     * @custom:storage-location erc7201:closer.storage.ERC20NonTransferableDecaying
     */
    struct DecayingTokenStorage {
        /// @dev External authority queried for booking roles.
        IAccessControl roleAuthority;
        /// @dev Daily decay rate with DECAY_RATE_PER_DAY_DECIMALS decimal places.
        uint256 decayRatePerDay;
        /// @dev Start of the account's current whole-day decay interval.
        mapping(address => uint256) decayCheckpointTimestamp;
        /// @dev Displayed balance as of the account's checkpoint timestamp.
        mapping(address => uint256) decayCheckpointBalance;
        /// @dev Append-only set backing the decayed total-supply scan.
        address[] holders;
        mapping(address => bool) isHolder;
    }

    /// @notice Emitted when the external village role registry changes.
    /// @param oldAuthority Previously configured role authority.
    /// @param newAuthority Newly configured role authority.
    event RoleAuthorityChanged(address indexed oldAuthority, address indexed newAuthority);
    /// @notice Emitted when the global daily decay rate changes.
    /// @param oldDecayRatePerDay Previously configured daily rate.
    /// @param newDecayRatePerDay Newly configured daily rate.
    event DecayRatePerDayChanged(uint256 oldDecayRatePerDay, uint256 newDecayRatePerDay);
    /// @notice Records a raw mint and the age-adjusted amount added to the displayed balance.
    /// @param account Recipient of the minted units.
    /// @param mintedAmount Raw units minted.
    /// @param decayedMintedAmount Age-adjusted units added to the displayed balance.
    /// @param mintedForDaysAgo Operator-supplied age used for the adjustment.
    event MintWithDecay(
        address indexed account,
        uint256 mintedAmount,
        uint256 decayedMintedAmount,
        uint256 mintedForDaysAgo
    );
    /// @notice Records a raw burn and the age-adjusted amount removed from the displayed balance.
    /// @param account Account whose units were burned.
    /// @param burnedAmount Raw units burned.
    /// @param decayedBurnedAmount Age-adjusted units removed from the displayed balance.
    /// @param burnedForDaysAgo Operator-supplied age used for the adjustment.
    event BurnWithDecay(
        address indexed account,
        uint256 burnedAmount,
        uint256 decayedBurnedAmount,
        uint256 burnedForDaysAgo
    );
    /// @notice Emitted when the owner destroys all raw and displayed units for an account.
    /// @param account Account whose balances were cleared.
    event BurnAllUserTokens(address indexed account);

    error TransferNotAllowed();
    error ApproveNotAllowed();
    error Unauthorized(address sender, bytes32 role);
    error InvalidDecayRatePerDay(uint256 value, uint256 maxAllowedValue);
    error InvalidRoleAuthority(address invalidRoleAuthority);
    error InvalidOwner(address owner);
    error MintDataEmpty();
    error MintWithZeroAmount();
    error BurnDataEmpty();
    error BurnAmountExceedsDecayedBalance(
        uint256 nonDecayedAmountToBurn,
        uint256 decayedAmountToBurn,
        uint256 nonDecayedUserBalance,
        uint256 decayedUserBalance
    );

    /// @notice One age bucket in a batch mint.
    struct MintData {
        /// @notice Recipient of the raw and displayed units.
        address account;
        /// @notice Raw units to mint.
        uint256 amount;
        /// @notice Age applied immediately to the displayed portion of the mint.
        uint256 daysAgo;
    }

    /// @notice One caller-asserted age bucket in a burn.
    struct BurnData {
        /// @notice Age used to calculate the displayed amount removed by this entry.
        uint256 daysAgo;
        /// @notice Raw units destroyed by this entry.
        uint256 amount;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev Initializes ERC-20 metadata, two-step ownership, role authority, and decay configuration for a child proxy.
    /// `roleAuthority_` is checked for contract code but not probed for full IAccessControl compatibility.
    function __ERC20NonTransferableDecaying_init(
        string memory name_,
        string memory symbol_,
        address roleAuthority_,
        uint256 decayRatePerDay_,
        address owner_
    ) internal onlyInitializing {
        if (owner_ == address(0)) revert InvalidOwner(owner_);
        __ERC20_init(name_, symbol_);
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __ERC20NonTransferableDecaying_init_unchained(roleAuthority_, decayRatePerDay_);
    }

    function __ERC20NonTransferableDecaying_init_unchained(
        address roleAuthority_,
        uint256 decayRatePerDay_
    ) internal onlyInitializing {
        _setRoleAuthority(roleAuthority_);
        _setDecayRatePerDay(decayRatePerDay_);
    }

    /// @notice Repoints this module to a replacement role authority.
    /// @dev Configure and verify all roles on the replacement first, then update every village module in one
    /// coordinated owner/Safe migration. Adding a role never requires changing the authority address. Only contract
    /// code is validated here; an incompatible authority can make all role-gated operations revert.
    /// @param newRoleAuthority Replacement VillageAccess-compatible contract.
    function setRoleAuthority(address newRoleAuthority) external onlyOwner {
        _setRoleAuthority(newRoleAuthority);
    }

    /// @notice Changes the global daily decay rate used by subsequent balance calculations.
    /// @dev Do not change the rate after balances exist unless the limitations documented on this contract are
    /// explicitly accepted. Existing accounts are not checkpointed. The setter is retained for future village
    /// governance and a later epoch/index upgrade.
    /// @param newDecayRatePerDay New daily rate with DECAY_RATE_PER_DAY_DECIMALS decimal places.
    function setDecayRatePerDay(uint256 newDecayRatePerDay) external onlyOwner {
        _setDecayRatePerDay(newDecayRatePerDay);
    }

    /// @notice Returns the external authority currently queried for booking roles.
    function roleAuthority() public view returns (IAccessControl) {
        return _getDecayingTokenStorage().roleAuthority;
    }

    /// @notice Returns the configured daily rate with DECAY_RATE_PER_DAY_DECIMALS decimal places.
    function decayRatePerDay() public view returns (uint256) {
        return _getDecayingTokenStorage().decayRatePerDay;
    }

    /// @notice Returns the start timestamp of the account's current whole-day decay interval, or zero without balance.
    /// @param account Account whose checkpoint timestamp is requested.
    function decayCheckpointTimestamp(address account) public view returns (uint256) {
        return _getDecayingTokenStorage().decayCheckpointTimestamp[account];
    }

    /// @notice Returns the account's displayed balance as of its checkpoint timestamp.
    /// @param account Account whose checkpoint balance is requested.
    function decayCheckpointBalance(address account) public view returns (uint256) {
        return _getDecayingTokenStorage().decayCheckpointBalance[account];
    }

    /// @notice Returns an address from the append-only holder set used by `totalSupply`.
    /// @param index Zero-based holder-set index.
    function holders(uint256 index) public view returns (address) {
        return _getDecayingTokenStorage().holders[index];
    }

    /// @notice Returns whether an account has ever received a mint.
    /// @param account Account to test.
    function isHolder(address account) public view returns (bool) {
        return _getDecayingTokenStorage().isHolder[account];
    }

    /// @notice Returns raw ERC-20 units before decay is applied.
    /// @param account Account whose raw balance is requested.
    function nonDecayedBalanceOf(address account) public view returns (uint256) {
        return ERC20Upgradeable.balanceOf(account);
    }

    /// @notice Returns the raw ERC-20 supply before decay is applied.
    function nonDecayedTotalSupply() public view returns (uint256) {
        return ERC20Upgradeable.totalSupply();
    }

    /// @notice Returns the account's checkpoint balance after complete elapsed days of decay.
    /// @param account Account whose displayed balance is requested.
    function balanceOf(address account) public view override returns (uint256) {
        return calculateDecayedBalance(account);
    }

    /// @notice Returns the sum of current displayed balances across every historical holder.
    /// @dev This is an unbounded O(number of historical holders) view. Prefer `nonDecayedTotalSupply` for a constant-cost
    /// raw-supply query, and do not call this function from state-changing contract code.
    /// @return decayedTotalSupply Sum of all displayed balances at the current timestamp.
    function totalSupply() public view override returns (uint256 decayedTotalSupply) {
        DecayingTokenStorage storage $ = _getDecayingTokenStorage();
        uint256 holdersLength = $.holders.length;
        for (uint256 i = 0; i < holdersLength; ) {
            decayedTotalSupply += balanceOf($.holders[i]);
            unchecked {
                ++i;
            }
        }
        return decayedTotalSupply;
    }

    /// @notice Applies the current daily decay rate to an amount for a number of complete days.
    /// @dev Fixed-point multiplication rounds down, so repeated checkpointing may differ slightly from one calculation
    /// over the same total duration.
    /// @param amount Amount in the token's smallest unit.
    /// @param daysAgo Number of daily compounding periods.
    /// @return Remaining amount after decay.
    function calculateDecayForDays(uint256 amount, uint256 daysAgo) public view returns (uint256) {
        // Zero days is the identity case for the public decay calculation.
        // slither-disable-next-line incorrect-equality
        if (daysAgo == 0) return amount;

        uint256 decayRateScaled = (decayRatePerDay() * PRECISION_SCALE) / (10 ** DECAY_RATE_PER_DAY_DECIMALS);
        uint256 retentionRate = PRECISION_SCALE - decayRateScaled;
        uint256 totalRetentionRate = DecayMath.powWithPrecision(retentionRate, daysAgo, PRECISION_SCALE);
        return Math.mulDiv(amount, totalRetentionRate, PRECISION_SCALE);
    }

    /// @notice Converts a daily decay rate into its compounded 365-day rate.
    /// @dev `decayRatePerDay_` must not exceed `10 ** DECAY_RATE_PER_DAY_DECIMALS`; configured rates are already bounded
    /// more tightly by MAX_DECAY_RATE_PER_DAY.
    /// @param decayRatePerDay_ Daily rate with DECAY_RATE_PER_DAY_DECIMALS decimal places.
    /// @return decayRatePerYear Annual rate using the same decimal scale.
    function getDecayRatePerYear(uint256 decayRatePerDay_) public pure returns (uint256 decayRatePerYear) {
        uint256 decayRateScaled = (decayRatePerDay_ * PRECISION_SCALE) / (10 ** DECAY_RATE_PER_DAY_DECIMALS);
        uint256 dailyRetentionRate = PRECISION_SCALE - decayRateScaled;
        uint256 yearlyRetentionRate = DecayMath.powWithPrecision(dailyRetentionRate, 365, PRECISION_SCALE);
        uint256 yearlyDecayRateScaled = PRECISION_SCALE - yearlyRetentionRate;
        return (yearlyDecayRateScaled * (10 ** DECAY_RATE_PER_DAY_DECIMALS)) / PRECISION_SCALE;
    }

    /// @notice Returns the annualized equivalent of the configured daily decay rate.
    function getCurrentDecayRatePerYear() external view returns (uint256) {
        return getDecayRatePerYear(decayRatePerDay());
    }

    /// @notice Approximates the daily rate whose 365-day compound rate matches an annual rate.
    /// @dev `decayRatePerYear` must not exceed `10 ** DECAY_RATE_PER_DAY_DECIMALS`. This conversion does not enforce
    /// MAX_DECAY_RATE_PER_DAY; initialization and the setter enforce the production limit.
    /// @param decayRatePerYear Annual rate with DECAY_RATE_PER_DAY_DECIMALS decimal places.
    /// @return Approximate daily rate using the same decimal scale.
    function getDecayRatePerDay(uint256 decayRatePerYear) external pure returns (uint256) {
        uint256 yearlyRetentionRateScaled = 10 ** DECAY_RATE_PER_DAY_DECIMALS - decayRatePerYear;
        uint256 yearlyRetentionRate =
            (yearlyRetentionRateScaled * PRECISION_SCALE) / (10 ** DECAY_RATE_PER_DAY_DECIMALS);
        uint256 dailyRetentionRate = DecayMath.nthRoot(yearlyRetentionRate, 365, PRECISION_SCALE);
        uint256 dailyDecayRateScaled = PRECISION_SCALE - dailyRetentionRate;
        return (dailyDecayRateScaled * (10 ** DECAY_RATE_PER_DAY_DECIMALS)) / PRECISION_SCALE;
    }

    /// @notice Mints raw units and credits their age-adjusted displayed value.
    /// @dev Callable by the owner, BOOKING_MANAGER_ROLE, or BOOKING_PLATFORM_ROLE. `daysAgo` is trusted operator input;
    /// the contract does not authenticate the claimed mint date.
    /// @param account Recipient of the raw and displayed units.
    /// @param amount Raw units to mint.
    /// @param daysAgo Age applied immediately to the displayed portion.
    function mint(address account, uint256 amount, uint256 daysAgo) external {
        _checkBurnOrMintPermission();
        _mintWithDecay(account, amount, daysAgo);
    }

    /// @notice Processes multiple trusted age-bucket mints atomically.
    /// @dev Authorization is checked once for the entire batch; any invalid entry reverts every mint.
    /// @param mintDataArray Recipient, raw amount, and age for each mint.
    function mintBatch(MintData[] calldata mintDataArray) external {
        uint256 mintDataArrayLength = mintDataArray.length;
        if (mintDataArrayLength == 0) revert MintDataEmpty();

        _checkBurnOrMintPermission();
        for (uint256 i = 0; i < mintDataArrayLength; ) {
            _mintWithDecay(mintDataArray[i].account, mintDataArray[i].amount, mintDataArray[i].daysAgo);
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Burns raw units and removes caller-calculated age-adjusted units from the displayed balance.
    /// @dev Callable by the owner, BOOKING_MANAGER_ROLE, or BOOKING_PLATFORM_ROLE. Burn ages are not tied to stored mint
    /// lots. Supplying inaccurate buckets can desynchronize the raw and displayed ledgers, subject only to raw-balance
    /// checks and the small displayed-balance rounding tolerance.
    /// @param account Account whose units are destroyed.
    /// @param burnDataArray Caller-asserted age buckets and raw amounts to burn.
    /// @return finalBalance Account's stored displayed balance immediately after the burn.
    function burn(address account, BurnData[] calldata burnDataArray) external returns (uint256 finalBalance) {
        _checkBurnOrMintPermission();
        uint256 burnDataArrayLength = burnDataArray.length;
        if (burnDataArrayLength == 0) revert BurnDataEmpty();

        uint256 nonDecayedAmountToBurn = 0;
        uint256 decayedAmountToBurn = 0;

        for (uint256 i = 0; i < burnDataArrayLength; ) {
            nonDecayedAmountToBurn += burnDataArray[i].amount;
            uint256 decayedBurnedAmount = calculateDecayForDays(burnDataArray[i].amount, burnDataArray[i].daysAgo);
            decayedAmountToBurn += decayedBurnedAmount;
            emit BurnWithDecay(account, burnDataArray[i].amount, decayedBurnedAmount, burnDataArray[i].daysAgo);
            unchecked {
                ++i;
            }
        }

        DecayingTokenStorage storage $ = _getDecayingTokenStorage();
        finalBalance = _checkpointDecay($, account);

        if (decayedAmountToBurn > finalBalance) {
            uint256 difference = decayedAmountToBurn - finalBalance;
            if (difference > MAX_ALLOWED_ROUNDING_ERROR) {
                revert BurnAmountExceedsDecayedBalance(
                    nonDecayedAmountToBurn,
                    decayedAmountToBurn,
                    nonDecayedBalanceOf(account),
                    finalBalance
                );
            }
            finalBalance = 0;
        } else {
            unchecked {
                finalBalance -= decayedAmountToBurn;
            }
        }

        ERC20Upgradeable._burn(account, nonDecayedAmountToBurn);
        if (ERC20Upgradeable.balanceOf(account) == 0) finalBalance = 0;
        _storeDecayCheckpoint($, account, finalBalance);
        return finalBalance;
    }

    /// @notice Owner-only recovery path that destroys an account's full raw balance and clears its displayed balance.
    /// @dev The address remains in the append-only holder set.
    /// @param account Account whose balances are cleared.
    function burnAll(address account) external onlyOwner {
        ERC20Upgradeable._burn(account, nonDecayedBalanceOf(account));
        DecayingTokenStorage storage $ = _getDecayingTokenStorage();
        $.decayCheckpointBalance[account] = 0;
        $.decayCheckpointTimestamp[account] = 0;
        emit BurnAllUserTokens(account);
    }

    /// @notice Disabled because point balances are non-transferable.
    /// @dev Always reverts with TransferNotAllowed without spending allowance.
    /// @param from Unused source account.
    /// @param to Unused destination account.
    /// @param amount Unused transfer amount.
    function transferFrom(address from, address to, uint256 amount) public pure virtual override returns (bool) {
        from;
        to;
        amount;
        revert TransferNotAllowed();
    }

    /// @notice Disabled because non-transferable point balances cannot be delegated to spenders.
    /// @dev Always reverts with ApproveNotAllowed.
    /// @param spender Unused spender account.
    /// @param amount Unused allowance amount.
    function approve(address spender, uint256 amount) public pure virtual override returns (bool) {
        spender;
        amount;
        revert ApproveNotAllowed();
    }

    /// @dev UUPS implementation upgrades remain an ownership-only action, independent of operational booking roles.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    function calculateDecayedBalance(address account) internal view returns (uint256) {
        DecayingTokenStorage storage $ = _getDecayingTokenStorage();
        uint256 checkpointTimestamp = $.decayCheckpointTimestamp[account];
        if (checkpointTimestamp == 0) return 0;

        uint256 balance = $.decayCheckpointBalance[account];
        if (balance == 0) return 0;

        uint256 passedDays = (block.timestamp - checkpointTimestamp) / 1 days;
        return calculateDecayForDays(balance, passedDays);
    }

    function _mintWithDecay(address account, uint256 amount, uint256 daysAgo) internal {
        if (amount == 0) revert MintWithZeroAmount();

        _registerHolderIfNeeded(account);
        uint256 decayedMintedAmount = calculateDecayForDays(amount, daysAgo);
        emit MintWithDecay(account, amount, decayedMintedAmount, daysAgo);
        DecayingTokenStorage storage $ = _getDecayingTokenStorage();
        uint256 checkpointBalance = _checkpointDecay($, account);
        _storeDecayCheckpoint($, account, checkpointBalance + decayedMintedAmount);
        ERC20Upgradeable._mint(account, amount);
    }

    /// @dev Applies complete elapsed days while preserving the account's fractional-day progress. A checkpoint that
    /// decays fully to zero clears the schedule; the next mint starts a new interval at its transaction timestamp.
    function _checkpointDecay(
        DecayingTokenStorage storage $,
        address account
    ) internal returns (uint256 checkpointBalance) {
        uint256 checkpointTimestamp = $.decayCheckpointTimestamp[account];
        checkpointBalance = $.decayCheckpointBalance[account];
        if (checkpointTimestamp == 0 || checkpointBalance == 0) return checkpointBalance;

        // Whole-day truncation is intentional; retain the partial interval in the checkpoint.
        // slither-disable-next-line divide-before-multiply
        uint256 completeDays = (block.timestamp - checkpointTimestamp) / 1 days;
        // Zero complete days is the intended boundary check, not an authorization condition.
        // slither-disable-next-line incorrect-equality
        if (completeDays == 0) return checkpointBalance;

        checkpointBalance = calculateDecayForDays(checkpointBalance, completeDays);
        $.decayCheckpointBalance[account] = checkpointBalance;
        $.decayCheckpointTimestamp[account] = checkpointTimestamp + completeDays * 1 days;
        // An exactly exhausted balance intentionally clears the account's decay schedule.
        // slither-disable-next-line incorrect-equality
        if (checkpointBalance == 0) $.decayCheckpointTimestamp[account] = 0;
    }

    /// @dev Stores a displayed balance without resetting an existing partial-day interval. Consequently, new value
    /// added to a nonzero account joins that account's current schedule.
    function _storeDecayCheckpoint(
        DecayingTokenStorage storage $,
        address account,
        uint256 checkpointBalance
    ) internal {
        $.decayCheckpointBalance[account] = checkpointBalance;
        // Zero represents the absence of a running decay schedule.
        // slither-disable-next-line incorrect-equality
        if (checkpointBalance == 0) {
            $.decayCheckpointTimestamp[account] = 0;
        } else if ($.decayCheckpointTimestamp[account] == 0) {
            $.decayCheckpointTimestamp[account] = block.timestamp;
        }
    }

    function _setRoleAuthority(address newRoleAuthority) internal {
        if (newRoleAuthority == address(0) || newRoleAuthority.code.length == 0) {
            revert InvalidRoleAuthority(newRoleAuthority);
        }

        DecayingTokenStorage storage $ = _getDecayingTokenStorage();
        address oldRoleAuthority = address($.roleAuthority);
        $.roleAuthority = IAccessControl(newRoleAuthority);
        emit RoleAuthorityChanged(oldRoleAuthority, newRoleAuthority);
    }

    function _setDecayRatePerDay(uint256 newDecayRatePerDay) internal {
        if (newDecayRatePerDay > MAX_DECAY_RATE_PER_DAY) {
            revert InvalidDecayRatePerDay(newDecayRatePerDay, MAX_DECAY_RATE_PER_DAY);
        }

        DecayingTokenStorage storage $ = _getDecayingTokenStorage();
        uint256 oldDecayRatePerDay = $.decayRatePerDay;
        $.decayRatePerDay = newDecayRatePerDay;
        emit DecayRatePerDayChanged(oldDecayRatePerDay, newDecayRatePerDay);
    }

    function _checkBurnOrMintPermission() internal view {
        address sender = _msgSender();
        if (
            sender == owner() ||
            roleAuthority().hasRole(VillageRoles.BOOKING_PLATFORM_ROLE, sender) ||
            roleAuthority().hasRole(VillageRoles.BOOKING_MANAGER_ROLE, sender)
        ) {
            return;
        }

        revert Unauthorized(sender, VillageRoles.BOOKING_MANAGER_ROLE);
    }

    function _registerHolderIfNeeded(address holder) internal {
        DecayingTokenStorage storage $ = _getDecayingTokenStorage();
        if ($.isHolder[holder]) return;
        $.isHolder[holder] = true;
        $.holders.push(holder);
    }

    function _update(address from, address to, uint256 amount) internal virtual override {
        if (from != address(0) && to != address(0)) {
            revert TransferNotAllowed();
        }
        super._update(from, to, amount);
    }

    function _approve(address owner_, address spender, uint256 amount, bool emitEvent) internal pure override {
        owner_;
        spender;
        amount;
        emitEvent;
        revert ApproveNotAllowed();
    }

    function _getDecayingTokenStorage() internal pure returns (DecayingTokenStorage storage $) {
        uint256 storageLocation = erc7201("closer.storage.ERC20NonTransferableDecaying");
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            $.slot := storageLocation
        }
    }
}
