const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Crowdfunding", function () {
  let crowdfunding;
  let creator;
  let contributor1;
  let contributor2;
  const goal = ethers.parseEther("100");
  const duration = 7 * 24 * 60 * 60; // 7 days in seconds

  beforeEach(async function () {
    [creator, contributor1, contributor2] = await ethers.getSigners();

    const Crowdfunding = await ethers.getContractFactory("Crowdfunding");
    crowdfunding = await Crowdfunding.deploy(goal, duration);
    await crowdfunding.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct creator", async function () {
      expect(await crowdfunding.creator()).to.equal(creator.address);
    });

    it("Should set the correct goal", async function () {
      expect(await crowdfunding.goal()).to.equal(goal);
    });

    it("Should set the correct deadline", async function () {
      const blockTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
      expect(await crowdfunding.deadline()).to.equal(blockTimestamp + duration);
    });
  });

  describe("Contribute", function () {
    it("Should allow contributions before deadline", async function () {
      const contribution = ethers.parseEther("10");
      await expect(crowdfunding.connect(contributor1).contribute({ value: contribution }))
        .to.emit(crowdfunding, "Contribution")
        .withArgs(contributor1.address, contribution);

      expect(await crowdfunding.contributions(contributor1.address)).to.equal(contribution);
      expect(await crowdfunding.totalRaised()).to.equal(contribution);
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
  });

  describe("Withdraw", function () {
    it("Should allow creator to withdraw when goal is met and deadline passed", async function () {
      const contribution = ethers.parseEther("100");
      await crowdfunding.connect(contributor1).contribute({ value: contribution });

      await ethers.provider.send("evm_increaseTime", [duration + 1]);
      await ethers.provider.send("evm_mine");

      const contractAddress = await crowdfunding.getAddress();
      const initialBalance = await ethers.provider.getBalance(creator.address);

      const tx = await crowdfunding.connect(creator).withdraw();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalBalance = await ethers.provider.getBalance(creator.address);
      expect(finalBalance).to.equal(initialBalance + contribution - gasUsed);
    });

    it("Should reject withdrawals before deadline", async function () {
      await expect(crowdfunding.connect(creator).withdraw())
        .to.be.revertedWith("too early");
    });

    it("Should reject withdrawals when goal is not met", async function () {
      const contribution = ethers.parseEther("50");
      await crowdfunding.connect(contributor1).contribute({ value: contribution });

      await ethers.provider.send("evm_increaseTime", [duration + 1]);
      await ethers.provider.send("evm_mine");

      await expect(crowdfunding.connect(creator).withdraw())
        .to.be.revertedWith("goal not met");
    });

    it("Should reject withdrawals from non-creator", async function () {
      await expect(crowdfunding.connect(contributor1).withdraw())
        .to.be.revertedWith("not creator");
    });
  });

  describe("Refund", function () {
    it("Should allow refunds when goal is not met and deadline passed", async function () {
      const contribution = ethers.parseEther("50");
      await crowdfunding.connect(contributor1).contribute({ value: contribution });

      await ethers.provider.send("evm_increaseTime", [duration + 1]);
      await ethers.provider.send("evm_mine");

      const initialBalance = await ethers.provider.getBalance(contributor1.address);

      const tx = await crowdfunding.connect(contributor1).refund();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalBalance = await ethers.provider.getBalance(contributor1.address);
      expect(finalBalance).to.equal(initialBalance + contribution - gasUsed);
      expect(await crowdfunding.contributions(contributor1.address)).to.equal(0);
    });

    it("Should reject refunds before deadline", async function () {
      await expect(crowdfunding.connect(contributor1).refund())
        .to.be.revertedWith("too early");
    });

    it("Should reject refunds when goal is met", async function () {
      const contribution = ethers.parseEther("100");
      await crowdfunding.connect(contributor1).contribute({ value: contribution });

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