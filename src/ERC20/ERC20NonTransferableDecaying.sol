// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "../diamond/libraries/AccessControlLib.sol";
import "../Libraries/FixedPointMathLib.sol";

interface IDiamondRoleChecker {
    function hasRole(bytes32 role, address account) external view returns (bool);
}

/**
 * @title Abstract base for non-transferable ERC20 tokens with continuous decay.
 * @dev The decay functionality is implemented with following logic:
 *          Prerequisites:
 *              - since the token is non-transferrable, the account's balance can only change when:
 *                  - minting
 *                  - burning
 *
 *          The fact that the token is non-transferrable means that we do not need to handle
 *          the balance changes during transfers, but only during the `mint`, `burn` and `balanceOf` functions.
 *
 *          There are 2 additional mappings introduced:
 *              - lastDecayedBalance[account]: this one stores the last calculated decayed balance
 *              - lastDecayedTimestamp[account]: this one stores the timestamp when we last calculated a new decayed balance
 *          Both these mappings are updated only inside the `mint` and `burn` function.
 *
 *          We also override the `balanceOf` function, where we calculate the current decayed balance, using
 *          the 2 mappings `lastDecayedBalance` and `lastDecayedTimestamp`. Additional decay calculation on top of these
 *          2 mappings is necessary inside the `balanceOf` function because the values in these mappings are not regularly updated
 *          so they can contain even e.g. 1 year+ outdated data (if the user did not mint or burn any token during that time),
 *          but inside the `balanceOf` function we want to return the current decayed balance at the time of calling.
 *
 *          Inside `mint` and `burn` we update these 2 mappings to make sure that the decay for each token is calculated correctly.
 *          Example:
 *              - assume ~10% decay per day
 *              1) Mint 1 token
 *              2) Wait 2 days
 *              3) Now the balance is ~0.81 token
 *              4) Mint 1 token, so the total balance is ~1.81 token
 *              5) Wait 1 day
 *              6) The final balance is 1.629 token
 *          If we would not recalculate the decayed balance on the mint of additional token, at the step 6 we would not know
 *          when each token has been minted. So that's why there are these 2 additional mappings introduced. By recalculating the decayed balance on
 *          every balance change, we do not need to store full history of when each token has been minted, as it's sufficient on balance change to
 *          just recalculate the previous decayed balance and then add the new minted tokens to that.
 *
 *          With burning the situation is a little bit more tricky, as there is a difference if I would like to burn a token
 *          minted 10 days ago or 2 days ago, as the one minted 10 days ago decayed already more than the one 2 days ago. Because of that
 *          it's necessary to pass to the `burn` function also how many days ago the token was minted. Here we assume that the booking platform
 *          will know for which dates it actually wants to burn the tokens, as the burning will most likely happen only when the person
 *          did not stay at the property, despite having the booking.
 */
