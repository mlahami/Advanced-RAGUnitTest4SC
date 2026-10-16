const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InsurancePool", function () {
  let InsurancePool, insurancePool, owner, lp1, lp2, policyholder1, policyholder2;

  beforeEach(async function () {
    [owner, lp1, lp2, policyholder1, policyholder2] = await ethers.getSigners();

    InsurancePool = await ethers.getContractFactory("InsurancePool");
    insurancePool = await InsurancePool.deploy();
    await insurancePool.waitForDeployment();
  });

  describe("LP Actions", function () {
    it("Should allow ETH deposit", async function () {
      const depositAmount = ethers.parseEther("1");
      await expect(insurancePool.connect(lp1).deposit({ value: depositAmount }))
        .to.emit(insurancePool, "Deposited")
        .withArgs(lp1.address, depositAmount);

      const lpPosition = await insurancePool.lpPositions(lp1.address);
      expect(lpPosition.deposited).to.equal(depositAmount);
      expect(await insurancePool.totalLiquidity()).to.equal(depositAmount);
    });

    it("Should reject zero deposit", async function () {
      await expect(insurancePool.connect(lp1).deposit({ value: 0 }))
        .to.be.revertedWith("Zero deposit");
    });

    it("Should allow ETH withdrawal", async function () {
      const depositAmount = ethers.parseEther("2");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      const withdrawAmount = ethers.parseEther("1");
      await expect(insurancePool.connect(lp1).withdraw(withdrawAmount))
        .to.emit(insurancePool, "Withdrawn")
        .withArgs(lp1.address, withdrawAmount);

      const lpPosition = await insurancePool.lpPositions(lp1.address);
      expect(lpPosition.deposited).to.equal(ethers.parseEther("1"));
      expect(await insurancePool.totalLiquidity()).to.equal(ethers.parseEther("1"));
    });

    it("Should reject insufficient deposit", async function () {
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      await expect(insurancePool.connect(lp1).withdraw(ethers.parseEther("2")))
        .to.be.revertedWith("Insufficient deposit");
    });

    it("Should reject undercollateralized withdrawal", async function () {
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      await insurancePool.connect(policyholder1).buyPolicy(coverage, 3600, { value: premium });

      await expect(insurancePool.connect(lp1).withdraw(depositAmount))
        .to.be.revertedWith("Undercollateralized");
    });

    it("Should allow claiming rewards", async function () {
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      await insurancePool.connect(policyholder1).buyPolicy(coverage, 3600, { value: premium });

      const initialBalance = await ethers.provider.getBalance(lp1.address);
      const tx = await insurancePool.connect(lp1).claimRewards();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const finalBalance = await ethers.provider.getBalance(lp1.address);

      expect(finalBalance).to.be.gt(initialBalance - gasUsed);
      expect(await insurancePool.pendingRewards(lp1.address)).to.equal(0);
    });

    it("Should reject claiming zero rewards", async function () {
      await expect(insurancePool.connect(lp1).claimRewards())
        .to.be.revertedWith("No rewards");
    });
  });

  describe("Policy Actions", function () {
    it("Should allow buying a policy", async function () {
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 3600;

      await expect(insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium }))
        .to.emit(insurancePool, "PolicyPurchased")
        .withArgs(0, policyholder1.address, coverage, premium, await ethers.provider.getBlock("latest").timestamp + duration);

      const policy = await insurancePool.policies(0);
      expect(policy.holder).to.equal(policyholder1.address);
      expect(policy.coverage).to.equal(coverage);
      expect(policy.premium).to.equal(premium);
      expect(policy.active).to.be.true;
      expect(policy.claimed).to.be.false;
      expect(await insurancePool.totalCoverage()).to.equal(coverage);
    });

    it("Should reject zero coverage policy", async function () {
      await expect(insurancePool.connect(policyholder1).buyPolicy(0, 3600, { value: ethers.parseEther("0.1") }))
        .to.be.revertedWith("Zero coverage");
    });

    it("Should reject insufficient pool liquidity", async function () {
      const coverage = ethers.parseEther("1");
      const premium = ethers.parseEther("0.1");

      await expect(insurancePool.connect(policyholder1).buyPolicy(coverage, 3600, { value: premium }))
        .to.be.revertedWith("Insufficient pool");
    });

    it("Should reject zero premium", async function () {
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      await expect(insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 3600, { value: 0 }))
        .to.be.revertedWith("No premium");
    });
  });

  describe("Oracle Actions", function () {
    it("Should allow owner to trigger claim", async function () {
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 3600;
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      const initialBalance = await ethers.provider.getBalance(policyholder1.address);
      const tx = await insurancePool.connect(owner).triggerClaim(0);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const finalBalance = await ethers.provider.getBalance(policyholder1.address);

      expect(finalBalance).to.be.gt(initialBalance - gasUsed);
      expect(await insurancePool.totalCoverage()).to.equal(0);
      expect(await insurancePool.totalLiquidity()).to.equal(ethers.parseEther("0.5"));

      const policy = await insurancePool.policies(0);
      expect(policy.claimed).to.be.true;
      expect(policy.active).to.be.false;
    });

    it("Should reject non-owner claim trigger", async function () {
      await expect(insurancePool.connect(lp1).triggerClaim(0))
        .to.be.revertedWith("Not owner");
    });

    it("Should reject claim on non-claimable policy", async function () {
      await expect(insurancePool.connect(owner).triggerClaim(0))
        .to.be.revertedWith("Not claimable");
    });

    it("Should allow expiring a policy", async function () {
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 1; // 1 second
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Wait for policy to expire
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");

      await expect(insurancePool.connect(policyholder1).expirePolicy(0))
        .to.emit(insurancePool, "PolicyExpired")
        .withArgs(0);

      const policy = await insurancePool.policies(0);
      expect(policy.active).to.be.false;
      expect(await insurancePool.totalCoverage()).to.equal(0);
    });

    it("Should reject expiring an active policy", async function () {
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 3600;
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      await expect(insurancePool.connect(policyholder1).expirePolicy(0))
        .to.be.revertedWith("Not expired");
    });
  });

  describe("State Management", function () {
    it("Should correctly track multiple policies and LPs", async function () {
      // LP1 deposits
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // LP2 deposits
      await insurancePool.connect(lp2).deposit({ value: ethers.parseEther("2") });

      // Policyholder1 buys policy
      await insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 3600, { value: ethers.parseEther("0.1") });

      // Policyholder2 buys policy
      await insurancePool.connect(policyholder2).buyPolicy(ethers.parseEther("1"), 3600, { value: ethers.parseEther("0.2") });

      // Check state
      expect(await insurancePool.totalLiquidity()).to.equal(ethers.parseEther("3"));
      expect(await insurancePool.totalCoverage()).to.equal(ethers.parseEther("1.5"));
      expect(await insurancePool.policyCount()).to.equal(2);

      // LP1 claims rewards
      await insurancePool.connect(lp1).claimRewards();

      // LP2 claims rewards
      await insurancePool.connect(lp2).claimRewards();

      // Check pending rewards are zero
      expect(await insurancePool.pendingRewards(lp1.address)).to.equal(0);
      expect(await insurancePool.pendingRewards(lp2.address)).to.equal(0);
    });
  });
});