// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;

interface IProofOfPresence {
    function book(uint16[2][] calldata dates) external;

    function cancel(uint16[2][] calldata dates) external;
}