abstract contract ERC20NonTransferableDecaying is ERC20Upgradeable, Ownable2StepUpgradeable {
    /*----------------------------------------------------------*|
    |*  # VARIABLES & CONSTANTS DEFINITIONS                     *|
    |*----------------------------------------------------------*/

    /**
     * @notice used for accessing user roles stored in DAO + allow DAO setting a decay rate
     */
    IDiamondRoleChecker public daoAddress;

    /*----------------------------------------------------------*|
    |*  # VARIABLES FOR DECAY FUNCTIONALITY                     *|
    |*----------------------------------------------------------*/

    /**
     * @notice denominated in wei, used for preventing underflows when small rounding error happens (e.g. during burn)
     */
    uint256 public constant MAX_ALLOWED_ROUNDING_ERROR = 100_000;

    uint256 public constant DECAY_RATE_PER_DAY_DECIMALS = 9;

    uint256 public constant MAX_DECAY_RATE_PER_DAY = 4_399_711; // equals to ~80% decay per year

    uint256 public constant PRECISION_SCALE = 1e18; // used for decimal arithmetic operation

    /**
     * @notice Holds decimal decay rate per day, the value is padded by DECAY_RATE_PER_DAY_DECIMALS
     * @notice This value is set on contract init and after that is possible to overwrite by DAO address
     * @custom:see getDecayRatePerDay function for more info and examples about how to calculate value
     *          for this variable, e.g. for 10% decay rate per year
     */
    uint256 public decayRatePerDay;

    /**
     * @notice mapping that holds timestamp of last decay... this value is updated either during `mint` or `burn`
     */
    mapping(address => uint256) public lastDecayTimestamp;
    /**
     * @notice mapping that holds last decayed balances... this value is updated (decayed) either during `mint` or `burn`
     */
    mapping(address => uint256) public lastDecayedBalance;
    /**
     * @dev necessary for iterating over `lastDecayedBalance` mapping when calculating decayed totalSupply
     */
    address[] public holders;
    /**
     * @dev used for speeding up / gas savings when need to check if the account is in `holders` array
     */
    mapping(address => bool) public isHolder;

    /*----------------------------------------------------------*|
    |*  # EVENTS DEFINITIONS                                    *|
    |*----------------------------------------------------------*/

    event DaoAddressChanged(address indexed oldAddress, address indexed newAddress);

    event DecayRatePerDayChanged(uint256 oldDecayRatePerDay, uint256 newDecayRatePerDay);

    event MintWithDecay(
        address indexed account,
        uint256 mintedAmount,
        uint256 decayedMintedAmount,
        uint256 mintedForDaysAgo
    );

    event BurnWithDecay(
        address indexed account,
        uint256 burnedAmount,
        uint256 decayedBurnedAmount,
        uint256 burnedForDaysAgo
    );

    event BurnAllUserTokens(address indexed account);

    /*----------------------------------------------------------*|
    |*  # ERRORS DEFINITIONS                                    *|
    |*----------------------------------------------------------*/

    /**
     * @notice Thrown when trying to transfer token from one address to another. Only minting and burning is allowed.
     */
    error TransferNotAllowed();

    /**
     * @notice Thrown when trying to call approve. Since the token is non-transferrable, it does not make sense to enable approvals.
     */
    error ApproveNotAllowed();

    /**
     * @notice Thrown when a function is called by not allowed address.
     */
    error Unauthorized(address sender, string[] allowedRoles);

    /**
     * @notice Thrown when trying to set invalid decayRatePerDay.
     */
    error InvalidDecayRatePerDay(uint256 value, uint256 maxAllowedValue);

    error MintDataEmpty();

    error MintWithZeroAmount();

    error BurnDataEmpty();

    error BurnAmountExceedsDecayedBalance(
        uint256 nonDecayedAmountToBurn,
        uint256 decayedAmountToBurn,
        uint256 nonDecayedUserBalance,
        uint256 decayedUserBalance
    );

    error InvalidDaoAddress(address invalidDaoAddress);

    /*----------------------------------------------------------*|
    |*  # INITIALIZER                                           *|
    |*----------------------------------------------------------*/

    function __ERC20NonTransferableDecaying_init(
        string memory name_,
        string memory symbol_,
        address daoAddress_,
        uint256 decayRatePerDay_
    ) internal onlyInitializing {
        __ERC20_init(name_, symbol_);
        __Ownable2Step_init();
        __ERC20NonTransferableDecaying_init_unchained(daoAddress_, decayRatePerDay_);
    }

    function __ERC20NonTransferableDecaying_init_unchained(
        address daoAddress_,
        uint256 decayRatePerDay_
    ) internal onlyInitializing {
        setDaoAddress(daoAddress_);
        setDecayRatePerDay(decayRatePerDay_);
    }

    /*----------------------------------------------------------*|
    |*  # SETTERS                                               *|
    |*----------------------------------------------------------*/

    /**
     * @notice This function can be only called by the owner of this contract, which is TDF Multisig
     * @param newDaoAddress updated dao address
     */
    function setDaoAddress(address newDaoAddress) public onlyOwner {
        if (newDaoAddress == address(0) || newDaoAddress.code.length == 0) {
            revert InvalidDaoAddress({invalidDaoAddress: newDaoAddress});
        }
        address oldAddress = address(daoAddress);
        daoAddress = IDiamondRoleChecker(newDaoAddress);
        emit DaoAddressChanged(oldAddress, newDaoAddress);
    }

    /**
     * @notice This function can be only called by the owner of this contract, which is TDF Multisig
     * @param newDecayRatePerDay updated decay rate
     */
    function setDecayRatePerDay(uint256 newDecayRatePerDay) public onlyOwner {
        if (newDecayRatePerDay > MAX_DECAY_RATE_PER_DAY) {
            revert InvalidDecayRatePerDay({value: newDecayRatePerDay, maxAllowedValue: MAX_DECAY_RATE_PER_DAY});
        }

        uint256 oldDecayRatePerDay = decayRatePerDay;
        decayRatePerDay = newDecayRatePerDay;
        emit DecayRatePerDayChanged(oldDecayRatePerDay, newDecayRatePerDay);
    }

    /*----------------------------------------------------------*|
    |*  # GETTERS                                               *|
    |*----------------------------------------------------------*/

    function nonDecayedBalanceOf(address account) public view returns (uint256) {
        return ERC20Upgradeable.balanceOf(account);
    }

    function nonDecayedTotalSupply() public view returns (uint256) {
        return ERC20Upgradeable.totalSupply();
    }

    /**
     * @notice Override of the standard balanceOf function that takes into the account gradual decay of user balance
     * @return Current decayed balance of the user.
     */
    function balanceOf(address account) public view override returns (uint256) {
        return calculateDecayedBalance(account);
    }

    /**
     * @notice Override of the standard totalSupply function that takes into the account gradual decay of user balances
     * @dev In order to get the decayed balance of each user at the time of calling this function, we need to iterate
     *          over the `holders` array, which makes this function gas expensive. Ideally do not use this inside
     *          state-mutating functions, only in the external getters. I could not change the modifier from `public` to `external`
     *          since the ERC20Upgradeable from OpenZeppelin declares this function with `public` modifier.
     * @return decayedTotalSupply
     */
    function totalSupply() public view override returns (uint256 decayedTotalSupply) {
        decayedTotalSupply = 0;
        uint256 holdersLength = holders.length;
        for (uint256 i = 0; i < holdersLength; i++) {
            decayedTotalSupply += balanceOf(holders[i]);
        }
        return decayedTotalSupply;
    }

    /*----------------------------------------------------------*|
    |*  # DECAY CALCULATIONS                                    *|
    |*----------------------------------------------------------*/

    // NOTE: For all decay calculations we assume here that the year has 365 days.

    /**
     * @notice Calculates decay over a number of days with high precision
     * @notice Basic formula: [initialAmount] * (1 - [percentageDecayPerDay] / 100)^[numberOfDays]
     * @param amount The initial amount (with 18 decimals)
     * @param daysAgo Number of days to calculate decay for, when 0 it returns the `amount`
     * @return The decayed amount (with 18 decimals)
     */
    function calculateDecayForDays(uint256 amount, uint256 daysAgo) public view returns (uint256) {
        if (daysAgo == 0) return amount;

        // Convert decay rate to 18 decimal precision
        uint256 decayRateScaled = (decayRatePerDay * PRECISION_SCALE) / (10 ** DECAY_RATE_PER_DAY_DECIMALS);

        // Calculate (1 - decayRate) with 18 decimals precision
        uint256 retentionRate = PRECISION_SCALE - decayRateScaled;

        // Calculate (1 - decayRate)^daysAgo
        uint256 totalRetentionRate = FixedPointMathLib.powWithPrecision(retentionRate, daysAgo);

        // Calculate final amount
        return FixedPointMathLib.mulDiv(amount, totalRetentionRate, PRECISION_SCALE);
    }

    /**
     * @param account to get the decayed balance for
     * @return account's decayed balance at the time of calling this function
     */
    function calculateDecayedBalance(address account) internal view returns (uint256) {
        uint256 lastUserDecayTimestamp = lastDecayTimestamp[account];
        if (lastUserDecayTimestamp == 0) {
            // can only happen when account either did not mint any tokens or all of account tokens were burnt
            return 0;
        }

        uint256 balance = lastDecayedBalance[account];
        if (balance == 0) {
            return 0;
        }

        // we only care about full passed days, so the integer division is correct here
        uint256 passedDays = (block.timestamp - lastUserDecayTimestamp) / 86_400;
        return calculateDecayForDays(balance, passedDays);
    }

    /**
     * DECAY RATE PER DAY =>. DECAY RATE PER YEAR
     * @notice Converts a daily decay rate to a yearly decay rate
     * @notice Basic formula: 1 - (1 - [percentageDecayPerDay] / 100)^365
     * @param decayRatePerDay_ should be multiplied by 10^DECAY_RATE_PER_DAY_DECIMALS
     *          so for example:
     *              a) start with percentage decay per day: 0.028_8617%
     *              b) now we need to convert it to decimal form: 0.028_8617 / 100 == 0.000_288_617
     *              c) now we multiply by the decimals: 0.000_288_617 * 10^DECAY_RATE_PER_DECIMALS == 288_617
     * @return decayRatePerYear multiplied by 10^DECAY_RATE_PER_DAY_DECIMALS
     * @notice to get the decimal representation, divide the result by `10^DECAY_RATE_PER_DAY_DECIMALS`...
     * @notice to get the percentage representation, divide the result by `10^(DECAY_RATE_PER_DAY_DECIMALS - 2)`
     */
    function getDecayRatePerYear(uint256 decayRatePerDay_) public pure returns (uint256 decayRatePerYear) {
        // Convert daily decay rate to 18 decimal precision for calculations
        uint256 decayRateScaled = (decayRatePerDay_ * PRECISION_SCALE) / (10 ** DECAY_RATE_PER_DAY_DECIMALS);

        // Calculate retention rate (1 - daily_decay_rate)
        uint256 dailyRetentionRate = PRECISION_SCALE - decayRateScaled;

        // Calculate (1 - daily_decay_rate)^365
        uint256 yearlyRetentionRate = FixedPointMathLib.powWithPrecision(dailyRetentionRate, 365);

        // Calculate yearly decay rate = 1 - (1 - daily_decay_rate)^365
        uint256 yearlyDecayRateScaled = PRECISION_SCALE - yearlyRetentionRate;

        // Convert back to 9 decimal precision
        return (yearlyDecayRateScaled * (10 ** DECAY_RATE_PER_DAY_DECIMALS)) / PRECISION_SCALE;
    }

    /**
     * @return Decay rate per year for currently used decayRatePerDay in contract. The result is multiplied by 10^DECAY_RATE_PER_DAY_DECIMALS
     */
    function getCurrentDecayRatePerYear() public view returns (uint256) {
        return getDecayRatePerYear(decayRatePerDay);
    }

    /**
     * DECAY RATE PER YEAR => DECAY RATE PER DAY
     * @notice Converts a yearly decay rate to a daily decay rate
     * @notice Basic formula: 1 - (1 - [percentageDecayPerYear] / 100)^(1/365)
     * @param decayRatePerYear should be multiplied by 10^DECAY_RATE_PER_DAY_DECIMALS, see the getDecayRatePerYear function docs
     *          for more info about how to format this parameter
     * @return Daily decay rate multiplied by 10^DECAY_RATE_PER_DAY_DECIMALS
     * @notice to get the decimal representation, divide the result by `10^DECAY_RATE_PER_DAY_DECIMALS`...
     * @notice to get the percentage representation, divide the result by `10^(DECAY_RATE_PER_DAY_DECIMALS - 2)`
     */
    function getDecayRatePerDay(uint256 decayRatePerYear) external pure returns (uint256) {
        // Calculate yearly retention rate = (1 - yearly_decay_rate)
        // Both sides scaled to 9 decimals
        uint256 yearlyRetentionRateScaled = 10 ** DECAY_RATE_PER_DAY_DECIMALS - decayRatePerYear;

        // Convert to 18 decimals for higher precision in calculations
        uint256 yearlyRetentionRate = (yearlyRetentionRateScaled * PRECISION_SCALE) /
            (10 ** DECAY_RATE_PER_DAY_DECIMALS);

        // Calculate daily retention rate = (1 - yearly_decay_rate)^(1/365)
        uint256 dailyRetentionRate = FixedPointMathLib.nthRoot(yearlyRetentionRate, 365);

        // Calculate daily decay rate = 1 - daily_retention_rate
        uint256 dailyDecayRateScaled = PRECISION_SCALE - dailyRetentionRate;

        // Convert back to 9 decimal precision
        return (dailyDecayRateScaled * (10 ** DECAY_RATE_PER_DAY_DECIMALS)) / PRECISION_SCALE;
    }

    /*----------------------------------------------------------*|
    |*  # MINTING                                               *|
    |*----------------------------------------------------------*/

    /**
     * Classic ERC20 minting extended with additional logic for the decay calculation.
     * Whenever a new token is minted, we recalculate the lastDecayedBalance plus add the
     * minted amount to it. We also update lastDecayTimestamp.
     * If we recalculate the decayed on every balance change (which can happen only
     * during mint or burn, as the token is non-transferrable) and update
     * the lastDecayTimestamp, we do not need to hold the mapping when each token was created to be able
     * to correctly calculate the decayed balance.
     */
    function _mint(address account, uint256 amount, uint256 daysAgo) internal {
        if (amount == 0) {
            revert MintWithZeroAmount();
        }

        addHolderIfNotExists(account);
        uint256 decayedMintedAmount = calculateDecayForDays(amount, daysAgo);
        emit MintWithDecay({
            account: account,
            mintedAmount: amount,
            decayedMintedAmount: decayedMintedAmount,
            mintedForDaysAgo: daysAgo
        });
        lastDecayedBalance[account] = calculateDecayedBalance(account) + decayedMintedAmount;
        lastDecayTimestamp[account] = block.timestamp;
        ERC20Upgradeable._mint(account, amount);
    }

    function mint(address account, uint256 amount, uint256 daysAgo) external {
        checkBurnOrMintPermission();
        _mint(account, amount, daysAgo);
    }

    struct MintData {
        address account;
        uint256 amount;
        uint256 daysAgo;
    }

    /**
     * @notice Batch mint function, possibly useful for saving gas when want to mint tokens for multiple accounts.
     */
    function mintBatch(MintData[] calldata mintDataArray) external {
        uint256 mintDataArrayLength = mintDataArray.length;
        if (mintDataArrayLength == 0) {
            revert MintDataEmpty();
        }

        checkBurnOrMintPermission();
        for (uint256 i = 0; i < mintDataArrayLength; ) {
            _mint(mintDataArray[i].account, mintDataArray[i].amount, mintDataArray[i].daysAgo);
            unchecked {
                ++i;
            }
        }
    }

    /*----------------------------------------------------------*|
    |*  # BURNING                                               *|
    |*----------------------------------------------------------*/

    struct BurnData {
        uint256 daysAgo;
        uint256 amount;
    }

    /**
     * @notice Burn tokens for a user.
     * @notice This function can be only called by the owner of the contract, which will be the TDF Multisig.
     * @param account to burn the tokens for
     * @param burnDataArray array of struct{amount,daysAgo}. It's necessary to pass the `daysAgo` in order to also
     *          correctly calculate and update the decayed balance (=> token minted 10 days ago is already
     *          more decayed than token minted 2 days ago, so for us to correctly calculate the decayed
     *          balance to burn, we need to know when the token was minted).
     * @return finalBalance Account's decayed balance after burning.
     */
    function burn(address account, BurnData[] calldata burnDataArray) external returns (uint256 finalBalance) {
        checkBurnOrMintPermission();

        uint256 burnDataArrayLength = burnDataArray.length;
        if (burnDataArrayLength == 0) {
            revert BurnDataEmpty();
        }

        uint256 nonDecayedAmountToBurn;
        uint256 decayedAmountToBurn;

        for (uint256 i = 0; i < burnDataArrayLength; ) {
            nonDecayedAmountToBurn += burnDataArray[i].amount;
            uint256 decayedBurnedAmount = calculateDecayForDays(burnDataArray[i].amount, burnDataArray[i].daysAgo);
            decayedAmountToBurn += decayedBurnedAmount;
            emit BurnWithDecay({
                account: account,
                burnedAmount: burnDataArray[i].amount,
                decayedBurnedAmount: decayedBurnedAmount,
                burnedForDaysAgo: burnDataArray[i].daysAgo
            });
            unchecked {
                ++i;
            }
        }

        // update decayed balances and timestamp before burning
        finalBalance = calculateDecayedBalance(account);
        lastDecayedBalance[account] = finalBalance;
        lastDecayTimestamp[account] = block.timestamp;

        if (decayedAmountToBurn > finalBalance) {
            // In a certain cases there are some very small rounding arithmetic
            // differences in the calculations, so this should prevent the `burn`
            // from underflow revert, if the difference is very small (MAX_ALLOWED_ROUNDING_ERROR wei)
            uint256 difference = decayedAmountToBurn - finalBalance;
            if (difference > MAX_ALLOWED_ROUNDING_ERROR) {
                revert BurnAmountExceedsDecayedBalance({
                    nonDecayedAmountToBurn: nonDecayedAmountToBurn,
                    decayedAmountToBurn: decayedAmountToBurn,
                    nonDecayedUserBalance: nonDecayedBalanceOf(account),
                    decayedUserBalance: finalBalance
                });
            }
            finalBalance = 0;
            lastDecayedBalance[account] = 0;
        } else {
            unchecked {
                finalBalance -= decayedAmountToBurn;
                lastDecayedBalance[account] = finalBalance;
            }
        }

        ERC20Upgradeable._burn(account, nonDecayedAmountToBurn);

        return finalBalance;
    }

    /**
     * @notice Burns all tokens for a given account. Useful e.g. in case of blacklisting a person.
     * @notice This function can be only called by the owner of the contract, which will be the TDF Multisig.
     * @param account to burn all the tokens for
     */
    function burnAll(address account) external onlyOwner {
        ERC20Upgradeable._burn(account, nonDecayedBalanceOf(account));
        lastDecayedBalance[account] = 0;
        lastDecayTimestamp[account] = block.timestamp;
        emit BurnAllUserTokens({account: account});
    }

    /*----------------------------------------------------------*|
    |*  # DISABLE TRANSFERS + APPROVALS                         *|
    |*----------------------------------------------------------*/

    function transferFrom(address from, address to, uint256 amount) public pure virtual override returns (bool) {
        from;
        to;
        amount;
        revert TransferNotAllowed();
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
        // allow only minting or burning
        if (from != address(0) && to != address(0)) {
            revert TransferNotAllowed();
        }
        super._beforeTokenTransfer(from, to, amount);
    }

    function _approve(address owner, address spender, uint256 amount) internal pure override {
        owner;
        spender;
        amount;
        revert ApproveNotAllowed();
    }

    /*----------------------------------------------------------*|
    |*  # HELPER FUNCTIONS                                      *|
    |*----------------------------------------------------------*/

    /**
     * @custom:throws Unauthorized if called by user without permissioned roles
     */
    function checkPermission(
        bytes32[] memory allowedRoles,
        string[] memory allowedRolesStr,
        bool allowOwner
    ) internal view {
        IDiamondRoleChecker daoAddress_ = daoAddress; // read from storage only once

        if (allowOwner && owner() == _msgSender()) {
            return;
        }

        uint256 allowedRolesLength = allowedRoles.length;
        for (uint256 i = 0; i < allowedRolesLength; ) {
            if (daoAddress_.hasRole(allowedRoles[i], _msgSender())) {
                return;
            }
            unchecked {
                ++i;
            }
        }

        revert Unauthorized({sender: _msgSender(), allowedRoles: allowedRolesStr});
    }

    /**
     * @notice only accounts with BOOKING_MANAGER_ROLE or BOOKING_PLATFORM_ROLE should be able to mint new tokens
     * @custom:throws Unauthorized if called by user without permissioned roles
     */
    function checkBurnOrMintPermission() internal view {
        bytes32[] memory allowedRoles = new bytes32[](2);
        allowedRoles[0] = AccessControlLib.BOOKING_PLATFORM_ROLE;
        allowedRoles[1] = AccessControlLib.BOOKING_MANAGER_ROLE;

        string[] memory allowedRolesStr = new string[](2);
        allowedRolesStr[0] = "BOOKING_PLATFORM_ROLE";
        allowedRolesStr[1] = "BOOKING_MANAGER_ROLE";
        checkPermission(allowedRoles, allowedRolesStr, true);
    }

    function addHolderIfNotExists(address holder) internal returns (bool wasAdded) {
        wasAdded = false;
        if (!isHolder[holder]) {
            wasAdded = true;
            isHolder[holder] = true;
            holders.push(holder);
        }
        return wasAdded;
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;
}
