// SPDX-License-Identifier: MIT
/* solhint-disable one-contract-per-file, avoid-low-level-calls, no-inline-assembly */
pragma solidity 0.8.35;

contract SafeMock {
    address[] private _owners;
    uint256 private _threshold;
    bool private _initialized;

    error AlreadyInitialized();
    error InvalidThreshold();
    error NotOwner();
    error ExecutionFailed(bytes returndata);

    function setup(
        address[] calldata owners_,
        uint256 threshold_,
        address,
        bytes calldata,
        address,
        address,
        uint256,
        address payable
    ) external {
        if (_initialized) revert AlreadyInitialized();
        if (threshold_ == 0 || threshold_ > owners_.length) revert InvalidThreshold();
        _initialized = true;
        _owners = owners_;
        _threshold = threshold_;
    }

    function getOwners() external view returns (address[] memory) {
        return _owners;
    }

    function getThreshold() external view returns (uint256) {
        return _threshold;
    }

    /// @dev Test-only call boundary. It models contract ownership without reimplementing Safe signatures or quorum.
    function execute(address target, bytes calldata data) external returns (bytes memory returndata) {
        bool ownerFound;
        for (uint256 i = 0; i < _owners.length; ++i) {
            if (_owners[i] == msg.sender) {
                ownerFound = true;
                break;
            }
        }
        if (!ownerFound) revert NotOwner();

        (bool success, bytes memory result) = target.call(data);
        if (!success) revert ExecutionFailed(result);
        return result;
    }
}

contract SafeProxyFactoryMock {
    event ProxyCreation(address indexed proxy, address singleton);

    function createProxyWithNonce(
        address singleton,
        bytes calldata initializer,
        uint256
    ) external returns (address proxy) {
        SafeMock safe = new SafeMock();
        (bool success, bytes memory returndata) = address(safe).call(initializer);
        if (!success) {
            assembly {
                revert(add(returndata, 0x20), mload(returndata))
            }
        }

        proxy = address(safe);
        emit ProxyCreation(proxy, singleton);
    }
}
