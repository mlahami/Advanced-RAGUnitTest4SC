// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AccessControl {
    address public immutable admin;
    mapping(bytes32 => mapping(address => bool)) private roles;
    bytes32 public constant EDITOR_ROLE = keccak256("EDITOR_ROLE");

    constructor() {
        admin = msg.sender;
    }

    function grantRole(bytes32 role, address account) external {
        require(msg.sender == admin, "not admin");
        roles[role][account] = true;
    }

    function revokeRole(bytes32 role, address account) external {
        require(msg.sender == admin, "not admin");
        roles[role][account] = false;
    }

    function hasRole(bytes32 role, address account) external view returns (bool) {
        return roles[role][account];
    }
}

