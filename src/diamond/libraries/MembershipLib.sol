// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

library MembershipLib {
    using EnumerableSet for EnumerableSet.AddressSet;

    struct Store {
        EnumerableSet.AddressSet _inner;
        // NOTE: the only way to expand this struct after deployment si by adding data in maps
    }

    /**
     * @dev Add a value to a set. O(1).
     *
     * Returns true if the value was added to the set, that is if it was not
     * already present.
     */
    function add(Store storage store, address value) internal returns (bool) {
        return store._inner.add(value);
    }

    /**
     * @dev Removes a value from a set. O(1).
     *
     * Returns true if the value was removed from the set, that is if it was
     * present.
     */
    function remove(Store storage store, address value) internal returns (bool) {
        return store._inner.remove(value);
    }

    /**
     * @dev Returns true if the value is in the set. O(1).
     */
    function contains(Store storage store, address value) internal view returns (bool) {
        return store._inner.contains(value);
    }

    /**
     * @dev Returns the number of values in the set. O(1).
     */
    function length(Store storage store) internal view returns (uint256) {
        return store._inner.length();
    }

    /**
     * @dev Returns the value stored at position `index` in the set. O(1).
     *
     * Note that there are no guarantees on the ordering of values inside the
     * array, and it may change when more values are added or removed.
     *
     * Requirements:
     *
     * - `index` must be strictly less than {length}.
     */
    function at(Store storage store, uint256 index) internal view returns (address) {
        return store._inner.at(index);
    }

    /**
     * @dev Return the entire set in an array
     *
     * WARNING: This operation will copy the entire storage to memory, which can be quite expensive. This is designed
     * to mostly be used by view accessors that are queried without any gas fees. Developers should keep in mind that
     * this function has an unbounded cost, and using it as part of a state-changing function may render the function
     * uncallable if the set grows to a point where copying to memory consumes too much gas to fit in a block.
     */
    function values(Store storage store) internal view returns (address[] memory) {
        return store._inner.values();
    }
}
