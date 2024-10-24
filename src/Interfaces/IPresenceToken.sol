// SPDX-License-Identifier: AGPL-1.0
pragma solidity 0.8.9;

interface IPresenceToken {
    //--------------------------------------------------------------------------
    // Errors

    error TransferNotAllowed();
    error ApproveNotAllowed();

    error PresenceToken_PresenceIsNonTransferable();

    error Unauthorized(address sender, bytes32[] allowedRoles);
}
