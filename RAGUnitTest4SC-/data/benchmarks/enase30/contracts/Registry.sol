// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Registry {
    address public immutable owner;
    mapping(bytes32 => string) private records;
    mapping(bytes32 => bool) public exists;

    event RecordSet(bytes32 indexed key, string value);
    event RecordRemoved(bytes32 indexed key);

    constructor() {
        owner = msg.sender;
    }

    function set(bytes32 key, string calldata value) external {
        require(msg.sender == owner, "not owner");
        records[key] = value;
        exists[key] = true;
        emit RecordSet(key, value);
    }

    function get(bytes32 key) external view returns (string memory) {
        require(exists[key], "missing");
        return records[key];
    }

    function remove(bytes32 key) external {
        require(msg.sender == owner, "not owner");
        delete records[key];
        delete exists[key];
        emit RecordRemoved(key);
    }
}

