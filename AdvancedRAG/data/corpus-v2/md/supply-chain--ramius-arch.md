# supply-chain--ramius-arch

- domain: supply-chain (supply-chain)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Ramius-arch/PharmaSupply-Chain @ 08cd9e8e723620a97753326ed7d9fe425688a53e
- license: MIT
- targets: SupplyChain.sol
- validation: 12 passing tests, 0 failing; statement coverage SupplyChain.sol 100.0 %

## Contract: SupplyChain.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract SupplyChain is AccessControl {
    enum Status { Created, InTransit, Delivered, Canceled }

    bytes32 public constant SUPPLIER_ROLE = keccak256("SUPPLIER_ROLE");
    bytes32 public constant COURIER_ROLE = keccak256("COURIER_ROLE");

    struct Item {
        uint256 id;
        string description;
        Status status;
        uint256 lastUpdated;
    }

    struct StatusUpdate {
        Status status;
        uint256 timestamp;
        address updater;
    }

    uint256 private _itemCounter;
    mapping(uint256 => Item) public items;
    mapping(uint256 => StatusUpdate[]) public itemHistory;

    event ItemCreated(uint256 indexed itemId, string description, address creator);
    event ItemStatusUpdated(uint256 indexed itemId, Status newStatus, address updater);

    modifier onlyValidStatus(Status _status) {
        require(uint8(_status) <= uint8(Status.Canceled), "Invalid status");
        _;
    }

    modifier itemExists(uint256 _itemId) {
        require(_itemId > 0 && _itemId <= _itemCounter, "Item does not exist");
        _;
    }

    constructor(address admin) {
        require(admin != address(0), "Admin cannot be zero address");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _setRoleAdmin(SUPPLIER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(COURIER_ROLE, DEFAULT_ADMIN_ROLE);
    }

    function createItem(string memory _description)
        public
        onlyRole(SUPPLIER_ROLE)
        returns (uint256)
    {
        _itemCounter++;
        uint256 newItemId = _itemCounter;

        items[newItemId] = Item({
            id: newItemId,
            description: _description,
            status: Status.Created,
            lastUpdated: block.timestamp
        });

        _addStatusHistory(newItemId, Status.Created);

        emit ItemCreated(newItemId, _description, msg.sender);
        return newItemId;
    }

    function updateItemStatus(uint256 _itemId, Status _newStatus)
        public
        itemExists(_itemId)
        onlyValidStatus(_newStatus)
        onlyRole(COURIER_ROLE)
    {
        require(items[_itemId].status != _newStatus, "Item is already in this status");
        require(items[_itemId].status != Status.Delivered, "Cannot update status of a delivered item");

        items[_itemId].status = _newStatus;
        items[_itemId].lastUpdated = block.timestamp;

        _addStatusHistory(_itemId, _newStatus);

        emit ItemStatusUpdated(_itemId, _newStatus, msg.sender);
    }

    function getItem(uint256 _itemId)
        public
        view
        itemExists(_itemId)
        returns (uint256, string memory, Status, uint256)
    {
        Item memory item = items[_itemId];
        return (item.id, item.description, item.status, item.lastUpdated);
    }

    function getItemHistory(uint256 _itemId)
        public
        view
        itemExists(_itemId)
        returns (StatusUpdate[] memory)
    {
        return itemHistory[_itemId];
    }

    function _addStatusHistory(uint256 _itemId, Status _status) private {
        itemHistory[_itemId].push(StatusUpdate({
            status: _status,
            timestamp: block.timestamp,
            updater: msg.sender
        }));
    }
}
```

## Tests: SupplyChain.test.js

```javascript
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SupplyChain", function () {
  async function deploySupplyChainFixture() {
    const [admin, supplier, courier, other] = await ethers.getSigners();

    const SupplyChain = await ethers.getContractFactory("SupplyChain");
    const supplyChain = await SupplyChain.deploy(admin.address);

    // Grant roles for testing
    await supplyChain.connect(admin).grantRole(await supplyChain.SUPPLIER_ROLE(), supplier.address);
    await supplyChain.connect(admin).grantRole(await supplyChain.COURIER_ROLE(), courier.address);

    return { supplyChain, admin, supplier, courier, other };
  }

  describe("Deployment", function () {
    it("Should set the deployer as the default admin", async function () {
      const { supplyChain, admin } = await loadFixture(deploySupplyChainFixture);
      expect(await supplyChain.hasRole(await supplyChain.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
    });

    it("Should reject zero address admin", async function () {
      const SupplyChain = await ethers.getContractFactory("SupplyChain");
      await expect(SupplyChain.deploy(ethers.ZeroAddress)).to.be.revertedWith("Admin cannot be zero address");
    });
  });

  describe("Access control", function () {
    it("Should not allow unauthorized accounts to create items", async function () {
      const { supplyChain, other } = await loadFixture(deploySupplyChainFixture);
      await expect(supplyChain.connect(other).createItem("Unauthorized"))
        .to.be.revertedWithCustomError(supplyChain, "AccessControlUnauthorizedAccount");
    });

    it("Should not allow unauthorized accounts to update status", async function () {
      const { supplyChain, supplier, other } = await loadFixture(deploySupplyChainFixture);
      await supplyChain.connect(supplier).createItem("Test Item");
      await expect(supplyChain.connect(other).updateItemStatus(1, 1))
        .to.be.revertedWithCustomError(supplyChain, "AccessControlUnauthorizedAccount");
    });

    it("Should not allow suppliers to update status", async function () {
      const { supplyChain, supplier } = await loadFixture(deploySupplyChainFixture);
      await supplyChain.connect(supplier).createItem("Test Item");
      await expect(supplyChain.connect(supplier).updateItemStatus(1, 1))
        .to.be.revertedWithCustomError(supplyChain, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Items", function () {
    it("Should allow a supplier to create a new item", async function () {
      const { supplyChain, supplier } = await loadFixture(deploySupplyChainFixture);
      await expect(supplyChain.connect(supplier).createItem("Test Item 1"))
        .to.emit(supplyChain, "ItemCreated")
        .withArgs(1, "Test Item 1", anyValue);
    });

    it("Should return the correct item details", async function () {
      const { supplyChain, supplier } = await loadFixture(deploySupplyChainFixture);
      await supplyChain.connect(supplier).createItem("Test Item 2");
      const [id, description, status] = await supplyChain.getItem(1);
      expect(id).to.equal(1);
      expect(description).to.equal("Test Item 2");
      expect(status).to.equal(0); // Status.Created
    });

    it("Should allow a courier to update an item's status", async function () {
      const { supplyChain, supplier, courier } = await loadFixture(deploySupplyChainFixture);
      await supplyChain.connect(supplier).createItem("Test Item 3");

      const newStatus = 1; // Status.InTransit
      await expect(supplyChain.connect(courier).updateItemStatus(1, newStatus))
        .to.emit(supplyChain, "ItemStatusUpdated")
        .withArgs(1, newStatus, anyValue);

      const [, , status] = await supplyChain.getItem(1);
      expect(status).to.equal(newStatus);
    });

    it("Should retrieve item history", async function () {
      const { supplyChain, supplier, courier } = await loadFixture(deploySupplyChainFixture);
      await supplyChain.connect(supplier).createItem("Test Item 4");
      await supplyChain.connect(courier).updateItemStatus(1, 1); // InTransit
      await supplyChain.connect(courier).updateItemStatus(1, 2); // Delivered

      const history = await supplyChain.getItemHistory(1);
      expect(history.length).to.equal(3);
      expect(history[0].status).to.equal(0); // Created
      expect(history[1].status).to.equal(1); // InTransit
      expect(history[2].status).to.equal(2); // Delivered
    });

    it("Should fail to update status for a non-existent item", async function () {
      const { supplyChain, courier } = await loadFixture(deploySupplyChainFixture);
      await expect(supplyChain.connect(courier).updateItemStatus(99, 1)).to.be.revertedWith("Item does not exist");
    });

    it("Should fail to update status of a delivered item", async function () {
      const { supplyChain, supplier, courier } = await loadFixture(deploySupplyChainFixture);
      await supplyChain.connect(supplier).createItem("Test Item 6");
      await supplyChain.connect(courier).updateItemStatus(1, 2); // Delivered
      await expect(supplyChain.connect(courier).updateItemStatus(1, 1)).to.be.revertedWith("Cannot update status of a delivered item");
    });

    it("Should fail to update status with the same status", async function () {
      const { supplyChain, supplier, courier } = await loadFixture(deploySupplyChainFixture);
      await supplyChain.connect(supplier).createItem("Test Item 7");
      await expect(supplyChain.connect(courier).updateItemStatus(1, 0)).to.be.revertedWith("Item is already in this status");
    });
  });
});
```
