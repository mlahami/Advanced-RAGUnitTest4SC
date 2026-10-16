# msmeidentity--aryan-chugh

- domain: registries-identity (identity-registry)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/aryan-chugh/MSME_Blockchain @ 074d7b2703476f0d0343f7e3961c1a253661b947
- license: MIT
- targets: MSMEIdentity.sol
- validation: 12 passing tests, 0 failing; statement coverage MSMEIdentity.sol 100.0 %

## Contract: MSMEIdentity.sol (primary target)

```solidity
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
```

## Tests: MSMEIdentity.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("MSMEIdentity", function () {
  async function deployMSMEIdentityFixture() {
    const [owner, msme, operator, other] = await ethers.getSigners();

    const MSMEIdentity = await ethers.getContractFactory("MSMEIdentity");
    const identity = await MSMEIdentity.deploy(msme.address);

    return { identity, owner, msme, operator, other };
  }

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      const { identity, msme } = await loadFixture(deployMSMEIdentityFixture);
      expect(await identity.owner()).to.equal(msme.address);
    });

    it("Should revert if initial owner is zero address", async function () {
      const MSMEIdentity = await ethers.getContractFactory("MSMEIdentity");
      await expect(
        MSMEIdentity.deploy(ethers.ZeroAddress)
      ).to.be.reverted;
    });
  });

  describe("Operator Management", function () {
    it("Should allow owner to approve operator", async function () {
      const { identity, msme, operator } = await loadFixture(deployMSMEIdentityFixture);
      
      await expect(identity.connect(msme).approveOperator(operator.address))
        .to.emit(identity, "OperatorApproved")
        .withArgs(operator.address);
      
      expect(await identity.isApprovedOperator(operator.address)).to.be.true;
    });

    it("Should allow owner to revoke operator", async function () {
      const { identity, msme, operator } = await loadFixture(deployMSMEIdentityFixture);
      
      await identity.connect(msme).approveOperator(operator.address);
      
      await expect(identity.connect(msme).revokeOperator(operator.address))
        .to.emit(identity, "OperatorRevoked")
        .withArgs(operator.address);
      
      expect(await identity.isApprovedOperator(operator.address)).to.be.false;
    });

    it("Should not allow non-owner to approve operator", async function () {
      const { identity, other, operator } = await loadFixture(deployMSMEIdentityFixture);
      
      await expect(
        identity.connect(other).approveOperator(operator.address)
      ).to.be.revertedWithCustomError(identity, "OwnableUnauthorizedAccount");
    });

    it("Should revert when approving zero address as operator", async function () {
      const { identity, msme } = await loadFixture(deployMSMEIdentityFixture);
      
      await expect(
        identity.connect(msme).approveOperator(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid operator address");
    });
  });

  describe("Data Management", function () {
    it("Should allow owner to set data", async function () {
      const { identity, msme } = await loadFixture(deployMSMEIdentityFixture);
      
      const key = ethers.keccak256(ethers.toUtf8Bytes("gst-number"));
      const value = ethers.toUtf8Bytes("27AABCU9603R1ZM");
      
      await expect(identity.connect(msme).setData(key, value))
        .to.emit(identity, "DataChanged")
        .withArgs(key, value);
      
      expect(await identity.getData(key)).to.equal(ethers.hexlify(value));
    });

    it("Should allow approved operator to set data", async function () {
      const { identity, msme, operator } = await loadFixture(deployMSMEIdentityFixture);
      
      await identity.connect(msme).approveOperator(operator.address);
      
      const key = ethers.keccak256(ethers.toUtf8Bytes("revenue"));
      const value = ethers.toUtf8Bytes("10000000");
      
      await expect(identity.connect(operator).setData(key, value))
        .to.emit(identity, "DataChanged")
        .withArgs(key, value);
      
      expect(await identity.getData(key)).to.equal(ethers.hexlify(value));
    });

    it("Should not allow unauthorized address to set data", async function () {
      const { identity, other } = await loadFixture(deployMSMEIdentityFixture);
      
      const key = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const value = ethers.toUtf8Bytes("test-value");
      
      await expect(
        identity.connect(other).setData(key, value)
      ).to.be.revertedWith("Not authorized");
    });

    it("Should allow batch data setting", async function () {
      const { identity, msme } = await loadFixture(deployMSMEIdentityFixture);
      
      const keys = [
        ethers.keccak256(ethers.toUtf8Bytes("key1")),
        ethers.keccak256(ethers.toUtf8Bytes("key2")),
        ethers.keccak256(ethers.toUtf8Bytes("key3"))
      ];
      
      const values = [
        ethers.toUtf8Bytes("value1"),
        ethers.toUtf8Bytes("value2"),
        ethers.toUtf8Bytes("value3")
      ];
      
      await identity.connect(msme).setDataBatch(keys, values);
      
      for (let i = 0; i < keys.length; i++) {
        expect(await identity.getData(keys[i])).to.equal(ethers.hexlify(values[i]));
      }
    });

    it("Should revert batch setting with mismatched lengths", async function () {
      const { identity, msme } = await loadFixture(deployMSMEIdentityFixture);
      
      const keys = [ethers.keccak256(ethers.toUtf8Bytes("key1"))];
      const values = [
        ethers.toUtf8Bytes("value1"),
        ethers.toUtf8Bytes("value2")
      ];
      
      await expect(
        identity.connect(msme).setDataBatch(keys, values)
      ).to.be.revertedWith("Length mismatch");
    });

    it("Anyone should be able to read data", async function () {
      const { identity, msme, other } = await loadFixture(deployMSMEIdentityFixture);
      
      const key = ethers.keccak256(ethers.toUtf8Bytes("public-data"));
      const value = ethers.toUtf8Bytes("public-value");
      
      await identity.connect(msme).setData(key, value);
      
      expect(await identity.connect(other).getData(key)).to.equal(ethers.hexlify(value));
    });
  });
});
```
