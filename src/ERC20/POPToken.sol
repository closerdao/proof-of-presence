// SPDX-License-Identifier: AGPL-1.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "../Interfaces/ITransferPermitter.sol"; // Ensure this path is correct based on your project structure

contract POPToken is Initializable, ERC20Upgradeable, Ownable2StepUpgradeable {
    using SafeMathUpgradeable for uint256;

    struct TimeData {
        uint256 amount; // The effective amount considering decay
        uint256 lastUpdated; // Timestamp of the last update
    }

    uint256 internal constant YEAR_IN_SECONDS = 365 * 24 * 60 * 60;
    uint256 internal decayPercentage = 10;
    uint256 internal constant DECAY_DENOMINATOR = 100;

    ITransferPermitter private _daoContract;

    mapping(address => TimeData) private timeBalances;

    modifier onlyDAOorOwner() {
        require(
            owner() == _msgSender() || address(_daoContract) == _msgSender(),
            "Ownable: caller is not the owner or DAO"
        );
        _;
    }

    function initialize(address manager) public initializer {
        __POPToken_init(manager);
    }

    function __POPToken_init(address manager) internal onlyInitializing {
        __ERC20_init("POPToken", "POP");
        __POPToken_init_unchained(manager);
        __Ownable2Step_init();
    }

    function __POPToken_init_unchained(address manager) internal onlyInitializing {
        _daoContract = ITransferPermitter(manager);
    }

    function setDAOContract(address manager) public onlyOwner {
        _daoContract = ITransferPermitter(manager);
    }

    function getDAOContract() public view returns (address) {
        return address(_daoContract);
    }

    function setDecayPercentage(uint256 percentage) public onlyOwner {
        require(percentage < DECAY_DENOMINATOR, "Decay percentage must be less than 100");
        decayPercentage = percentage;
    }

    function mint(address account, uint256 amount) public onlyDAOorOwner {
        // Update time balance with decay applied
        _updateTimeBalance(account);

        // Add the new amount to the effective balance
        timeBalances[account].amount = timeBalances[account].amount.add(amount);

        // Mint new tokens to the address
        _mint(account, amount);
    }

    function _updateTimeBalance(address account) internal {
        uint256 timePassed = block.timestamp.sub(timeBalances[account].lastUpdated);
        if (timePassed >= YEAR_IN_SECONDS) {
            uint256 yearsPassed = timePassed.div(YEAR_IN_SECONDS);
            uint256 decayFactor = _pow(DECAY_DENOMINATOR.sub(decayPercentage), yearsPassed);

            uint256 decayedAmount = timeBalances[account].amount.mul(decayFactor).div(
                _pow(DECAY_DENOMINATOR, yearsPassed)
            );
            uint256 decayDifference = timeBalances[account].amount.sub(decayedAmount);

            if (decayDifference > 0) {
                // Burn the decayed tokens
                _burn(account, decayDifference);
            }

            // Update the effective amount and the last updated timestamp
            timeBalances[account].amount = decayedAmount;
            timeBalances[account].lastUpdated = block.timestamp;
        }
    }

    function _pow(uint256 base, uint256 exp) internal pure returns (uint256) {
        uint256 result = 1;
        for (uint256 i = 0; i < exp; i++) {
            result = result.mul(base);
        }
        return result;
    }

    function balanceOf(address account) public view override returns (uint256) {
        uint256 timePassed = block.timestamp.sub(timeBalances[account].lastUpdated);
        if (timePassed >= YEAR_IN_SECONDS) {
            uint256 yearsPassed = timePassed.div(YEAR_IN_SECONDS);
            uint256 decayFactor = _pow(DECAY_DENOMINATOR.sub(decayPercentage), yearsPassed);
            return timeBalances[account].amount.mul(decayFactor).div(_pow(DECAY_DENOMINATOR, yearsPassed));
        } else {
            return timeBalances[account].amount;
        }
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);
        require(_daoContract.isTokenTransferPermitted(from, to, amount), "Transfer not allowed by DAO");
    }

    function triggerDecay() public {
        // Update time balance with decay applied
        _updateTimeBalance(_msgSender());
    }

    // Airdrop functionality to retroactively administer proof of presence
    function airdrop(address[] calldata accounts, uint256[] calldata amounts) external onlyOwner {
        require(accounts.length == amounts.length, "Accounts and amounts length mismatch");

        for (uint256 i = 0; i < accounts.length; i++) {
            mint(accounts[i], amounts[i]);
        }
    }

    // Disable transfers by overriding transfer and transferFrom with reverts
    function transfer(address /*recipient*/, uint256 /*amount*/) public pure override returns (bool) {
        revert("This token is non-transferable");
    }

    function transferFrom(
        address /*sender*/,
        address /*recipient*/,
        uint256 /*amount*/
    ) public pure override returns (bool) {
        revert("This token is non-transferable");
    }

    uint256[50] private __gap;
}
