// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/CountersUpgradeable.sol";

/**
 * @title Citizen
 * @dev A soulbound ERC-721 token representing citizenship in the Traditional Dream Factory.
 * This token cannot be transferred by users, only minted and revoked by authorized roles.
 * It grants access to governance and utility functions within the TDF ecosystem.
 */
contract Citizen is 
    Initializable, 
    ERC721Upgradeable, 
    ERC721URIStorageUpgradeable,
    ERC721EnumerableUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable 
{
    using CountersUpgradeable for CountersUpgradeable.Counter;

    // Role definitions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant REVOKER_ROLE = keccak256("REVOKER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");
    
    // Token ID counter
    CountersUpgradeable.Counter private _tokenIdCounter;
    
    // Base URI for metadata
    string private _baseTokenURI;
    
    // Mapping to track if an address is a citizen
    mapping(address => bool) public isCitizen;
    
    // Mapping to store citizenship issuance timestamps
    mapping(address => uint256) public citizenshipTimestamp;
    
    // Mapping to store citizenship validation level (0=unverified, 1=basic, 2=enhanced, 3=full)
    mapping(address => uint8) public verificationLevel;
    
    // Events
    event CitizenshipGranted(address indexed citizen, uint256 tokenId, uint256 timestamp);
    event CitizenshipRevoked(address indexed citizen, uint256 tokenId, uint256 timestamp, string reason);
    event VerificationLevelChanged(address indexed citizen, uint8 oldLevel, uint8 newLevel);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the contract with required parameters
     * @param name The name of the NFT collection
     * @param symbol The symbol of the NFT collection
     * @param baseURI The base URI for token metadata
     * @param admin The address that will have admin rights (typically a DAO)
     */
    function initialize(
        string memory name,
        string memory symbol,
        string memory baseURI,
        address admin
    ) initializer public {
        __ERC721_init(name, symbol);
        __ERC721URIStorage_init();
        __ERC721Enumerable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _baseTokenURI = baseURI;
        
        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(REVOKER_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
        _grantRole(DAO_ROLE, admin);
    }

    /**
     * @dev Returns the base URI for token metadata
     */
    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    /**
     * @dev Sets a new base URI for all token metadata
     * @param newBaseURI The new base URI to set
     */
    function setBaseURI(string memory newBaseURI) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _baseTokenURI = newBaseURI;
    }

    /**
     * @dev Mints a new Citizenship NFT to the specified address
     * @param to The address that will receive the citizenship
     * @param uri The token URI for this citizen's metadata
     * @param level Initial verification level for the citizen
     */
    function safeMint(address to, string memory uri, uint8 level) public onlyRole(MINTER_ROLE) {
        require(!isCitizen[to], "Citizen: Address is already a citizen");
        require(level <= 3, "Citizen: Invalid verification level");

        _tokenIdCounter.increment();
        uint256 tokenId = _tokenIdCounter.current();
        
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        
        isCitizen[to] = true;
        citizenshipTimestamp[to] = block.timestamp;
        verificationLevel[to] = level;
        
        emit CitizenshipGranted(to, tokenId, block.timestamp);
    }

    /**
     * @dev Revokes citizenship from an address
     * @param citizenAddress The address whose citizenship should be revoked
     * @param reason The reason for citizenship revocation
     */
    function revokeCitizenship(address citizenAddress, string memory reason) public onlyRole(REVOKER_ROLE) {
        require(isCitizen[citizenAddress], "Citizen: Address is not a citizen");
        
        uint256 tokenId = 0;
        
        // Find the token ID owned by this address
        for (uint256 i = 1; i <= _tokenIdCounter.current(); i++) {
            if (_exists(i) && ownerOf(i) == citizenAddress) {
                tokenId = i;
                break;
            }
        }
        
        require(tokenId != 0, "Citizen: No token found for this citizen");
        
        // Burn the token
        _burn(tokenId);
        
        // Update state
        isCitizen[citizenAddress] = false;
        
        emit CitizenshipRevoked(citizenAddress, tokenId, block.timestamp, reason);
    }

    /**
     * @dev Updates the verification level for a citizen
     * @param citizenAddress The address of the citizen
     * @param newLevel The new verification level
     */
    function updateVerificationLevel(address citizenAddress, uint8 newLevel) public onlyRole(MINTER_ROLE) {
        require(isCitizen[citizenAddress], "Citizen: Address is not a citizen");
        require(newLevel <= 3, "Citizen: Invalid verification level");
        
        uint8 oldLevel = verificationLevel[citizenAddress];
        verificationLevel[citizenAddress] = newLevel;
        
        emit VerificationLevelChanged(citizenAddress, oldLevel, newLevel);
    }

    /**
     * @dev Returns whether an address has citizenship
     * @param addressToCheck The address to check
     * @return bool True if the address is a citizen
     */
    function hasCitizenship(address addressToCheck) public view returns (bool) {
        return isCitizen[addressToCheck];
    }

    /**
     * @dev Returns the citizenship information for an address
     * @param citizenAddress The address to query
     * @return isActive Whether the citizenship is active
     * @return since The timestamp when citizenship was granted
     * @return level The verification level of the citizen
     */
    function citizenshipInfo(address citizenAddress) public view returns (
        bool isActive, 
        uint256 since, 
        uint8 level
    ) {
        return (
            isCitizen[citizenAddress],
            citizenshipTimestamp[citizenAddress],
            verificationLevel[citizenAddress]
        );
    }

    /**
     * @dev Returns the total number of citizens
     * @return uint256 The number of active citizenships
     */
    function totalCitizens() public view returns (uint256) {
        return totalSupply();
    }

    /**
     * @dev Overrides the transferFrom function to make tokens soulbound (non-transferable)
     */
    function transferFrom(address from, address to, uint256 tokenId) public override(ERC721Upgradeable) {
        require(
            hasRole(MINTER_ROLE, _msgSender()) || hasRole(REVOKER_ROLE, _msgSender()),
            "Citizen: Citizenship tokens are soulbound and cannot be transferred"
        );
        super.transferFrom(from, to, tokenId);
    }

    /**
     * @dev Overrides the safeTransferFrom function to make tokens soulbound (non-transferable)
     */
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public override(ERC721Upgradeable) {
        require(
            hasRole(MINTER_ROLE, _msgSender()) || hasRole(REVOKER_ROLE, _msgSender()),
            "Citizen: Citizenship tokens are soulbound and cannot be transferred"
        );
        super.safeTransferFrom(from, to, tokenId, data);
    }

    /**
     * @dev Required by the UUPSUpgradeable contract to restrict upgrade access
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}

    /**
     * @dev Resolves the inheritance conflict between multiple parent contracts
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId
    ) internal override(ERC721Upgradeable, ERC721EnumerableUpgradeable) {
        super._beforeTokenTransfer(from, to, tokenId);
    }

    /**
     * @dev Hook that is called before a set of consecutive token transfers.
     */
    function _beforeConsecutiveTokenTransfer(
        address from,
        address to,
        uint256 first,
        uint96 batchSize
    ) internal virtual override(ERC721Upgradeable, ERC721EnumerableUpgradeable) {
        super._beforeConsecutiveTokenTransfer(from, to, first, batchSize);
    }

    /**
     * @dev Determines how token URIs are calculated
     */
    function tokenURI(uint256 tokenId) public view override(ERC721Upgradeable, ERC721URIStorageUpgradeable) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    /**
     * @dev Burns a token and updates citizenship status
     */
    function _burn(uint256 tokenId) internal override(ERC721Upgradeable, ERC721URIStorageUpgradeable) {
        address owner = ownerOf(tokenId);
        super._burn(tokenId);
        isCitizen[owner] = false;
    }

    /**
     * @dev Required override for interface support
     */
    function supportsInterface(bytes4 interfaceId) public view override(
        AccessControlUpgradeable, 
        ERC721Upgradeable,
        ERC721EnumerableUpgradeable
    ) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
