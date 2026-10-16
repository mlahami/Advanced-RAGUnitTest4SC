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
