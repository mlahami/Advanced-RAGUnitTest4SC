const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Crowdfunding", function () {
  let crowdfunding;
  let creator;
  let contributor1;
  let contributor2;
  const GOAL = ethers.parseEther("10");
  const DURATION = 60 * 60 * 24 * 7; // 1 week in seconds

  beforeEach(async function () {
    [creator, contributor1, contributor2] = await ethers.getSigners();

    const Crowdfunding = await ethers.getContractFactory("Crowdfunding");
    crowdfunding = await Crowdfunding.deploy(GOAL, DURATION);
    await crowdfunding.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right creator", async function () {
      expect(await crowdfunding.creator()).to.equal(creator.address);
    });

    it("Should set the correct goal and deadline", async function () {
      expect(await crowdfunding.goal()).to.equal(GOAL);
      const currentBlock = await ethers.provider.getBlock("latest");
      expect(await crowdfunding.deadline()).to.equal(currentBlock.timestamp + DURATION);
    });
  });

  describe("Contributions", function () {
    it("Should allow contributions before deadline", async function () {
      const contributionAmount = ethers.parseEther("1");
      await expect(crowdfunding.connect(contributor1).contribute({ value: contributionAmount }))
        .to.emit(crowdfunding, "Contribution")
        .withArgs(contributor1.address, contributionAmount);

      expect(await crowdfunding.totalRaised()).to.equal(contributionAmount);
      expect(await crowdfunding.contributions(contributor1.address)).to.equal(contributionAmount);
    });

    it("Should not allow zero contributions", async function () {
      await expect(crowdfunding.connect(contributor1).contribute({ value: 0 }))
        .to.be.revertedWith("zero contribution");
    });

    it("Should not allow contributions after deadline", async function () {
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      await expect(crowdfunding.connect(contributor1).contribute({ value: ethers.parseEther("1") }))
        .to.be.revertedWith("campaign ended");
    });

    it("Should accumulate contributions from multiple contributors", async function () {
      const amount1 = ethers.parseEther("3");
      const amount2 = ethers.parseEther("5");

      await crowdfunding.connect(contributor1).contribute({ value: amount1 });
      await crowdfunding.connect(contributor2).contribute({ value: amount2 });

      expect(await crowdfunding.totalRaised()).to.equal(amount1 + amount2);
      expect(await crowdfunding.contributions(contributor1.address)).to.equal(amount1);
      expect(await crowdfunding.contributions(contributor2.address)).to.equal(amount2);
    });
  });

  describe("Withdrawals", function () {
    it("Should allow creator to withdraw after deadline if goal is met", async function () {
      // Contribute enough to meet the goal
      await crowdfunding.connect(contributor1).contribute({ value: GOAL });

      // Move time past deadline
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
      expect(creatorBalanceAfter).to.equal(creatorBalanceBefore + contractBalanceBefore - gasUsed);
    });

    it("Should not allow withdrawals before deadline", async function () {
      await expect(crowdfunding.connect(creator).withdraw())
        .to.be.revertedWith("too early");
    });

    it("Should not allow withdrawals if goal is not met", async function () {
      // Contribute less than the goal
      await crowdfunding.connect(contributor1).contribute({ value: ethers.parseEther("5") });

      // Move time past deadline
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      await expect(crowdfunding.connect(creator).withdraw())
        .to.be.revertedWith("goal not met");
    });

    it("Should not allow non-creator to withdraw", async function () {
      // Contribute enough to meet the goal
      await crowdfunding.connect(contributor1).contribute({ value: GOAL });

      // Move time past deadline
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      await expect(crowdfunding.connect(contributor1).withdraw())
        .to.be.revertedWith("not creator");
    });
  });

  describe("Refunds", function () {
    it("Should allow contributors to get refund after deadline if goal is not met", async function () {
      const contributionAmount = ethers.parseEther("3");
      await crowdfunding.connect(contributor1).contribute({ value: contributionAmount });

      // Move time past deadline
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      const contributorBalanceBefore = await ethers.provider.getBalance(contributor1.address);

      const tx = await crowdfunding.connect(contributor1).refund();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const contributorBalanceAfter = await ethers.provider.getBalance(contributor1.address);

      expect(contributorBalanceAfter).to.equal(contributorBalanceBefore + contributionAmount - gasUsed);
      expect(await crowdfunding.contributions(contributor1.address)).to.equal(0);
    });

    it("Should not allow refunds before deadline", async function () {
      await expect(crowdfunding.connect(contributor1).refund())
        .to.be.revertedWith("too early");
    });

    it("Should not allow refunds if goal is met", async function () {
      // Contribute enough to meet the goal
      await crowdfunding.connect(contributor1).contribute({ value: GOAL });

      // Move time past deadline
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      await expect(crowdfunding.connect(contributor1).refund())
        .to.be.revertedWith("goal met");
    });

    it("Should not allow refunds for non-contributors", async function () {
      // Move time past deadline
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      await expect(crowdfunding.connect(contributor1).refund())
        .to.be.revertedWith("nothing to refund");
    });

    it("Should not allow double refunds", async function () {
      const contributionAmount = ethers.parseEther("3");
      await crowdfunding.connect(contributor1).contribute({ value: contributionAmount });

      // Move time past deadline
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      // First refund should work
      await expect(crowdfunding.connect(contributor1).refund())
        .to.emit(crowdfunding, "Refund")
        .withArgs(contributor1.address, contributionAmount);

      // Second refund should fail
      await expect(crowdfunding.connect(contributor1).refund())
        .to.be.revertedWith("nothing to refund");
    });
  });
});