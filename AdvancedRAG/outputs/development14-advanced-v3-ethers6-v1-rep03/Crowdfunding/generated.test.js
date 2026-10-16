const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Crowdfunding", function () {
  let crowdfunding;
  let creator, contributor1, contributor2;
  const GOAL = ethers.parseEther("10");
  const DURATION = 60 * 60 * 24 * 7; // 1 week in seconds

  beforeEach(async function () {
    [creator, contributor1, contributor2] = await ethers.getSigners();
    const Crowdfunding = await ethers.getContractFactory("Crowdfunding");
    crowdfunding = await Crowdfunding.deploy(GOAL, DURATION);
    await crowdfunding.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct creator", async function () {
      expect(await crowdfunding.creator()).to.equal(creator.address);
    });

    it("Should set the correct goal", async function () {
      expect(await crowdfunding.goal()).to.equal(GOAL);
    });

    it("Should set the correct deadline", async function () {
      const blockTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
      expect(await crowdfunding.deadline()).to.equal(blockTimestamp + DURATION);
    });
  });

  describe("Contribute", function () {
    it("Should allow contributions before deadline", async function () {
      const contributionAmount = ethers.parseEther("1");
      await expect(crowdfunding.connect(contributor1).contribute({ value: contributionAmount }))
        .to.emit(crowdfunding, "ContributionReceived")
        .withArgs(contributor1.address, contributionAmount);

      expect(await crowdfunding.totalRaised()).to.equal(contributionAmount);
      expect(await crowdfunding.contributions(contributor1.address)).to.equal(contributionAmount);
    });

    it("Should reject zero contributions", async function () {
      await expect(crowdfunding.connect(contributor1).contribute({ value: 0 }))
        .to.be.revertedWith("zero contribution");
    });

    it("Should reject contributions after deadline", async function () {
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      await expect(crowdfunding.connect(contributor1).contribute({ value: ethers.parseEther("1") }))
        .to.be.revertedWith("campaign ended");
    });
  });

  describe("Withdraw", function () {
    it("Should allow creator to withdraw after deadline if goal is met", async function () {
      // Contribute enough to meet the goal
      await crowdfunding.connect(contributor1).contribute({ value: ethers.parseEther("5") });
      await crowdfunding.connect(contributor2).contribute({ value: ethers.parseEther("6") });

      // Fast forward to after deadline
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      const contractBalanceBefore = await ethers.provider.getBalance(await crowdfunding.getAddress());
      const creatorBalanceBefore = await ethers.provider.getBalance(creator.address);

      const tx = await crowdfunding.connect(creator).withdraw();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const contractBalanceAfter = await ethers.provider.getBalance(await crowdfunding.getAddress());
      const creatorBalanceAfter = await ethers.provider.getBalance(creator.address);

      expect(contractBalanceAfter).to.equal(0);
      expect(creatorBalanceAfter).to.equal(
        creatorBalanceBefore + contractBalanceBefore - gasUsed
      );
    });

    it("Should reject withdrawals before deadline", async function () {
      await expect(crowdfunding.connect(creator).withdraw())
        .to.be.revertedWith("too early");
    });

    it("Should reject withdrawals if goal is not met", async function () {
      // Contribute less than the goal
      await crowdfunding.connect(contributor1).contribute({ value: ethers.parseEther("5") });

      // Fast forward to after deadline
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      await expect(crowdfunding.connect(creator).withdraw())
        .to.be.revertedWith("goal not met");
    });

    it("Should reject withdrawals by non-creator", async function () {
      // Contribute enough to meet the goal
      await crowdfunding.connect(contributor1).contribute({ value: ethers.parseEther("11") });

      // Fast forward to after deadline
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      await expect(crowdfunding.connect(contributor1).withdraw())
        .to.be.revertedWith("not creator");
    });
  });

  describe("Refund", function () {
    it("Should allow contributors to get refund after deadline if goal is not met", async function () {
      // Contribute less than the goal
      const contributionAmount = ethers.parseEther("5");
      await crowdfunding.connect(contributor1).contribute({ value: contributionAmount });

      // Fast forward to after deadline
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      const contributorBalanceBefore = await ethers.provider.getBalance(contributor1.address);

      const tx = await crowdfunding.connect(contributor1).refund();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const contributorBalanceAfter = await ethers.provider.getBalance(contributor1.address);

      expect(contributorBalanceAfter).to.equal(
        contributorBalanceBefore + contributionAmount - gasUsed
      );
      expect(await crowdfunding.contributions(contributor1.address)).to.equal(0);
    });

    it("Should reject refunds before deadline", async function () {
      await expect(crowdfunding.connect(contributor1).refund())
        .to.be.revertedWith("too early");
    });

    it("Should reject refunds if goal is met", async function () {
      // Contribute enough to meet the goal
      await crowdfunding.connect(contributor1).contribute({ value: ethers.parseEther("11") });

      // Fast forward to after deadline
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      await expect(crowdfunding.connect(contributor1).refund())
        .to.be.revertedWith("goal met");
    });

    it("Should reject refunds for non-contributors", async function () {
      // Fast forward to after deadline
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      await expect(crowdfunding.connect(contributor1).refund())
        .to.be.revertedWith("nothing to refund");
    });

    it("Should prevent double refunds", async function () {
      // Contribute less than the goal
      await crowdfunding.connect(contributor1).contribute({ value: ethers.parseEther("5") });

      // Fast forward to after deadline
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      // First refund should work
      await expect(crowdfunding.connect(contributor1).refund())
        .to.emit(crowdfunding, "Refunded")
        .withArgs(contributor1.address, ethers.parseEther("5"));

      // Second refund should fail
      await expect(crowdfunding.connect(contributor1).refund())
        .to.be.revertedWith("nothing to refund");
    });
  });
});