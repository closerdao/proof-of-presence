// SPDX-License-Identifier: AGPL-1.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "../Interfaces/ISweatToken.sol";
import "../Libraries/FixedPointMathLib.sol";

contract SweatToken is ISweatToken, ERC20Upgradeable, Ownable2StepUpgradeable {
    // Address of treasury, which is allowed to transfer tokens from its address to another
    address public treasury;

    /*----------------------------------------------------------*|
    |*  # VARIABLES FOR DECAY FUNCTIONALITY                     *|
    |*----------------------------------------------------------*/

    /**
     * @notice denominated in wei, used for preventing underflows when small rounding error happens
     */
    uint256 public constant MAX_ALLOWED_ROUNDING_ERROR = 100_000;

    uint256 public constant DECAY_RATE_PER_DAY_DECIMALS = 9;

    uint256 public constant MAX_DECAY_RATE_PER_DAY = 4_399_711; // equals to ~80% decay per year

    uint256 public constant PRECISION_SCALE = 1e18; // used for decimal arithmetic operation

    /**
     * @notice Holds decimal decay rate per day, the value is padded by DECAY_RATE_PER_DAY_DECIMALS
     * @notice Linear decay: 10% per year / 365 days = 0.02739726027% per day
     * @notice This value is set on contract init and after that is possible to overwrite by owner
     */
    uint256 public decayRatePerDay;

    /**
     * @notice mapping that holds timestamp of last decay... this value is updated during `mint`
     */
    mapping(address => uint256) public lastDecayTimestamp;
    /**
     * @notice mapping that holds last decayed balances... this value is updated (decayed) during `mint`
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

    event SweatMinted(address indexed receiver, uint256 indexed amount, uint256 indexed timestamp);

    event DecayRatePerDayChanged(uint256 oldDecayRatePerDay, uint256 newDecayRatePerDay);

    /*----------------------------------------------------------*|
    |*  # ERRORS DEFINITIONS                                    *|
    |*----------------------------------------------------------*/

    /**
     * @notice Thrown when trying to set invalid decayRatePerDay.
     */
    error InvalidDecayRatePerDay(uint256 value, uint256 maxAllowedValue);

    /*----------------------------------------------------------*|
    |*  # CONSTRUCTOR                                           *|
    |*----------------------------------------------------------*/

    function initialize(address _treasury, uint256 decayRatePerDay_) public initializer {
        __SweatToken_init(_treasury, decayRatePerDay_);
    }

    function __SweatToken_init(address _treasury, uint256 decayRatePerDay_) internal onlyInitializing {
        __ERC20_init("TDF Sweat", "SWEAT");
        __Ownable2Step_init();
        __SweatToken_init_unchained(_treasury, decayRatePerDay_);
    }

    function __SweatToken_init_unchained(address _treasury, uint256 decayRatePerDay_) internal onlyInitializing {
        treasury = _treasury;
        setDecayRatePerDay(decayRatePerDay_);
    }

    /**
     * @notice Initializer for upgrading existing SweatToken contracts to add decay functionality.
     * @dev This function can only be called once on contracts that were deployed with the old initialize(address) function.
     * @param decayRatePerDay_ The decay rate per day to set
     */
    function initializeV2(uint256 decayRatePerDay_) public reinitializer(2) {
        setDecayRatePerDay(decayRatePerDay_);
    }

    /*----------------------------------------------------------*|
    |*  # SETTERS                                               *|
    |*----------------------------------------------------------*/

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
     *          state-mutating functions, only in the external getters.
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
        uint256 decayRateScaled = (decayRatePerDay * PRECISION_SCALE) / (10**DECAY_RATE_PER_DAY_DECIMALS);

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
            // can only happen when account did not mint any tokens
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

    /*----------------------------------------------------------*|
    |*  # MINTING                                               *|
    |*----------------------------------------------------------*/

    /**
     * Mint new $Sweat tokens to address
     */
    function mint(address account, uint256 amount) public onlyOwner {
        addHolderIfNotExists(account);
        // Update the decayed balance before minting
        lastDecayedBalance[account] = calculateDecayedBalance(account) + amount;
        lastDecayTimestamp[account] = block.timestamp;
        _mint(account, amount);
        emit SweatMinted(account, amount, block.timestamp);
    }

    /*----------------------------------------------------------*|
    |*  # HELPER FUNCTIONS                                      *|
    |*----------------------------------------------------------*/

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
     * @dev See {ERC20-_beforeTokenTransfer} - transfer of token is disabled
     *
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);
        if (from != treasury && from != address(0) && to != address(0)) revert SweatToken_SweatIsNonTransferable();
    }
}
