// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";

/**
 * @title ICitizen
 * @dev Interface for the Citizen contract
 */
interface ICitizen is IERC721Upgradeable {
    /**
     * @dev Mints a new Citizenship NFT to the specified address
     * @param to The address that will receive the citizenship
     * @param uri The token URI for this citizen's metadata
     * @param level Initial verification level for the citizen
     */
    function safeMint(address to, string memory uri, uint8 level) external;

    /**
     * @dev Revokes citizenship from an address
     * @param citizenAddress The address whose citizenship should be revoked
     * @param reason The reason for citizenship revocation
     */
    function revokeCitizenship(address citizenAddress, string memory reason) external;

    /**
     * @dev Updates the verification level for a citizen
     * @param citizenAddress The address of the citizen
     * @param newLevel The new verification level
     */
    function updateVerificationLevel(address citizenAddress, uint8 newLevel) external;

    /**
     * @dev Returns whether an address has citizenship
     * @param addressToCheck The address to check
     * @return bool True if the address is a citizen
     */
    function hasCitizenship(address addressToCheck) external view returns (bool);

    /**
     * @dev Returns the citizenship information for an address
     * @param citizenAddress The address to query
     * @return isActive Whether the citizenship is active
     * @return since The timestamp when citizenship was granted
     * @return level The verification level of the citizen
     */
    function citizenshipInfo(address citizenAddress) external view returns (
        bool isActive, 
        uint256 since, 
        uint8 level
    );

    /**
     * @dev Returns the total number of citizens
     * @return uint256 The number of active citizenships
     */
    function totalCitizens() external view returns (uint256);

    /**
     * @dev Sets a new base URI for all token metadata
     * @param newBaseURI The new base URI to set
     */
    function setBaseURI(string memory newBaseURI) external;
}
