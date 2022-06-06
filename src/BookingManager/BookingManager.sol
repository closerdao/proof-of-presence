// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "../Interfaces/ITokenLock.sol";
import "../Interfaces/IProofOfPresence.sol";

contract BookingManager {
    ITokenLock public immutable tokenLock;
    IProofOfPresence public immutable proofOfPresence;

    constructor(address _tokenLock, address _proofOfPresence) {
        tokenLock = ITokenLock(_tokenLock);
        proofOfPresence = IProofOfPresence(_proofOfPresence);
    }
}
