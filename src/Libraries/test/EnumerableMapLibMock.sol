// SPDX-License-Identifier: AGPL-1.0

pragma solidity 0.8.9;

import "../EnumerableMapLib.sol";

contract EnumerableMapLibMock {
    using EnumerableMapLib for EnumerableMapLib.Bytes32ToUintMap;
    EnumerableMapLib.Bytes32ToUintMap private _map;

    event OperationResult(bool result);

    function contains(bytes32 key) public view returns (bool) {
        return _map.contains(key);
    }

    function set(bytes32 key, uint256 value) public {
        bool result = _map.set(key, value);
        emit OperationResult(result);
    }

    function remove(bytes32 key) public {
        bool result = _map.remove(key);
        emit OperationResult(result);
    }

    function length() public view returns (uint256) {
        return _map.length();
    }

    function at(uint256 index) public view returns (bytes32 key, uint256 value) {
        return _map.at(index);
    }

    function tryGet(bytes32 key) public view returns (bool, uint256) {
        return _map.tryGet(key);
    }

    function get(bytes32 key) public view returns (uint256) {
        return _map.get(key);
    }

    function getWithMessage(bytes32 key, string calldata errorMessage) public view returns (uint256) {
        return _map.get(key, errorMessage);
    }
}
