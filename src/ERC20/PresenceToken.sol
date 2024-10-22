// SPDX-License-Identifier: AGPL-1.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "../Interfaces/IPresenceToken.sol";
import "../diamond/libraries/AccessControlLib.sol";
import "../diamond/libraries/AppStorage.sol";

contract PresenceToken is IPresenceToken, ERC20Upgradeable, Ownable2StepUpgradeable {
    // TODO will the treasury be holding $PRESENCE tokens?
    // Address of treasury, which is allowed to transfer tokens from its address to another
    address public treasury;

    // for decay
    uint256 public decayRatePerDay; // set by DAO, allows 2 decimals, e.g. 1% == 100
    mapping(address => uint256) public lastUpdateTime;

    // event PresenceMinted(address indexed receiver, uint256 indexed amount, uint256 indexed timestamp);

    // TODO how to better say to use the modifier from Modifiers.onlyOwner?

    // TODO is there better way to resolve conflicts with the same method implemented on base contracts?
    //function _msgSender() override(Modifiers, ContextUpgradeable) internal view virtual returns (address) {
    //    return msg.sender;
    //}

    //function _msgData() override(Modifiers, ContextUpgradeable) internal view virtual returns (bytes calldata) {
    //    return msg.data;
    //}

    function initialize(address _treasury) public initializer {
        __PresenceToken_init(_treasury);
    }

    function __PresenceToken_init(address _treasury) internal onlyInitializing {
        __ERC20_init("TDF Presence", "Presence");
        __PresenceToken_init_unchained(_treasury);
        __Ownable2Step_init();
    }

    function __PresenceToken_init_unchained(address _treasury) internal onlyInitializing {
        treasury = _treasury;
    }

    // TODO allow DAO too call this function too?
    // TODO external or public?
    // TODO what modifiers to use here?
    function mint(address account, uint256 amount) external {
        _mint(account, amount);
        // emit PresenceMinted(account, amount, block.timestamp);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        if (from != treasury && from != address(0) && to != address(0)) revert PresenceToken_PresenceIsNonTransferable();
        super._beforeTokenTransfer(from, to, amount);
    }

    // TODO what all modifiers to add here?
    // TODO add dates / numbers
    // TODO make numberOfDays smaller uint type than uint256?
    // TODO what roles to allow calling this? BOOKING_PLATFORM_ROLE and some other (e.g. BOOKING_MANAGER_ROLE)?
    function onCheckOut(address _userAddress, uint256 _numberOfDays) 
        external 
        // TODO how to add this onlyRole modifier or check? if i inherit from Modifiers,
        //  it starts printing error messages with clashes between 2 different implementations of 
        //  onlyOwner modifier... is there some way to access the RoleStore from AppStorage independently
        //  here in the contract code?
        // onlyRole(AccessControlLib.BOOKING_PLATFORM_ROLE) 
    {
        _mint(_userAddress, _numberOfDays * 10e18);
    }
    
    // TODO add onlyDao modifier
    function setDecayRatePerDay(uint256 _newDecayRatePerDay) public {
        // TODO add some validation for the _newDecayRatePerDay
        decayRatePerDay = _newDecayRatePerDay;
    }

    // TODO do we need some checkIn function?

    // TODO how the decay will be triggered? it can be either periodically by some script or we can call decay
    //  inside the transfer/approve functions and override balanceOf to return an updated balance of the user
    //  that counts with the decay

    // TODO what modifiers to add here? probably BOOKING_PLATFORM_ROLE and something else?
    // TODO also add function that will decay for all user addresses to not need to call this
    // for each user address separately?
    // TODO what visibility modifier to set here?
    function decay(address _userAddress) public returns (uint256) {
        uint256 userBalance = balanceOf(_userAddress);
        if (userBalance == 0) {
            return 0;
        }

        uint256 lastDecayedAt = lastUpdateTime[_userAddress];
        uint256 passedDays = (block.timestamp - lastDecayedAt) / 86_400;
        if (passedDays > 0) {
            for (uint256 i = 0; i < passedDays; i++) {
                // TODO there is probably more gas efficient way to do this?
                // TODO handle underflows here
                uint256 amountToBurn = (userBalance / 100) * (decayRatePerDay / 100);
                // TODO call here _burn and emit Transfer event or no?
                _burn(_userAddress, amountToBurn);
            }
        }
        return balanceOf(_userAddress);
    }
}
