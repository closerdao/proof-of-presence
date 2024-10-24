// SPDX-License-Identifier: AGPL-1.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "../diamond/libraries/AccessControlLib.sol";
import "../diamond/libraries/AppStorage.sol";

// TODO is there a better way how to e.g. auto generate the interface for all the methods on diamond automatically,
//  so it's always up to date and no need to write it manually?
interface TDFDiamond {
    function hasRole(bytes32 role, address account) external view returns (bool);
}

contract PresenceToken is ERC20Upgradeable, Ownable2StepUpgradeable {
    /*----------------------------------------------------------*|
    |*  # VARIABLES & CONSTANTS DEFINITIONS                     *|
    |*----------------------------------------------------------*/

    // TODO what is correct value to use here?
    uint256 public constant DECAY_RATE_PER_DAY_DECIMALS = 6;

    // TODO what is the best value here?
    uint256 public constant MAX_DECAY_RATE_PER_DAY = 219_178; // equals to ~80% decay per year
    // TODO set also minimal decay? or let it allow 0?

    /**
     * Set by DAO, value allows up to DECAY_RATE_PER_DAY_DECIMALS. We assume that year have 365 days for a simplicity.
     * Example: 
     *          8% decay rate per year 
     *          => 8 / 365 = 0.02191780822% decay rate per day 
     *          => 0.02191780822 * 10^DECAY_RATE_PER_DAY_DECIMALS = 21 917.80822
     *          => 21 917 (after removal of the decimal part) == final value of decayRatePerDay set when targetting 8% decay rate per day
     */
    uint256 public decayRatePerDay;

    // TODO make these public or private?
    mapping(address => uint256) public lastDecayTimestamp;
    mapping(address => uint256) public lastDecayedBalance;
    /**
     * @dev necessary for iterating over `lastDecayedBalance` mapping when calculating decayed totalSupply
     */
    address[] public holders; 

    // TODO can this be public?
    // TODO is there a better way to get the roles from dao?
    TDFDiamond public tdfDiamond;

    // TODO also add setter?
    address public daoContractAddress;

    /*----------------------------------------------------------*|
    |*  # ERRORS DEFINITIONS                                    *|
    |*----------------------------------------------------------*/

    /**
     * @notice Thrown when trying to transfer PresenceToken from one address to another. Only minting and burning is allowed.
     */
    error TransferNotAllowed();

    /**
     * @notice Thrown when trying to call approve. Since PresenceToken is non-transferrable, it does not make sense to enable approvals.
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

    /*----------------------------------------------------------*|
    |*  # MODIFIERS DEFINITIONS                                    *|
    |*----------------------------------------------------------*/

    modifier onlyDAOorOwner() {
        bool isOwner = owner() == _msgSender();
        bool isDao = address(daoContractAddress) == _msgSender();

        if (!isOwner && !isDao) {
            string[] memory allowedRoles = new string[](2);
            allowedRoles[0] = "OWNER";
            allowedRoles[1] = "DAO";
            revert Unauthorized({sender: _msgSender(), allowedRoles: allowedRoles});
        }
        _;
    }

    /*----------------------------------------------------------*|
    |*  # CONSTRUCTOR                                           *|
    |*----------------------------------------------------------*/

    // TODO pass ERC20 name + symbol as a parameter?
    function initialize(
        address _tdfDiamond,
        address _daoContractAddress,
        uint256 _decayRatePerDay
    ) public initializer {
        __PresenceToken_init(_tdfDiamond, _daoContractAddress, _decayRatePerDay);
    }

    function __PresenceToken_init(
        address _tdfDiamond,
        address _daoContractAddress,
        uint256 _decayRatePerDay
    ) internal onlyInitializing {
        __ERC20_init("TDF Presence", "$PRESENCE"); // TODO is this name + symbol good?
        __Ownable2Step_init(); // TODO do we need to call this?
        __PresenceToken_init_unchained(_tdfDiamond, _daoContractAddress, _decayRatePerDay);
    }

    function __PresenceToken_init_unchained(
        address _tdfDiamond,
        address _daoContractAddress,
        uint256 _decayRatePerDay
    ) internal onlyInitializing {
        tdfDiamond = TDFDiamond(_tdfDiamond);
        daoContractAddress = _daoContractAddress;
        setDecayRatePerDay(_decayRatePerDay);
        // TODO anything else to put here?
    }

    /*----------------------------------------------------------*|
    |*  # PUBLIC / EXTERNAL STATE-MUTATING FUNCTIONS            *|
    |*----------------------------------------------------------*/

    // TODO do we need this setter or the diamond will never change?
    // TODO any other role can change this? currently the owner of the PresenceToken == owner of TDF Diamond
    function setTdfDiamond(address _newTdfDiamond) public onlyOwner {
        tdfDiamond = TDFDiamond(_newTdfDiamond);
    }

    // TODO allow onlyOwner?
    // TODO allow someone else?
    // TODO does this make sense or we will need to manually track when every token was minted to correctly
    //  calculate this?
    struct BurnData {
        uint256 amount;
        uint256 daysAgo;
    }

    function burn(address account, BurnData[] memory burnDataArray) external onlyOwner {
        uint256 nonDecayedAmountToBurn = 0;
        uint256 decayedAmountToSubstract = 0;

        for (uint256 i = 0; i < burnDataArray.length; i++) {
            nonDecayedAmountToBurn += burnDataArray[i].amount;
            decayedAmountToSubstract += calculateDecayForDays(burnDataArray[i].amount, burnDataArray[i].daysAgo);
        }

        // TODO check here if it's not negative?
        lastDecayedBalance[account] -= decayedAmountToSubstract;
        // TODO we should probably not update the timestamp here, but let's make sure.
        ERC20Upgradeable._burn(account, nonDecayedAmountToBurn);
    }

    // TODO allow onlyOwner?
    // TODO allow someone else? maybe DAO in case of some ban of a person?
    function burnAll(address account) external onlyOwner {
        ERC20Upgradeable._burn(account, nonDecayedBalanceOf(account));
        lastDecayedBalance[account] = 0;
        lastDecayTimestamp[account] = 0;
    }

    // TODO override _mint() or mint()?
    // TODO external or public?
    // TODO allow also owner of this contract to call it?
    // TODO allow dao to call this?
    function mint(address account, uint256 amount) external {
        bytes32[] memory allowedRoles = new bytes32[](2);
        allowedRoles[0] = AccessControlLib.BOOKING_PLATFORM_ROLE;
        allowedRoles[1] = AccessControlLib.BOOKING_MANAGER_ROLE;
        if (!checkPermission(allowedRoles)) {
            string[] memory allowedRolesStr = new string[](2);
            allowedRoles[0] = "BOOKING_PLATFORM_ROLE";
            allowedRoles[1] = "BOOKING_MANAGER_ROLE";
            revert Unauthorized({sender: _msgSender(), allowedRoles: allowedRolesStr});
        }

        addHolderIfNotExists(_msgSender());
        lastDecayedBalance[_msgSender()] = calculateDecayedBalance(_msgSender()) + amount;
        lastDecayTimestamp[_msgSender()] = block.timestamp;

        _mint(account, amount);
    }

    // TODO allow also owner to call this or only dao?
    function setDecayRatePerDay(uint256 _newDecayRatePerDay) public onlyDAOorOwner {
        if (_newDecayRatePerDay > MAX_DECAY_RATE_PER_DAY) {
            revert InvalidDecayRatePerDay({ value: _newDecayRatePerDay, maxAllowedValue: MAX_DECAY_RATE_PER_DAY });
        }

        decayRatePerDay = _newDecayRatePerDay;
    }

    /*----------------------------------------------------------*|
    |*  # PUBLIC / EXTERNAL VIEW/PURE FUNCTIONS                 *|
    |*----------------------------------------------------------*/

    function nonDecayedBalanceOf(address _account) public view returns (uint256) {
        // TODO super. or ERC20Upgradeable here?
        return ERC20Upgradeable.balanceOf(_account);
    }

    function balanceOf(address _account) public view override returns (uint256 balance) {
        return calculateDecayedBalance(_account);
    }

    function nonDecayedTotalSupply() public view returns (uint256) {
        // TODO super. or ERC20Upgradeable here?
        return ERC20Upgradeable.totalSupply();
    }

    function totalSupply() public view override returns (uint256 decayedTotalSupply) {
        decayedTotalSupply = 0;
        for (uint256 i = 0; i < holders.length; i++) {
            decayedTotalSupply += balanceOf(holders[i]);
        }
        return decayedTotalSupply;
    }

    /*----------------------------------------------------------*|
    |*  # INTERNAL FUNCTIONS                                    *|
    |*----------------------------------------------------------*/

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        // allow only minting or burning
        if (from != address(0) && to != address(0)) {
            revert TransferNotAllowed();
        }
        // TODO super. or ERC20Upgradeable here?
        super._beforeTokenTransfer(from, to, amount);
    }

    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) internal pure override {
        owner;
        spender;
        amount;
        revert ApproveNotAllowed();
    }

    function calculateDecayForDays(uint256 amount, uint256 daysAgo) internal view returns (uint256) {
        if (daysAgo > 0) {
            for (uint256 i = 0; i < daysAgo; i++) {
                uint256 amountToSubstract = (amount / 100) * (decayRatePerDay / 100);
                amount -= amountToSubstract;
            }
        }
        return amount;
    }

    function calculateDecayedBalance(address userAddress) internal view returns (uint256 balance) {
        uint256 lastUserDecayTimestamp = lastDecayTimestamp[userAddress];
        balance = lastDecayedBalance[userAddress];
        if (lastUserDecayTimestamp == 0 || balance == 0) {
            return 0;
        }

        uint256 passedDays = (block.timestamp - lastUserDecayTimestamp) / 86_400;
        return calculateDecayForDays(balance, passedDays);
    }

    function checkPermission(bytes32[] memory _allowedRoles) internal view returns (bool) {
        for (uint256 i = 0; i < _allowedRoles.length; i++) {
            if (tdfDiamond.hasRole(_allowedRoles[i], _msgSender())) {
                return true;
            }
        }

        return false;
    }

    function addHolderIfNotExists(address holder) internal returns (bool wasAdded) {
        bool exists = false;
        wasAdded = false;
        for (uint256 i = 0; i < holders.length; i++) {
            if (holder == holders[i]) {
                exists = true;
                break;
            }
        }

        if (!exists) {
            wasAdded = true;
            holders.push(holder);
        }

        return wasAdded;
    }
}
