// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

//MerkleAirdrop â€” claim tokens via Merkle proof verification
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
}

contract MerkleAirdrop {
    bytes32 public immutable merkleRoot;
    IERC20 public immutable token;
    mapping(address => bool) public claimed;

    event Claimed(address indexed claimant, uint256 amount);

    constructor(bytes32 _merkleRoot, address _token) {
        merkleRoot = _merkleRoot;
        token = IERC20(_token);
    }

    function claim(uint256 _amount, bytes32[] calldata _proof) external {
        require(!claimed[msg.sender], "Already claimed");
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, _amount));
        require(_verify(_proof, merkleRoot, leaf), "Invalid proof");
        claimed[msg.sender] = true;
        require(token.transfer(msg.sender, _amount), "Transfer failed");
        emit Claimed(msg.sender, _amount);
    }

    function _verify(bytes32[] memory proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 computed = leaf;
        for (uint i = 0; i < proof.length; i++) {
            bytes32 proofElem = proof[i];
            computed = computed < proofElem
                ? keccak256(abi.encodePacked(computed, proofElem))
                : keccak256(abi.encodePacked(proofElem, computed));
        }
        return computed == root;
    }
}
