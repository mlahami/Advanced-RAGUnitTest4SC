// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MSMEIdentity
 * @dev Self-sovereign identity contract for each MSME
 * Stores verifiable data and controls access permissions
 */
contract MSMEIdentity is Ownable {
    
    // Storage for arbitrary data with key-value pairs
    mapping(bytes32 => bytes) private _data;
    
    // Approved operators (contracts) that can write data
    mapping(address => bool) private _approvedOperators;

    // Events
    event DataChanged(bytes32 indexed key, bytes value);
    event OperatorApproved(address indexed operator);
    event OperatorRevoked(address indexed operator);

    /**
     * @dev Constructor sets the initial owner (the MSME)
     * @param initialOwner Address of the MSME that owns this identity
     */
    constructor(address initialOwner) Ownable(initialOwner) {
        require(initialOwner != address(0), "Invalid owner address");
    }
    
    /**
     * @dev MSME grants permission to a contract (e.g., AttestationRegistry)
     * @param operator Address to approve
     */
    function approveOperator(address operator) external onlyOwner {
        require(operator != address(0), "Invalid operator address");
        _approvedOperators[operator] = true;
        emit OperatorApproved(operator);
    }

    /**
     * @dev MSME revokes permission from an operator
     * @param operator Address to revoke
     */
    function revokeOperator(address operator) external onlyOwner {
        _approvedOperators[operator] = false;
        emit OperatorRevoked(operator);
    }

    /**
     * @dev Check if an address is an approved operator
     * @param operator Address to check
     * @return bool Whether the address is approved
     */
    function isApprovedOperator(address operator) external view returns (bool) {
        return _approvedOperators[operator];
    }

    /**
     * @dev Set data in the identity contract
     * Only owner or approved operators can call
     * @param key Data key
     * @param value Data value
     */
    function setData(bytes32 key, bytes calldata value) external {
        require(
            msg.sender == owner() || _approvedOperators[msg.sender], 
            "Not authorized"
        );
        _data[key] = value;
        emit DataChanged(key, value);
    }

    /**
     * @dev Get data from the identity contract (public read)
     * @param key Data key
     * @return bytes Data value
     */
    function getData(bytes32 key) external view returns (bytes memory) {
        return _data[key];
    }

    /**
     * @dev Batch set multiple data entries
     * @param keys Array of keys
     * @param values Array of values
     */
    function setDataBatch(bytes32[] calldata keys, bytes[] calldata values) external {
        require(
            msg.sender == owner() || _approvedOperators[msg.sender], 
            "Not authorized"
        );
        require(keys.length == values.length, "Length mismatch");
        
        for (uint256 i = 0; i < keys.length; i++) {
            _data[keys[i]] = values[i];
            emit DataChanged(keys[i], values[i]);
        }
    }
}
