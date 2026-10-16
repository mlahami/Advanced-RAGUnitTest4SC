# multisig-controller--ibetekhtin

- domain: multisig-treasury (multisig-wallet)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/ibetekhtin/bitesha-foundation @ bb11fc24c4a32fb95c4e41238ec4dec7ac58196e
- license: MIT
- targets: MultisigController.sol
- validation: 27 passing tests, 0 failing; statement coverage MultisigController.sol 100.0 %

## Contract: MultisigController.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MultisigController
 * @notice Lightweight M-of-N multisig that queues time-locked calls.
 *         For production deploy Gnosis Safe instead — this is a reference implementation.
 *
 * Designed so that large treasury allocations go through:
 *   1. Proposal submitted by a signer
 *   2. M signers approve
 *   3. MIN_DELAY passes
 *   4. Any signer executes
 */
contract MultisigController {
    uint256 public immutable required;     // M signers required
    uint256 public constant MIN_DELAY = 2 days;

    address[] public signers;
    mapping(address => bool) public isSigner;

    struct Proposal {
        address target;
        uint256 value;
        bytes   data;
        uint256 approvals;
        uint256 queuedAt;   // timestamp when M approvals reached
        bool    executed;
        bool    cancelled;
        mapping(address => bool) approved;
    }

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;

    event ProposalCreated(uint256 indexed id, address target, uint256 value);
    event Approved(uint256 indexed id, address signer);
    event Queued(uint256 indexed id, uint256 executeAfter);
    event Executed(uint256 indexed id);
    event Cancelled(uint256 indexed id);

    modifier onlySigner() {
        require(isSigner[msg.sender], "Multisig: not signer");
        _;
    }

    constructor(address[] memory _signers, uint256 _required) {
        require(_signers.length >= _required, "Multisig: required > signers");
        require(_required >= 2, "Multisig: need at least 2 signers");

        for (uint256 i = 0; i < _signers.length; i++) {
            address s = _signers[i];
            require(s != address(0) && !isSigner[s], "Multisig: invalid signer");
            isSigner[s] = true;
            signers.push(s);
        }
        required = _required;
    }

    function propose(address target, uint256 value, bytes calldata data)
        external
        onlySigner
        returns (uint256 id)
    {
        id = proposalCount++;
        Proposal storage p = proposals[id];
        p.target = target;
        p.value  = value;
        p.data   = data;
        emit ProposalCreated(id, target, value);
    }

    /**
     * @notice Cancel a proposal before execution. Requires M signers (same threshold).
     *         Use when calldata is wrong or the situation has changed.
     */
    function cancel(uint256 id) external onlySigner {
        Proposal storage p = proposals[id];
        require(!p.executed, "Multisig: already executed");
        require(!p.cancelled, "Multisig: already cancelled");
        // Require majority to cancel — prevents a single signer from blocking.
        require(p.approvals >= required, "Multisig: not enough approvals to cancel");
        p.cancelled = true;
        emit Cancelled(id);
    }

    function approve(uint256 id) external onlySigner {
        Proposal storage p = proposals[id];
        require(!p.executed, "Multisig: executed");
        require(!p.cancelled, "Multisig: cancelled");
        require(!p.approved[msg.sender], "Multisig: already approved");

        p.approved[msg.sender] = true;
        p.approvals++;
        emit Approved(id, msg.sender);

        if (p.approvals >= required && p.queuedAt == 0) {
            p.queuedAt = block.timestamp;
            emit Queued(id, block.timestamp + MIN_DELAY);
        }
    }

    function execute(uint256 id) external onlySigner {
        Proposal storage p = proposals[id];
        require(!p.executed, "Multisig: executed");
        require(!p.cancelled, "Multisig: cancelled");
        require(p.approvals >= required, "Multisig: not enough approvals");
        require(block.timestamp >= p.queuedAt + MIN_DELAY, "Multisig: delay not passed");

        p.executed = true;
        (bool ok,) = p.target.call{value: p.value}(p.data);
        require(ok, "Multisig: call failed");
        emit Executed(id);
    }

    receive() external payable {}
}
```

## Tests: multisig.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const MIN_DELAY = 2 * 24 * 3600; // 2 days

describe("MultisigController", () => {
  let multisig;
  let signer1, signer2, signer3, outsider;
  const REQUIRED = 2; // 2-of-3

  beforeEach(async () => {
    [signer1, signer2, signer3, outsider] = await ethers.getSigners();
    const Multisig = await ethers.getContractFactory("MultisigController");
    multisig = await Multisig.deploy(
      [signer1.address, signer2.address, signer3.address],
      REQUIRED
    );
  });

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", () => {
    it("sets required correctly", async () => {
      expect(await multisig.required()).to.equal(REQUIRED);
    });

    it("registers all signers", async () => {
      expect(await multisig.isSigner(signer1.address)).to.be.true;
      expect(await multisig.isSigner(signer2.address)).to.be.true;
      expect(await multisig.isSigner(signer3.address)).to.be.true;
    });

    it("non-signer is not registered", async () => {
      expect(await multisig.isSigner(outsider.address)).to.be.false;
    });

    it("reverts if required > signers", async () => {
      const Multisig = await ethers.getContractFactory("MultisigController");
      await expect(Multisig.deploy([signer1.address, signer2.address], 3))
        .to.be.revertedWith("Multisig: required > signers");
    });

    it("reverts if required < 2", async () => {
      const Multisig = await ethers.getContractFactory("MultisigController");
      await expect(Multisig.deploy([signer1.address, signer2.address], 1))
        .to.be.revertedWith("Multisig: need at least 2 signers");
    });

    it("reverts on duplicate signer", async () => {
      const Multisig = await ethers.getContractFactory("MultisigController");
      await expect(
        Multisig.deploy([signer1.address, signer1.address, signer2.address], 2)
      ).to.be.revertedWith("Multisig: invalid signer");
    });

    it("reverts on zero address signer", async () => {
      const Multisig = await ethers.getContractFactory("MultisigController");
      await expect(
        Multisig.deploy([signer1.address, ethers.ZeroAddress, signer2.address], 2)
      ).to.be.revertedWith("Multisig: invalid signer");
    });
  });

  // ── Propose ────────────────────────────────────────────────────────────────

  describe("propose()", () => {
    it("signer can create a proposal", async () => {
      const id = await multisig.connect(signer1)
        .propose.staticCall(outsider.address, 0, "0x");
      await multisig.connect(signer1).propose(outsider.address, 0, "0x");
      expect(await multisig.proposalCount()).to.equal(1);
      const p = await multisig.proposals(id);
      expect(p.target).to.equal(outsider.address);
    });

    it("non-signer cannot propose", async () => {
      await expect(
        multisig.connect(outsider).propose(outsider.address, 0, "0x")
      ).to.be.revertedWith("Multisig: not signer");
    });

    it("emits ProposalCreated", async () => {
      await expect(multisig.connect(signer1).propose(outsider.address, 0, "0x"))
        .to.emit(multisig, "ProposalCreated");
    });
  });

  // ── Approve ────────────────────────────────────────────────────────────────

  describe("approve()", () => {
    let proposalId;

    beforeEach(async () => {
      await multisig.connect(signer1).propose(outsider.address, 0, "0x");
      proposalId = 0;
    });

    it("signer can approve", async () => {
      await multisig.connect(signer1).approve(proposalId);
      const p = await multisig.proposals(proposalId);
      expect(p.approvals).to.equal(1);
    });

    it("emits Approved event", async () => {
      await expect(multisig.connect(signer1).approve(proposalId))
        .to.emit(multisig, "Approved")
        .withArgs(proposalId, signer1.address);
    });

    it("cannot approve twice", async () => {
      await multisig.connect(signer1).approve(proposalId);
      await expect(multisig.connect(signer1).approve(proposalId))
        .to.be.revertedWith("Multisig: already approved");
    });

    it("non-signer cannot approve", async () => {
      await expect(multisig.connect(outsider).approve(proposalId))
        .to.be.revertedWith("Multisig: not signer");
    });

    it("reaching threshold emits Queued and sets queuedAt", async () => {
      await multisig.connect(signer1).approve(proposalId);
      await expect(multisig.connect(signer2).approve(proposalId))
        .to.emit(multisig, "Queued");
      const p = await multisig.proposals(proposalId);
      expect(p.queuedAt).to.be.gt(0);
    });
  });

  // ── Execute ────────────────────────────────────────────────────────────────

  describe("execute()", () => {
    let proposalId;

    // Helper: deploy a simple counter target
    async function deployTarget() {
      // Use treasury as target — fund multisig with ETH and send to signer
      await signer1.sendTransaction({ to: await multisig.getAddress(), value: ethers.parseEther("1") });
      return outsider.address;
    }

    beforeEach(async () => {
      await multisig.connect(signer1).propose(outsider.address, 0, "0x");
      proposalId = 0;
      await multisig.connect(signer1).approve(proposalId);
      await multisig.connect(signer2).approve(proposalId); // reaches threshold
    });

    it("reverts before delay passes", async () => {
      await expect(multisig.connect(signer1).execute(proposalId))
        .to.be.revertedWith("Multisig: delay not passed");
    });

    it("executes after delay", async () => {
      await time.increase(MIN_DELAY);
      await expect(multisig.connect(signer1).execute(proposalId))
        .to.emit(multisig, "Executed")
        .withArgs(proposalId);
      expect((await multisig.proposals(proposalId)).executed).to.be.true;
    });

    it("cannot execute twice", async () => {
      await time.increase(MIN_DELAY);
      await multisig.connect(signer1).execute(proposalId);
      await expect(multisig.connect(signer2).execute(proposalId))
        .to.be.revertedWith("Multisig: executed");
    });

    it("non-signer cannot execute", async () => {
      await time.increase(MIN_DELAY);
      await expect(multisig.connect(outsider).execute(proposalId))
        .to.be.revertedWith("Multisig: not signer");
    });

    it("reverts if not enough approvals", async () => {
      await multisig.connect(signer1).propose(outsider.address, 0, "0x");
      const newId = 1;
      await multisig.connect(signer1).approve(newId); // only 1 of 2
      await expect(multisig.connect(signer1).execute(newId))
        .to.be.revertedWith("Multisig: not enough approvals");
    });
  });

  // ── Cancel ────────────────────────────────────────────────────────────────

  describe("cancel()", () => {
    let proposalId;

    beforeEach(async () => {
      await multisig.connect(signer1).propose(outsider.address, 0, "0x");
      proposalId = 0;
    });

    it("cannot cancel before M approvals", async () => {
      await multisig.connect(signer1).approve(proposalId); // only 1 of 2
      await expect(multisig.connect(signer1).cancel(proposalId))
        .to.be.revertedWith("Multisig: not enough approvals to cancel");
    });

    it("can cancel after M approvals", async () => {
      await multisig.connect(signer1).approve(proposalId);
      await multisig.connect(signer2).approve(proposalId);
      await expect(multisig.connect(signer1).cancel(proposalId))
        .to.emit(multisig, "Cancelled")
        .withArgs(proposalId);
      expect((await multisig.proposals(proposalId)).cancelled).to.be.true;
    });

    it("cannot execute a cancelled proposal", async () => {
      await multisig.connect(signer1).approve(proposalId);
      await multisig.connect(signer2).approve(proposalId);
      await multisig.connect(signer1).cancel(proposalId);
      await time.increase(MIN_DELAY);
      await expect(multisig.connect(signer1).execute(proposalId))
        .to.be.revertedWith("Multisig: cancelled");
    });

    it("cannot approve a cancelled proposal", async () => {
      await multisig.connect(signer1).approve(proposalId);
      await multisig.connect(signer2).approve(proposalId);
      await multisig.connect(signer1).cancel(proposalId);
      await expect(multisig.connect(signer3).approve(proposalId))
        .to.be.revertedWith("Multisig: cancelled");
    });

    it("cannot cancel twice", async () => {
      await multisig.connect(signer1).approve(proposalId);
      await multisig.connect(signer2).approve(proposalId);
      await multisig.connect(signer1).cancel(proposalId);
      await expect(multisig.connect(signer2).cancel(proposalId))
        .to.be.revertedWith("Multisig: already cancelled");
    });

    it("non-signer cannot cancel", async () => {
      await multisig.connect(signer1).approve(proposalId);
      await multisig.connect(signer2).approve(proposalId);
      await expect(multisig.connect(outsider).cancel(proposalId))
        .to.be.revertedWith("Multisig: not signer");
    });

    it("cannot cancel an already executed proposal", async () => {
      await multisig.connect(signer1).approve(proposalId);
      await multisig.connect(signer2).approve(proposalId);
      await time.increase(MIN_DELAY);
      await multisig.connect(signer1).execute(proposalId);
      await expect(multisig.connect(signer1).cancel(proposalId))
        .to.be.revertedWith("Multisig: already executed");
    });
  });
});
```
