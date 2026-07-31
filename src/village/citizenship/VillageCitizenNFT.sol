// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {ERC721BurnableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721BurnableUpgradeable.sol";
import {ERC721EnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {VillageRoles} from "../access/VillageRoles.sol";
import {IERC5192} from "../interfaces/IERC5192.sol";

/// @title Village Citizen NFT
/// @author Closer DAO
/// @notice Upgradeable, non-transferable ERC-721 citizenship credential.
/// @dev Subject references must be fresh opaque random values. They must never encode personal data, identifiers,
/// identifier hashes, or ciphertext. Burning removes active credential state but never releases a subject reference.
/// Enumeration describes only the current active set and its ordering may change after burns.
/// Aderyn follows UUPSUpgradeable's payable upgrade surface, but OpenZeppelin rejects value when there is no setup call,
/// while every initializer/reinitializer in this implementation is nonpayable.
/// aderyn-fp-next-line(contract-locks-ether)
contract VillageCitizenNFT is
    Initializable,
    ERC721Upgradeable,
    ERC721EnumerableUpgradeable,
    ERC721BurnableUpgradeable,
    Ownable2StepUpgradeable,
    ReentrancyGuardTransient,
    UUPSUpgradeable,
    IERC5192,
    IERC4906
{
    enum BurnReason {
        Suspension,
        Revocation
    }

    struct CitizenshipInfo {
        uint256 tokenId;
        bytes32 subjectRef;
        uint64 issuedAt;
    }

    struct CredentialData {
        bytes32 subjectRef;
        uint64 issuedAt;
    }

    /**
     * @dev ERC-7201 namespaced application storage. Never rename this namespace after deployment, and append future
     * fields rather than reordering or removing existing ones.
     * @custom:storage-location erc7201:closer.storage.VillageCitizenNFT
     */
    struct VillageCitizenNFTStorage {
        IAccessControl roleAuthority;
        string baseURI;
        uint256 nextTokenId;
        mapping(address citizen => uint256 tokenId) tokenByCitizen;
        mapping(uint256 tokenId => CredentialData) credentialByToken;
        mapping(bytes32 subjectRef => bool used) usedSubjectRefs;
    }

    /// @notice Emitted after a citizenship credential is issued.
    /// @param operator Citizen operator that submitted the issuance.
    /// @param citizen Wallet receiving the credential.
    /// @param tokenId Newly issued token ID.
    /// @param subjectRef Fresh opaque subject reference permanently consumed by the issuance.
    /// @param issuedAt Block timestamp at which the credential was issued.
    event CitizenshipIssued(
        address indexed operator,
        address indexed citizen,
        uint256 indexed tokenId,
        bytes32 subjectRef,
        uint64 issuedAt
    );
    /// @notice Emitted when a Citizen operator burns a credential for suspension or revocation.
    /// @param operator Citizen operator that submitted the burn.
    /// @param citizen Wallet whose credential was burned.
    /// @param tokenId Burned token ID.
    /// @param subjectRef Opaque subject reference retained in the historical event.
    /// @param reason Suspension or revocation reason.
    event CitizenshipOperatorBurned(
        address indexed operator,
        address indexed citizen,
        uint256 indexed tokenId,
        bytes32 subjectRef,
        BurnReason reason
    );
    /// @notice Emitted when a credential holder burns their own credential.
    /// @param citizen Wallet whose credential was burned.
    /// @param tokenId Burned token ID.
    /// @param subjectRef Opaque subject reference retained in the historical event.
    event CitizenshipSelfBurned(address indexed citizen, uint256 indexed tokenId, bytes32 subjectRef);
    /// @notice Emitted after an atomic lost-wallet recovery.
    /// @param operator Citizen operator that submitted recovery.
    /// @param oldCitizen Wallet whose credential was burned.
    /// @param newCitizen Replacement wallet receiving the new credential.
    /// @param oldTokenId Burned credential token ID.
    /// @param newTokenId Newly issued replacement token ID.
    /// @param oldSubjectRef Opaque reference of the burned credential.
    /// @param newSubjectRef Fresh opaque reference of the replacement credential.
    event CitizenshipRecovered(
        address indexed operator,
        address indexed oldCitizen,
        address indexed newCitizen,
        uint256 oldTokenId,
        uint256 newTokenId,
        bytes32 oldSubjectRef,
        bytes32 newSubjectRef
    );
    /// @notice Emitted when the shared metadata base URI changes.
    /// @param oldBaseURI Previously configured base URI.
    /// @param newBaseURI Newly configured base URI.
    event BaseURIChanged(string oldBaseURI, string newBaseURI);
    /// @notice Emitted when the external role authority changes.
    /// @param oldAuthority Previously configured authority.
    /// @param newAuthority Newly configured authority.
    event RoleAuthorityChanged(address indexed oldAuthority, address indexed newAuthority);

    error InvalidRoleAuthority(address roleAuthority);
    error InvalidOwner(address owner);
    error Unauthorized(address sender, bytes32 role);
    error InvalidCitizen(address citizen);
    error CitizenAlreadyCredentialed(address citizen, uint256 tokenId);
    error InvalidSubjectReference();
    error SubjectReferenceAlreadyUsed(bytes32 subjectRef);
    error TimestampOutOfRange(uint256 timestamp);
    error TokenIdExhausted();
    error NotCredentialHolder(address sender, uint256 tokenId, address holder);
    error ReplacementWalletUnchanged(address citizen);
    error SoulboundTransfer();
    error SoulboundApproval();

    bytes32 private constant VILLAGE_CITIZEN_NFT_STORAGE_LOCATION =
        0x0f0fede0db9e17f983a0189329eca9d506e034956a0bdfef1b5cef2e8cbdf500;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes a fresh citizenship proxy.
    /// @param name_ ERC-721 collection name.
    /// @param symbol_ ERC-721 collection symbol.
    /// @param baseURI_ Initial metadata base URI, which may be empty at contract level.
    /// @param roleAuthority_ Deployed VillageAccess-compatible role authority.
    /// @param owner_ Initial configuration and upgrade owner.
    function initialize(
        string memory name_,
        string memory symbol_,
        string memory baseURI_,
        address roleAuthority_,
        address owner_
    ) external initializer {
        if (owner_ == address(0)) revert InvalidOwner(owner_);
        _validateRoleAuthority(roleAuthority_);

        __ERC721_init(name_, symbol_);
        __ERC721Enumerable_init();
        __ERC721Burnable_init();
        __Ownable_init(owner_);
        __Ownable2Step_init();

        VillageCitizenNFTStorage storage $ = _getVillageCitizenNFTStorage();
        $.roleAuthority = IAccessControl(roleAuthority_);
        $.baseURI = baseURI_;
        $.nextTokenId = 1;
    }

    /// @notice Issues a new credential to a wallet that does not currently hold one.
    /// @param citizen Wallet receiving the credential.
    /// @param subjectRef Fresh opaque reference permanently associated with this issuance.
    /// @return tokenId Newly issued monotonically increasing token ID.
    function issue(
        address citizen,
        bytes32 subjectRef
    ) external nonReentrant onlyRole(VillageRoles.CITIZEN_OPERATOR_ROLE) returns (uint256 tokenId) {
        tokenId = _issue(_msgSender(), citizen, subjectRef);
    }

    /// @inheritdoc ERC721BurnableUpgradeable
    function burn(uint256 tokenId) public override nonReentrant {
        address sender = _msgSender();
        address citizen = ownerOf(tokenId);
        if (sender != citizen) revert NotCredentialHolder(sender, tokenId, citizen);
        bytes32 subjectRef = _burnCredential(tokenId);
        emit CitizenshipSelfBurned(citizen, tokenId, subjectRef);
    }

    /// @notice Burns a credential because of suspension or revocation.
    /// @param tokenId Credential to burn.
    /// @param reason Suspension or revocation classification recorded in the event.
    function operatorBurn(
        uint256 tokenId,
        BurnReason reason
    ) external nonReentrant onlyRole(VillageRoles.CITIZEN_OPERATOR_ROLE) {
        address operator = _msgSender();
        address citizen = ownerOf(tokenId);
        bytes32 subjectRef = _burnCredential(tokenId);
        emit CitizenshipOperatorBurned(operator, citizen, tokenId, subjectRef, reason);
    }

    /// @notice Atomically replaces a lost-wallet credential with a fresh credential in another wallet.
    /// @param oldTokenId Existing credential to burn.
    /// @param newCitizen Different replacement wallet.
    /// @param newSubjectRef Fresh opaque reference for the replacement credential.
    /// @return newTokenId Newly issued replacement token ID.
    function recover(
        uint256 oldTokenId,
        address newCitizen,
        bytes32 newSubjectRef
    ) external nonReentrant onlyRole(VillageRoles.CITIZEN_OPERATOR_ROLE) returns (uint256 newTokenId) {
        address operator = _msgSender();
        address oldCitizen = ownerOf(oldTokenId);
        if (newCitizen == oldCitizen) revert ReplacementWalletUnchanged(newCitizen);

        bytes32 oldSubjectRef = _burnCredential(oldTokenId);
        newTokenId = _issue(operator, newCitizen, newSubjectRef);
        emit CitizenshipRecovered(
            operator,
            oldCitizen,
            newCitizen,
            oldTokenId,
            newTokenId,
            oldSubjectRef,
            newSubjectRef
        );
    }

    /// @notice Returns whether a wallet currently holds a citizenship credential.
    /// @param citizen Wallet to query.
    function hasCitizenship(address citizen) external view returns (bool) {
        return tokenIdOf(citizen) != 0;
    }

    /// @notice Returns the wallet's active credential token ID, or zero when absent.
    /// @param citizen Wallet to query.
    function tokenIdOf(address citizen) public view returns (uint256) {
        return _getVillageCitizenNFTStorage().tokenByCitizen[citizen];
    }

    /// @notice Returns the wallet's active credential information, or an all-zero struct when absent.
    /// @param citizen Wallet to query.
    /// @return info Current credential information or an all-zero struct.
    function citizenshipInfo(address citizen) external view returns (CitizenshipInfo memory info) {
        VillageCitizenNFTStorage storage $ = _getVillageCitizenNFTStorage();
        uint256 tokenId = $.tokenByCitizen[citizen];
        if (tokenId == 0) return info;
        CredentialData storage credential = $.credentialByToken[tokenId];
        return CitizenshipInfo(tokenId, credential.subjectRef, credential.issuedAt);
    }

    /// @notice Returns the current number of live citizenship credentials.
    function totalCitizens() external view returns (uint256) {
        return totalSupply();
    }

    /// @inheritdoc IERC5192
    function locked(uint256 tokenId) external view returns (bool) {
        return _requireOwned(tokenId) != address(0);
    }

    /// @notice Returns the external VillageAccess-compatible role authority.
    function roleAuthority() public view returns (IAccessControl) {
        return _getVillageCitizenNFTStorage().roleAuthority;
    }

    /// @notice Returns the metadata base URI shared by all live tokens.
    function baseURI() external view returns (string memory) {
        return _getVillageCitizenNFTStorage().baseURI;
    }

    /// @notice Replaces the metadata base URI and invalidates metadata for all IDs issued so far.
    /// @param newBaseURI New shared base URI, which may be empty.
    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        VillageCitizenNFTStorage storage $ = _getVillageCitizenNFTStorage();
        string memory oldBaseURI = $.baseURI;
        $.baseURI = newBaseURI;
        emit BaseURIChanged(oldBaseURI, newBaseURI);
        if ($.nextTokenId > 1) emit BatchMetadataUpdate(1, $.nextTokenId - 1);
    }

    /// @notice Repoints lifecycle authorization to a replacement deployed authority.
    /// @param newAuthority Replacement VillageAccess-compatible deployed contract.
    function setRoleAuthority(address newAuthority) external onlyOwner {
        _validateRoleAuthority(newAuthority);
        VillageCitizenNFTStorage storage $ = _getVillageCitizenNFTStorage();
        address oldAuthority = address($.roleAuthority);
        $.roleAuthority = IAccessControl(newAuthority);
        emit RoleAuthorityChanged(oldAuthority, newAuthority);
    }

    /// @inheritdoc ERC721Upgradeable
    function approve(address, uint256) public pure override(ERC721Upgradeable, IERC721) {
        revert SoulboundApproval();
    }

    /// @inheritdoc ERC721Upgradeable
    function setApprovalForAll(address, bool) public pure override(ERC721Upgradeable, IERC721) {
        revert SoulboundApproval();
    }

    /// @inheritdoc ERC721Upgradeable
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721Upgradeable, ERC721EnumerableUpgradeable, IERC165) returns (bool) {
        return
            interfaceId == bytes4(0xb45a3c0e) ||
            // ERC-4906 defines only events, so its specified identifier is not Solidity's computed interface ID.
            interfaceId == bytes4(0x49064906) ||
            super.supportsInterface(interfaceId);
    }

    modifier onlyRole(bytes32 role) {
        address sender = _msgSender();
        if (!roleAuthority().hasRole(role, sender)) revert Unauthorized(sender, role);
        _;
    }

    function _issue(address operator, address citizen, bytes32 subjectRef) private returns (uint256 tokenId) {
        if (citizen == address(0)) revert InvalidCitizen(citizen);
        if (subjectRef == bytes32(0)) revert InvalidSubjectReference();

        VillageCitizenNFTStorage storage $ = _getVillageCitizenNFTStorage();
        uint256 existingTokenId = $.tokenByCitizen[citizen];
        if (existingTokenId != 0) revert CitizenAlreadyCredentialed(citizen, existingTokenId);
        if ($.usedSubjectRefs[subjectRef]) revert SubjectReferenceAlreadyUsed(subjectRef);
        if (block.timestamp > type(uint64).max) revert TimestampOutOfRange(block.timestamp);

        tokenId = $.nextTokenId;
        if (tokenId == type(uint256).max) revert TokenIdExhausted();
        uint64 issuedAt = uint64(block.timestamp);
        $.nextTokenId = tokenId + 1;
        $.usedSubjectRefs[subjectRef] = true;
        $.credentialByToken[tokenId] = CredentialData(subjectRef, issuedAt);

        _safeMint(citizen, tokenId);
        emit Locked(tokenId);
        emit CitizenshipIssued(operator, citizen, tokenId, subjectRef, issuedAt);
    }

    function _burnCredential(uint256 tokenId) private returns (bytes32 subjectRef) {
        subjectRef = _getVillageCitizenNFTStorage().credentialByToken[tokenId].subjectRef;
        _burn(tokenId);
    }

    function _validateRoleAuthority(address authority) private view {
        if (authority == address(0) || authority.code.length == 0) revert InvalidRoleAuthority(authority);
    }

    /// @dev Rejects the only ERC-721 transition that would move a live token between nonzero wallets, then delegates
    /// mint/burn ownership and enumeration bookkeeping to OpenZeppelin before updating domain indexes.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override(ERC721Upgradeable, ERC721EnumerableUpgradeable) returns (address from) {
        from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert SoulboundTransfer();

        from = super._update(to, tokenId, auth);
        VillageCitizenNFTStorage storage $ = _getVillageCitizenNFTStorage();
        if (from == address(0)) {
            uint256 existingTokenId = $.tokenByCitizen[to];
            if (existingTokenId != 0) revert CitizenAlreadyCredentialed(to, existingTokenId);
            $.tokenByCitizen[to] = tokenId;
        } else {
            delete $.tokenByCitizen[from];
            delete $.credentialByToken[tokenId];
        }
    }

    /// @notice Delegates balance changes while retaining Enumerable's batch-mint prohibition.
    /// @param account Account whose balance would increase.
    /// @param value Number of tokens added to the balance.
    function _increaseBalance(
        address account,
        uint128 value
    ) internal override(ERC721Upgradeable, ERC721EnumerableUpgradeable) {
        super._increaseBalance(account, value);
    }

    function _baseURI() internal view override returns (string memory) {
        return _getVillageCitizenNFTStorage().baseURI;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function _getVillageCitizenNFTStorage() private pure returns (VillageCitizenNFTStorage storage $) {
        bytes32 storageLocation = VILLAGE_CITIZEN_NFT_STORAGE_LOCATION;
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            $.slot := storageLocation
        }
    }
}
