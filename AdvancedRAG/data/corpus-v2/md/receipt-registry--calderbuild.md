# receipt-registry--calderbuild

- domain: registries-identity (registry)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/calderbuild/SafeReceipt @ ae78bdae89f72b9ac68370136269774d36bb7b7a
- license: MIT
- targets: ReceiptRegistry.sol
- validation: 13 passing tests, 0 failing; statement coverage ReceiptRegistry.sol 100.0 %

## Contract: ReceiptRegistry.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract ReceiptRegistry {
    uint256 public nextReceiptId = 1;

    enum Status {
        CREATED,    // Receipt created, no tx linked yet
        EXECUTED,   // Transaction linked, pending verification
        VERIFIED,   // Transaction verified to match intent
        MISMATCH    // Transaction does NOT match intent
    }

    struct Receipt {
        address actor;
        uint8 actionType;
        uint8 riskScore;
        uint40 timestamp;
        bytes32 intentHash;
        bytes32 proofHash;
        bytes32 txHash;      // Linked transaction hash
        Status status;
    }

    mapping(uint256 => Receipt) public receipts;
    mapping(address => uint256[]) public userReceipts;

    event ReceiptCreated(
        uint256 indexed receiptId,
        address indexed actor,
        uint8 indexed actionType,
        bytes32 intentHash,
        bytes32 proofHash,
        uint8 riskScore,
        uint256 timestamp
    );

    event ExecutionLinked(
        uint256 indexed receiptId,
        bytes32 indexed txHash,
        Status status
    );

    function createReceipt(
        uint8 actionType,
        bytes32 intentHash,
        bytes32 proofHash,
        uint8 riskScore
    ) external returns (uint256 receiptId) {
        receiptId = nextReceiptId++;

        receipts[receiptId] = Receipt({
            actor: msg.sender,
            actionType: actionType,
            riskScore: riskScore,
            timestamp: uint40(block.timestamp),
            intentHash: intentHash,
            proofHash: proofHash,
            txHash: bytes32(0),
            status: Status.CREATED
        });

        userReceipts[msg.sender].push(receiptId);

        emit ReceiptCreated(
            receiptId,
            msg.sender,
            actionType,
            intentHash,
            proofHash,
            riskScore,
            block.timestamp
        );
    }

    /**
     * @notice Link a transaction to a receipt and set its verification status
     * @param receiptId The receipt to link
     * @param txHash The transaction hash that executed the intent
     * @param verified True if tx matches intent, false if mismatch. Attested by the
     *        receipt owner: the comparison runs off-chain and only its result is stored.
     */
    function linkExecution(
        uint256 receiptId,
        bytes32 txHash,
        bool verified
    ) external {
        Receipt storage receipt = receipts[receiptId];
        require(receipt.actor == msg.sender, "Not receipt owner");
        require(receipt.status == Status.CREATED, "Already linked");

        receipt.txHash = txHash;
        receipt.status = verified ? Status.VERIFIED : Status.MISMATCH;

        emit ExecutionLinked(receiptId, txHash, receipt.status);
    }

    function getReceipt(uint256 receiptId) external view returns (Receipt memory) {
        return receipts[receiptId];
    }

    function getUserReceipts(address user) external view returns (uint256[] memory) {
        return userReceipts[user];
    }
}
```

## Tests: ReceiptRegistry.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("ReceiptRegistry", function () {
  let receiptRegistry;
  let owner;
  let addr1;

  beforeEach(async function () {
    [owner, addr1] = await ethers.getSigners();
    const ReceiptRegistryFactory = await ethers.getContractFactory("ReceiptRegistry");
    receiptRegistry = await ReceiptRegistryFactory.deploy();
    await receiptRegistry.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct initial receipt ID", async function () {
      expect(await receiptRegistry.nextReceiptId()).to.equal(1);
    });
  });

  describe("Receipt Creation", function () {
    it("Should create a receipt successfully", async function () {
      const actionType = 1; // APPROVE
      const intentHash = ethers.keccak256(ethers.toUtf8Bytes("test intent"));
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes("test proof"));
      const riskScore = 85;

      const tx = await receiptRegistry.createReceipt(
        actionType,
        intentHash,
        proofHash,
        riskScore
      );

      const receipt = await tx.wait();
      expect(receipt).to.not.be.null;

      // Check receipt was stored
      const storedReceipt = await receiptRegistry.getReceipt(1);
      expect(storedReceipt.actor).to.equal(owner.address);
      expect(storedReceipt.actionType).to.equal(actionType);
      expect(storedReceipt.riskScore).to.equal(riskScore);
      expect(storedReceipt.intentHash).to.equal(intentHash);
      expect(storedReceipt.proofHash).to.equal(proofHash);
    });

    it("Should emit ReceiptCreated event", async function () {
      const actionType = 2; // BATCH_PAY
      const intentHash = ethers.keccak256(ethers.toUtf8Bytes("batch intent"));
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes("batch proof"));
      const riskScore = 45;

      await expect(
        receiptRegistry.createReceipt(actionType, intentHash, proofHash, riskScore)
      )
        .to.emit(receiptRegistry, "ReceiptCreated")
        .withArgs(1, owner.address, actionType, intentHash, proofHash, riskScore, anyValue);
    });

    it("Should increment receipt ID", async function () {
      const actionType = 1;
      const intentHash = ethers.keccak256(ethers.toUtf8Bytes("intent1"));
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes("proof1"));
      const riskScore = 30;

      await receiptRegistry.createReceipt(actionType, intentHash, proofHash, riskScore);
      expect(await receiptRegistry.nextReceiptId()).to.equal(2);

      await receiptRegistry.createReceipt(actionType, intentHash, proofHash, riskScore);
      expect(await receiptRegistry.nextReceiptId()).to.equal(3);
    });
  });

  describe("User Receipts", function () {
    it("Should track user receipts correctly", async function () {
      const actionType = 1;
      const intentHash = ethers.keccak256(ethers.toUtf8Bytes("intent"));
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes("proof"));
      const riskScore = 60;

      // Create receipt with owner
      await receiptRegistry.createReceipt(actionType, intentHash, proofHash, riskScore);

      // Create receipt with addr1
      await receiptRegistry.connect(addr1).createReceipt(actionType, intentHash, proofHash, riskScore);

      // Create another receipt with owner
      await receiptRegistry.createReceipt(actionType, intentHash, proofHash, riskScore);

      const ownerReceipts = await receiptRegistry.getUserReceipts(owner.address);
      const addr1Receipts = await receiptRegistry.getUserReceipts(addr1.address);

      expect(ownerReceipts.length).to.equal(2);
      expect(ownerReceipts[0]).to.equal(1);
      expect(ownerReceipts[1]).to.equal(3);

      expect(addr1Receipts.length).to.equal(1);
      expect(addr1Receipts[0]).to.equal(2);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle maximum risk score", async function () {
      const actionType = 1;
      const intentHash = ethers.keccak256(ethers.toUtf8Bytes("max risk"));
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes("max proof"));
      const riskScore = 100;

      await receiptRegistry.createReceipt(actionType, intentHash, proofHash, riskScore);

      const receipt = await receiptRegistry.getReceipt(1);
      expect(receipt.riskScore).to.equal(100);
    });

    it("Should handle zero risk score", async function () {
      const actionType = 2;
      const intentHash = ethers.keccak256(ethers.toUtf8Bytes("zero risk"));
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes("zero proof"));
      const riskScore = 0;

      await receiptRegistry.createReceipt(actionType, intentHash, proofHash, riskScore);

      const receipt = await receiptRegistry.getReceipt(1);
      expect(receipt.riskScore).to.equal(0);
    });
  });

  describe("linkExecution", function () {
    const Status = { CREATED: 0, EXECUTED: 1, VERIFIED: 2, MISMATCH: 3 };
    const h = (x) => ethers.keccak256(ethers.toUtf8Bytes(x));

    beforeEach(async function () {
      await receiptRegistry.createReceipt(1, h("intent"), h("proof"), 40);
    });

    it("Should mark VERIFIED and store the tx hash", async function () {
      await receiptRegistry.linkExecution(1, h("tx"), true);
      const receipt = await receiptRegistry.getReceipt(1);
      expect(receipt.status).to.equal(Status.VERIFIED);
      expect(receipt.txHash).to.equal(h("tx"));
    });

    it("Should mark MISMATCH when verified is false", async function () {
      await receiptRegistry.linkExecution(1, h("tx"), false);
      expect((await receiptRegistry.getReceipt(1)).status).to.equal(Status.MISMATCH);
    });

    it("Should emit ExecutionLinked", async function () {
      await expect(receiptRegistry.linkExecution(1, h("tx"), true))
        .to.emit(receiptRegistry, "ExecutionLinked")
        .withArgs(1, h("tx"), Status.VERIFIED);
    });

    it("Should reject linking from a non-owner", async function () {
      await expect(receiptRegistry.connect(addr1).linkExecution(1, h("tx"), true)).to.be.revertedWith(
        "Not receipt owner"
      );
    });

    it("Should reject double-linking", async function () {
      await receiptRegistry.linkExecution(1, h("tx"), true);
      await expect(receiptRegistry.linkExecution(1, h("tx"), false)).to.be.revertedWith("Already linked");
    });

    it("Should reject a receipt that does not exist", async function () {
      await expect(receiptRegistry.linkExecution(42, h("tx"), true)).to.be.revertedWith("Not receipt owner");
    });
  });
});
```
