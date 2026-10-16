// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IWhiteList.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract WhiteList is AccessControl, IWhiteList {
    bytes32 public constant MASTER_ROLE = keccak256("MASTER_ROLE");
    bytes32 public constant READER_ROLE = keccak256("READER_ROLE");
    bytes32 public constant WRITER_ROLE = keccak256("WRITER_ROLE");

    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private mySet;

    event AddressAdded(address indexed whiteListAddress);
    event AddressDeleted(address indexed addressDeleted);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(READER_ROLE, _msgSender());
        _grantRole(WRITER_ROLE, _msgSender());
        _grantRole(MASTER_ROLE, _msgSender());
    }

    function addAddress(address whiteListAddress)
        public
        override
        onlyRole(WRITER_ROLE)
        returns (bool)
    {
        bool added = mySet.add(whiteListAddress);
        if (added) {
            emit AddressAdded(whiteListAddress);
        }
        return added;
    }

    function deleteAddress(address addressToDelete)
        public
        override
        onlyRole(WRITER_ROLE)
        returns (bool)
    {
        bool removed = mySet.remove(addressToDelete);
        if (removed) {
            emit AddressDeleted(addressToDelete);
        }
        return removed;
    }

    function isAddressWhiteListed(address addressToFind)
        public
        view
        override
        onlyRole(READER_ROLE)
        returns (bool)
    {
        return mySet.contains(addressToFind);
    }

    function getAddressesInWhiteList()
        public
        view
        override
        onlyRole(READER_ROLE)
        returns (address[] memory)
    {
        return mySet.values();
    }

    function getAddressesInWhiteListPaginated(
        uint256 offset,
        uint256 itemsAmount
    ) public view override onlyRole(READER_ROLE) returns (address[] memory) {
        uint256 lengthArray = mySet.length();
        require(
            (int256(lengthArray) - int256(offset + itemsAmount)) >= 0,
            "Offset + itemsAmount bigger than the array"
        );
        address[] memory result = new address[](itemsAmount);
        uint256 counter = 1;
        uint256 index = 0;
        for (uint256 x = offset; counter <= itemsAmount; x++) {
            result[index] = mySet.at(x);
            index++;
            counter++;
        }
        return result;
    }

    function getWhiteListSize()
        external
        view
        override
        onlyRole(READER_ROLE)
        returns (uint256)
    {
        return mySet.length();
    }
}