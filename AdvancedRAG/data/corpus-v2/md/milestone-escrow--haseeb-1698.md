# milestone-escrow--haseeb-1698

- domain: escrow-conditional-payments (escrow)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Haseeb-1698/Defi-Freelance-Marketplace @ 2ce6124ca6ea8dea3010a8a3e5a890aed01eeff4
- license: MIT
- targets: MilestoneEscrow.sol, MockUSDC.sol
- validation: 21 passing tests, 0 failing; statement coverage MilestoneEscrow.sol 98.08 %, MockUSDC.sol 50.0 %

## Contract: MilestoneEscrow.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MilestoneEscrow
 * @notice Per-job escrow contract cloned by EscrowFactory. Holds funds for each milestone
 *         and releases them upon client approval or arbitrator resolution.
 */
contract MilestoneEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum MilestoneState { Pending, Submitted, Approved, Paid, Disputed, Resolved }
    enum EscrowState { Created, Funded, InProgress, Completed, Cancelled }

    struct Milestone {
        uint128 amount;
        uint64  dueDate;
        string  description;
        string  deliverableURI;
        bytes32 deliverableHash;
        MilestoneState state;
    }

    address public client;
    address public freelancer;
    address public arbitrator;
    IERC20  public token;
    EscrowState public escrowState;

    Milestone[] public milestones;

    // mutual cancel consent
    bool public clientConsentsCancel;
    bool public freelancerConsentsCancel;

    event Funded(uint256 totalAmount);
    event DeliverableSubmitted(uint256 indexed milestoneId, string uri, bytes32 hash);
    event MilestoneApproved(uint256 indexed milestoneId, uint256 amount);
    event DisputeOpened(uint256 indexed milestoneId, address indexed by, string reasonURI);
    event DisputeResolved(uint256 indexed milestoneId, bool awardedToFreelancer, uint256 amount);
    event CancelConsented(address indexed by);
    event Cancelled();

    error NotClient();
    error NotFreelancer();
    error NotArbitrator(address caller);
    error NotParty();
    error WrongEscrowState(EscrowState current);
    error WrongMilestoneState(uint256 id, MilestoneState current);
    error InvalidMilestone(uint256 id);
    error AlreadyInitialized();

    bool private _initialized;

    modifier onlyClient() {
        if (msg.sender != client) revert NotClient();
        _;
    }

    modifier onlyFreelancer() {
        if (msg.sender != freelancer) revert NotFreelancer();
        _;
    }

    modifier onlyArbitrator() {
        if (msg.sender != arbitrator) revert NotArbitrator(msg.sender);
        _;
    }

    modifier onlyParty() {
        if (msg.sender != client && msg.sender != freelancer) revert NotParty();
        _;
    }

    modifier inEscrowState(EscrowState expected) {
        if (escrowState != expected) revert WrongEscrowState(escrowState);
        _;
    }

    modifier validMilestone(uint256 id) {
        if (id >= milestones.length) revert InvalidMilestone(id);
        _;
    }

    struct MilestoneInput {
        uint128 amount;
        uint64  dueDate;
        string  description;
    }

    function initialize(
        address _client,
        address _freelancer,
        address _arbitrator,
        address _token,
        MilestoneInput[] calldata _milestones
    ) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;

        client     = _client;
        freelancer = _freelancer;
        arbitrator = _arbitrator;
        token      = IERC20(_token);
        escrowState = EscrowState.Created;

        for (uint256 i = 0; i < _milestones.length; i++) {
            milestones.push(Milestone({
                amount:          _milestones[i].amount,
                dueDate:         _milestones[i].dueDate,
                description:     _milestones[i].description,
                deliverableURI:  "",
                deliverableHash: bytes32(0),
                state:           MilestoneState.Pending
            }));
        }
    }

    // ── Client: deposit total funds ──────────────────────────────────────────

    function fund() external onlyClient inEscrowState(EscrowState.Created) nonReentrant {
        uint256 total = _totalAmount();
        token.safeTransferFrom(client, address(this), total);
        escrowState = EscrowState.Funded;
        emit Funded(total);
    }

    // ── Freelancer: submit deliverable for a milestone ───────────────────────

    function submitDeliverable(
        uint256 milestoneId,
        string calldata uri,
        bytes32 hash
    ) external onlyFreelancer validMilestone(milestoneId) {
        if (escrowState != EscrowState.Funded && escrowState != EscrowState.InProgress)
            revert WrongEscrowState(escrowState);

        Milestone storage m = milestones[milestoneId];
        if (m.state != MilestoneState.Pending) revert WrongMilestoneState(milestoneId, m.state);

        m.deliverableURI  = uri;
        m.deliverableHash = hash;
        m.state = MilestoneState.Submitted;

        if (escrowState == EscrowState.Funded) escrowState = EscrowState.InProgress;

        emit DeliverableSubmitted(milestoneId, uri, hash);
    }

    // ── Client: approve milestone → release payment ──────────────────────────

    function approveMilestone(uint256 milestoneId)
        external
        onlyClient
        validMilestone(milestoneId)
        nonReentrant
    {
        Milestone storage m = milestones[milestoneId];
        if (m.state != MilestoneState.Submitted) revert WrongMilestoneState(milestoneId, m.state);

        m.state = MilestoneState.Approved;
        _releaseMilestone(milestoneId, m);

        if (_allPaid()) escrowState = EscrowState.Completed;

        emit MilestoneApproved(milestoneId, m.amount);
    }

    // ── Party: open dispute on a submitted milestone ─────────────────────────

    function openDispute(uint256 milestoneId, string calldata reasonURI)
        external
        onlyParty
        validMilestone(milestoneId)
    {
        Milestone storage m = milestones[milestoneId];
        if (m.state != MilestoneState.Submitted) revert WrongMilestoneState(milestoneId, m.state);

        m.state = MilestoneState.Disputed;
        emit DisputeOpened(milestoneId, msg.sender, reasonURI);
    }

    // ── Arbitrator: resolve dispute ──────────────────────────────────────────

    function resolveDispute(uint256 milestoneId, bool awardToFreelancer)
        external
        onlyArbitrator
        validMilestone(milestoneId)
        nonReentrant
    {
        Milestone storage m = milestones[milestoneId];
        if (m.state != MilestoneState.Disputed) revert WrongMilestoneState(milestoneId, m.state);

        m.state = MilestoneState.Resolved;

        uint256 amount = m.amount;
        address recipient = awardToFreelancer ? freelancer : client;
        token.safeTransfer(recipient, amount);

        emit DisputeResolved(milestoneId, awardToFreelancer, amount);

        if (_allPaid()) escrowState = EscrowState.Completed;
    }

    // ── Mutual cancel ────────────────────────────────────────────────────────

    function consentCancel() external onlyParty {
        if (msg.sender == client) clientConsentsCancel = true;
        else freelancerConsentsCancel = true;

        emit CancelConsented(msg.sender);

        if (clientConsentsCancel && freelancerConsentsCancel) {
            _refundUnpaid();
        }
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function milestoneCount() external view returns (uint256) {
        return milestones.length;
    }

    function getMilestone(uint256 id) external view returns (Milestone memory) {
        return milestones[id];
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    function _totalAmount() internal view returns (uint256 total) {
        for (uint256 i = 0; i < milestones.length; i++) {
            total += milestones[i].amount;
        }
    }

    function _releaseMilestone(uint256, Milestone storage m) internal {
        m.state = MilestoneState.Paid;
        token.safeTransfer(freelancer, m.amount);
    }

    function _allPaid() internal view returns (bool) {
        for (uint256 i = 0; i < milestones.length; i++) {
            MilestoneState s = milestones[i].state;
            if (s != MilestoneState.Paid && s != MilestoneState.Resolved) return false;
        }
        return true;
    }

    function _refundUnpaid() internal nonReentrant {
        uint256 refund;
        for (uint256 i = 0; i < milestones.length; i++) {
            Milestone storage m = milestones[i];
            if (m.state == MilestoneState.Pending || m.state == MilestoneState.Submitted) {
                refund += m.amount;
                m.state = MilestoneState.Resolved;
            }
        }
        escrowState = EscrowState.Cancelled;
        if (refund > 0) token.safeTransfer(client, refund);
        emit Cancelled();
    }
}
```

## Contract: MockUSDC.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockUSDC is ERC20, Ownable {
    uint8 private constant _DECIMALS = 6;

    constructor() ERC20("Mock USDC", "mUSDC") Ownable(msg.sender) {}

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
```

## Tests: MilestoneEscrow.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const USDC_DECIMALS = 6n;
const AMOUNT_M0 = 500n * 10n ** USDC_DECIMALS; // 500 mUSDC
const AMOUNT_M1 = 300n * 10n ** USDC_DECIMALS;
const AMOUNT_M2 = 200n * 10n ** USDC_DECIMALS;
const TOTAL = AMOUNT_M0 + AMOUNT_M1 + AMOUNT_M2;

async function deployFixture() {
  const [deployer, clientSig, freelancerSig, arbitratorSig, other] = await ethers.getSigners();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();

  const MilestoneEscrow = await ethers.getContractFactory("MilestoneEscrow");
  const escrow = await MilestoneEscrow.deploy();

  const now = Math.floor(Date.now() / 1000);
  const milestones = [
    { amount: AMOUNT_M0, dueDate: now + 86400, description: "Milestone 1" },
    { amount: AMOUNT_M1, dueDate: now + 172800, description: "Milestone 2" },
    { amount: AMOUNT_M2, dueDate: now + 259200, description: "Milestone 3" },
  ];

  await escrow.initialize(
    clientSig.address,
    freelancerSig.address,
    arbitratorSig.address,
    await usdc.getAddress(),
    milestones
  );

  await usdc.mint(clientSig.address, TOTAL);
  await usdc.connect(clientSig).approve(await escrow.getAddress(), TOTAL);

  return { escrow, usdc, deployer, client: clientSig, freelancer: freelancerSig, arbitrator: arbitratorSig, other };
}

describe("MilestoneEscrow", () => {
  describe("initialization", () => {
    it("sets parties correctly", async () => {
      const { escrow, client, freelancer, arbitrator } = await loadFixture(deployFixture);
      expect(await escrow.client()).to.equal(client.address);
      expect(await escrow.freelancer()).to.equal(freelancer.address);
      expect(await escrow.arbitrator()).to.equal(arbitrator.address);
    });

    it("reverts double initialization", async () => {
      const { escrow, client, freelancer, arbitrator, usdc } = await loadFixture(deployFixture);
      const now = Math.floor(Date.now() / 1000);
      await expect(
        escrow.initialize(client.address, freelancer.address, arbitrator.address, await usdc.getAddress(), [
          { amount: 100n, dueDate: now + 1000, description: "x" },
        ])
      ).to.be.revertedWithCustomError(escrow, "AlreadyInitialized");
    });
  });

  describe("fund", () => {
    it("client can fund and escrow holds token balance", async () => {
      const { escrow, usdc, client } = await loadFixture(deployFixture);
      await escrow.connect(client).fund();
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(TOTAL);
    });

    it("non-client cannot fund", async () => {
      const { escrow, freelancer } = await loadFixture(deployFixture);
      await expect(escrow.connect(freelancer).fund()).to.be.revertedWithCustomError(escrow, "NotClient");
    });

    it("cannot fund twice", async () => {
      const { escrow, client } = await loadFixture(deployFixture);
      await escrow.connect(client).fund();
      await expect(escrow.connect(client).fund()).to.be.revertedWithCustomError(escrow, "WrongEscrowState");
    });
  });

  async function fundedFixture() {
    const f = await deployFixture();
    await f.escrow.connect(f.client).fund();
    return f;
  }

  describe("submitDeliverable", () => {
    it("freelancer submits and state becomes Submitted", async () => {
      const { escrow, freelancer } = await loadFixture(fundedFixture);
      const uri = "ipfs://Qm123";
      const hash = ethers.keccak256(ethers.toUtf8Bytes("content"));
      await escrow.connect(freelancer).submitDeliverable(0, uri, hash);
      const m = await escrow.getMilestone(0);
      expect(m.state).to.equal(1); // Submitted
    });

    it("non-freelancer cannot submit", async () => {
      const { escrow, client } = await loadFixture(fundedFixture);
      await expect(
        escrow.connect(client).submitDeliverable(0, "ipfs://x", ethers.ZeroHash)
      ).to.be.revertedWithCustomError(escrow, "NotFreelancer");
    });

    it("cannot submit twice", async () => {
      const { escrow, freelancer } = await loadFixture(fundedFixture);
      await escrow.connect(freelancer).submitDeliverable(0, "ipfs://x", ethers.ZeroHash);
      await expect(
        escrow.connect(freelancer).submitDeliverable(0, "ipfs://y", ethers.ZeroHash)
      ).to.be.revertedWithCustomError(escrow, "WrongMilestoneState");
    });
  });

  describe("approveMilestone", () => {
    it("client approves → freelancer receives payment", async () => {
      const { escrow, usdc, client, freelancer } = await loadFixture(fundedFixture);
      await escrow.connect(freelancer).submitDeliverable(0, "ipfs://x", ethers.ZeroHash);
      const before = await usdc.balanceOf(freelancer.address);
      await escrow.connect(client).approveMilestone(0);
      const after = await usdc.balanceOf(freelancer.address);
      expect(after - before).to.equal(AMOUNT_M0);
    });

    it("non-client cannot approve", async () => {
      const { escrow, freelancer } = await loadFixture(fundedFixture);
      await escrow.connect(freelancer).submitDeliverable(0, "ipfs://x", ethers.ZeroHash);
      await expect(
        escrow.connect(freelancer).approveMilestone(0)
      ).to.be.revertedWithCustomError(escrow, "NotClient");
    });

    it("cannot approve before submission", async () => {
      const { escrow, client } = await loadFixture(fundedFixture);
      await expect(escrow.connect(client).approveMilestone(0)).to.be.revertedWithCustomError(
        escrow, "WrongMilestoneState"
      );
    });

    it("cannot approve twice (double payout guard)", async () => {
      const { escrow, client, freelancer } = await loadFixture(fundedFixture);
      await escrow.connect(freelancer).submitDeliverable(0, "ipfs://x", ethers.ZeroHash);
      await escrow.connect(client).approveMilestone(0);
      await expect(escrow.connect(client).approveMilestone(0)).to.be.revertedWithCustomError(
        escrow, "WrongMilestoneState"
      );
    });

    it("marks contract Completed when all milestones paid", async () => {
      const { escrow, client, freelancer } = await loadFixture(fundedFixture);
      for (let i = 0; i < 3; i++) {
        await escrow.connect(freelancer).submitDeliverable(i, `ipfs://${i}`, ethers.ZeroHash);
        await escrow.connect(client).approveMilestone(i);
      }
      expect(await escrow.escrowState()).to.equal(3); // Completed
    });
  });

  describe("openDispute", () => {
    it("client can dispute a submitted milestone", async () => {
      const { escrow, client, freelancer } = await loadFixture(fundedFixture);
      await escrow.connect(freelancer).submitDeliverable(0, "ipfs://x", ethers.ZeroHash);
      await escrow.connect(client).openDispute(0, "ipfs://reason");
      expect((await escrow.getMilestone(0)).state).to.equal(4); // Disputed
    });

    it("cannot dispute a pending milestone", async () => {
      const { escrow, client } = await loadFixture(fundedFixture);
      await expect(
        escrow.connect(client).openDispute(0, "ipfs://reason")
      ).to.be.revertedWithCustomError(escrow, "WrongMilestoneState");
    });

    it("third party cannot dispute", async () => {
      const { escrow, freelancer, other } = await loadFixture(fundedFixture);
      await escrow.connect(freelancer).submitDeliverable(0, "ipfs://x", ethers.ZeroHash);
      await expect(
        escrow.connect(other).openDispute(0, "ipfs://r")
      ).to.be.revertedWithCustomError(escrow, "NotParty");
    });
  });

  describe("resolveDispute", () => {
    async function disputedFixture() {
      const f = await fundedFixture();
      await f.escrow.connect(f.freelancer).submitDeliverable(0, "ipfs://x", ethers.ZeroHash);
      await f.escrow.connect(f.client).openDispute(0, "ipfs://reason");
      return f;
    }

    it("arbitrator awards to freelancer", async () => {
      const { escrow, usdc, arbitrator, freelancer } = await loadFixture(disputedFixture);
      const before = await usdc.balanceOf(freelancer.address);
      await escrow.connect(arbitrator).resolveDispute(0, true);
      expect(await usdc.balanceOf(freelancer.address) - before).to.equal(AMOUNT_M0);
    });

    it("arbitrator refunds to client", async () => {
      const { escrow, usdc, arbitrator, client } = await loadFixture(disputedFixture);
      const before = await usdc.balanceOf(client.address);
      await escrow.connect(arbitrator).resolveDispute(0, false);
      expect(await usdc.balanceOf(client.address) - before).to.equal(AMOUNT_M0);
    });

    it("non-arbitrator cannot resolve", async () => {
      const { escrow, client } = await loadFixture(disputedFixture);
      await expect(
        escrow.connect(client).resolveDispute(0, true)
      ).to.be.revertedWithCustomError(escrow, "NotArbitrator");
    });
  });

  describe("mutual cancel", () => {
    it("refunds unpaid milestones when both consent", async () => {
      const { escrow, usdc, client, freelancer } = await loadFixture(fundedFixture);
      const before = await usdc.balanceOf(client.address);
      await escrow.connect(client).consentCancel();
      await escrow.connect(freelancer).consentCancel();
      const after = await usdc.balanceOf(client.address);
      expect(after - before).to.equal(TOTAL);
      expect(await escrow.escrowState()).to.equal(4); // Cancelled
    });

    it("single consent is not enough", async () => {
      const { escrow, usdc, client } = await loadFixture(fundedFixture);
      const before = await usdc.balanceOf(client.address);
      await escrow.connect(client).consentCancel();
      expect(await usdc.balanceOf(client.address)).to.equal(before); // no transfer yet
    });
  });
});
```
