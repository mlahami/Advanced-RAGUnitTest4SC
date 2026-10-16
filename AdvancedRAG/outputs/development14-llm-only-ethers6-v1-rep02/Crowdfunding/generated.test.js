const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Crowdfunding", function () {
  let crowdfunding;
  let creator;
  let contributor1;
  let contributor2;
  let goal = ethers.parseEther("10");
  let duration = 86400; // 1 day in seconds

  beforeEach(async function () {
    [creator, contributor1, contributor2] = await ethers.getSigners();

    const Crowdfunding = await ethers.getContractFactory("Crowdfunding");
    crowdfunding = await Crowdfunding.deploy(goal, duration);
    await crowdfunding.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right creator", async function () {
      expect(await crowdfunding.creator()).to.equal(creator.address);
    });

    it("Should set the right goal", async function () {
      expect(await crowdfunding.goal()).to.equal(goal);
    });

    it("Should set the right deadline", async function () {
      const blockTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
      expect(await crowdfunding.deadline()).to.equal(blockTimestamp + duration);
    });
  });

  describe("Contribute", function () {
    it("Should allow contributions before deadline", async function () {
      const contribution = ethers.parseEther("1");
      await expect(crowdfunding.connect(contributor1).contribute({ value: contribution }))
        .to.emit(crowdfunding, "Contribution")
        .withArgs(contributor1.address, contribution);

      expect(await crowdfunding.totalRaised()).to.equal(contribution);
      expect(await crowdfunding.contributions(contributor1.address)).to.equal(contribution);
    });

    it("Should reject zero contributions", async function () {
      await expect(crowdfunding.connect(contributor1).contribute({ value: 0 }))
        .to.be.revertedWith("zero contribution");
    });

    it("Should reject contributions after deadline", async function () {
      await ethers.provider.send("evm_increaseTime", [duration + 1]);
      await ethers.provider.send("evm_mine");

      await expect(crowdfunding.connect(contributor1).contribute({ value: ethers.parseEther("1") }))
        .to.be.revertedWith("campaign ended");
    });

    it("Should accumulate contributions from multiple contributors", async function () {
      const contribution1 = ethers.parseEther("1");
      const contribution2 = ethers.parseEther("2");

      await crowdfunding.connect(contributor1).contribute({ value: contribution1 });
      await crowdfunding.connect(contributor2).contribute({ value: contribution2 });

      expect(await crowdfunding.totalRaised()).to.equal(contribution1 + contribution2);
      expect(await crowdfunding.contributions(contributor1.address)).to.equal(contribution1);
      expect(await crowdfunding.contributions(contributor2.address)).to.equal(contribution2);
    });
  });

  describe("Withdraw", function () {
    it("Should allow creator to withdraw after deadline if goal is met", async function () {
      await crowdfunding.connect(contributor1).contribute({ value: goal });

      await ethers.provider.send("evm_increaseTime", [duration + 1]);
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

    it("Should reject withdrawals before deadline", async function () {
      await expect(crowdfunding.connect(creator).withdraw())
        .to.be.revertedWith("too early");
    });

    it("Should reject withdrawals if goal is not met", async function () {
      await crowdfunding.connect(contributor1).contribute({ value: ethers.parseEther("1") });

      await ethers.provider.send("evm_increaseTime", [duration + 1]);
      await ethers.provider.send("evm_mine");

      await expect(crowdfunding.connect(creator).withdraw())
        .to.be.revertedWith("goal not met");
    });

    it("Should reject withdrawals from non-creator", async function () {
      await ethers.provider.send("evm_increaseTime", [duration + 1]);
      await ethers.provider.send("evm_mine");

      await expect(crowdfunding.connect(contributor1).withdraw())
        .to.be.revertedWith("not creator");
    });
  });

  describe("Refund", function () {
    it("Should allow refunds after deadline if goal is not met", async function () {
      const contribution = ethers.parseEther("1");
      await crowdfunding.connect(contributor1).contribute({ value: contribution });

      await ethers.provider.send("evm_increaseTime", [duration + 1]);
      await ethers.provider.send("evm_mine");

      const contributorBalanceBefore = await ethers.provider.getBalance(contributor1.address);

      const tx = await crowdfunding.connect(contributor1).refund();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const contributorBalanceAfter = await ethers.provider.getBalance(contributor1.address);

      expect(await crowdfunding.contributions(contributor1.address)).to.equal(0);
      expect(contributorBalanceAfter).to.equal(contributorBalanceBefore + contribution - gasUsed);
    });

    it("Should reject refunds before deadline", async function () {
      await expect(crowdfunding.connect(contributor1).refund())
        .to.be.revertedWith("too early");
    });

    it("Should reject refunds if goal is met", async function () {
      await crowdfunding.connect(contributor1).contribute({ value: goal });

      await ethers.provider.send("evm_increaseTime", [duration + 1]);
      await ethers.provider.send("evm_mine");

      await expect(crowdfunding.connect(contributor1).refund())
        .to.be.revertedWith("goal met");
    });

    it("Should reject refunds for non-contributors", async function () {
      await ethers.provider.send("evm_increaseTime", [duration + 1]);
      await ethers.provider.send("evm_mine");

      await expect(crowdfunding.connect(contributor2).refund())
        .to.be.revertedWith("nothing to refund");
    });
  });
});