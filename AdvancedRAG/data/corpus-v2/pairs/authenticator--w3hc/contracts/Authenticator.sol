// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract Authenticator is EIP712 {
    using ECDSA for bytes32;

    bytes32 private constant AUTH_TYPEHASH = keccak256("Authenticate(address user,uint256 nonce)");

    mapping(address => uint256) public nonces;
    mapping(address => bool) public authenticated;

    event Authenticated(address indexed user);

    constructor() EIP712("Authenticator", "1") {}

    function authenticate(address user, bytes memory signature) external {
        bytes32 structHash = keccak256(abi.encode(AUTH_TYPEHASH, user, nonces[user]));

        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = hash.recover(signature);

        require(signer == user, "Invalid signature");

        nonces[user]++;
        authenticated[user] = true;

        emit Authenticated(user);
    }

    function isAuthenticated(address user) external view returns (bool) {
        return authenticated[user];
    }

    function getNonce(address user) external view returns (uint256) {
        return nonces[user];
    }
}
