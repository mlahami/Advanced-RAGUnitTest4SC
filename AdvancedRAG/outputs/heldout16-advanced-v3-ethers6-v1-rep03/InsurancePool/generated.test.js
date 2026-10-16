const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InsurancePool", function () {
  let insurancePool;
  let owner, lp1, lp2, policyholder1, policyholder2;

  beforeEach(async function () {
    [owner, lp1, lp2, policyholder1, policyholder2] = await ethers.getSigners();

    const InsurancePool = await ethers.getContractFactory("InsurancePool");
    insurancePool = await InsurancePool.deploy();
    await insurancePool.waitForDeployment();
  });

  describe("LP Actions", function () {
    it("Should allow ETH deposit and emit Deposited event", async function () {
      const depositAmount = ethers.parseEther("1");
      await expect(insurancePool.connect(lp1).deposit({ value: depositAmount }))
        .to.emit(insurancePool, "Deposited")
        .withArgs(lp1.address, depositAmount);

      const lpPosition = await insurancePool.lpPositions(lp1.address);
      expect(lpPosition.deposited).to.equal(depositAmount);
      expect(await insurancePool.totalLiquidity()).to.equal(depositAmount);
    });

    it("Should revert on zero deposit", async function () {
      await expect(insurancePool.connect(lp1).deposit({ value: 0 }))
        .to.be.revertedWith("Zero deposit");
    });

    it("Should allow ETH withdrawal and emit Withdrawn event", async function () {
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      const withdrawAmount = ethers.parseEther("0.5");
      await expect(insurancePool.connect(lp1).withdraw(withdrawAmount))
        .to.emit(insurancePool, "Withdrawn")
        .withArgs(lp1.address, withdrawAmount);

      const lpPosition = await insurancePool.lpPositions(lp1.address);
      expect(lpPosition.deposited).to.equal(depositAmount - withdrawAmount);
      expect(await insurancePool.totalLiquidity()).to.equal(depositAmount - withdrawAmount);
    });

    it("Should revert on insufficient deposit", async function () {
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      await expect(insurancePool.connect(lp1).withdraw(ethers.parseEther("1.5")))
        .to.be.revertedWith("Insufficient deposit");
    });

    it("Should revert on undercollateralized withdrawal", async function () {
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Create a policy that would make the pool undercollateralized
      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      await insurancePool.connect(policyholder1).buyPolicy(coverage, 86400, { value: premium });

      await expect(insurancePool.connect(lp1).withdraw(depositAmount))
        .to.be.revertedWith("Undercollateralized");
    });

    it("Should allow claiming rewards", async function () {
      // Deposit ETH
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy to generate rewards
      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      await insurancePool.connect(policyholder1).buyPolicy(coverage, 86400, { value: premium });

      // Claim rewards
      const initialBalance = await ethers.provider.getBalance(lp1.address);
      const tx = await insurancePool.connect(lp1).claimRewards();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const finalBalance = await ethers.provider.getBalance(lp1.address);

      // Check that rewards were transferred
      expect(finalBalance + gasUsed).to.be.gt(initialBalance);

      // Check that pending rewards were reset
      const pendingRewards = await insurancePool.pendingRewards(lp1.address);
      expect(pendingRewards).to.equal(0n);
    });

    it("Should revert on claiming zero rewards", async function () {
      await expect(insurancePool.connect(lp1).claimRewards())
        .to.be.revertedWith("No rewards");
    });
  });

  describe("Policy Actions", function () {
    it("Should allow buying a policy and emit PolicyPurchased event", async function () {
      // Deposit ETH to the pool
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 86400; // 1 day

      await expect(insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium }))
        .to.emit(insurancePool, "PolicyPurchased")
        .withArgs(0n, policyholder1.address, coverage, premium, await ethers.provider.getBlock("latest").then(b => b.timestamp + duration));

      const policy = await insurancePool.policies(0);
      expect(policy.holder).to.equal(policyholder1.address);
      expect(policy.coverage).to.equal(coverage);
      expect(policy.premium).to.equal(premium);
      expect(policy.active).to.be.true;
      expect(policy.claimed).to.be.false;

      expect(await insurancePool.totalCoverage()).to.equal(coverage);
      expect(await insurancePool.policyCount()).to.equal(1n);
    });

    it("Should revert on zero coverage", async function () {
      await expect(insurancePool.connect(policyholder1).buyPolicy(0, 86400, { value: ethers.parseEther("0.1") }))
        .to.be.revertedWith("Zero coverage");
    });

    it("Should revert on insufficient pool liquidity", async function () {
      // Deposit ETH to the pool
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy that would exceed the pool's capacity
      const coverage = ethers.parseEther("1.5");
      const premium = ethers.parseEther("0.1");

      await expect(insurancePool.connect(policyholder1).buyPolicy(coverage, 86400, { value: premium }))
        .to.be.revertedWith("Insufficient pool");
    });

    it("Should revert on zero premium", async function () {
      await expect(insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 86400, { value: 0 }))
        .to.be.revertedWith("No premium");
    });
  });

  describe("Oracle-triggered Payouts", function () {
    it("Should allow owner to trigger claim and emit Claimed event", async function () {
      // Deposit ETH to the pool
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy
      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 86400; // 1 day
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Trigger claim
      const initialBalance = await ethers.provider.getBalance(policyholder1.address);
      await expect(insurancePool.connect(owner).triggerClaim(0))
        .to.emit(insurancePool, "Claimed")
        .withArgs(0n, policyholder1.address, coverage);

      const finalBalance = await ethers.provider.getBalance(policyholder1.address);
      expect(finalBalance).to.be.gt(initialBalance);

      const policy = await insurancePool.policies(0);
      expect(policy.claimed).to.be.true;
      expect(policy.active).to.be.false;

      expect(await insurancePool.totalCoverage()).to.equal(0n);
      expect(await insurancePool.totalLiquidity()).to.equal(depositAmount - coverage);
    });

    it("Should revert on non-owner triggering claim", async function () {
      // Deposit ETH to the pool
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy
      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 86400; // 1 day
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      await expect(insurancePool.connect(policyholder1).triggerClaim(0))
        .to.be.revertedWith("Not owner");
    });

    it("Should revert on non-claimable policy", async function () {
      // Deposit ETH to the pool
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy
      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 86400; // 1 day
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Trigger claim on a non-existent policy
      await expect(insurancePool.connect(owner).triggerClaim(1))
        .to.be.revertedWith("Not claimable");
    });

    it("Should revert on expired policy", async function () {
      // Deposit ETH to the pool
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy with a very short duration
      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 1; // 1 second
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Wait for the policy to expire
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");

      await expect(insurancePool.connect(owner).triggerClaim(0))
        .to.be.revertedWith("Policy expired");
    });

    it("Should allow expiring a policy and emit PolicyExpired event", async function () {
      // Deposit ETH to the pool
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy with a very short duration
      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 1; // 1 second
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Wait for the policy to expire
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");

      await expect(insurancePool.connect(policyholder1).expirePolicy(0))
        .to.emit(insurancePool, "PolicyExpired")
        .withArgs(0n);

      const policy = await insurancePool.policies(0);
      expect(policy.active).to.be.false;

      expect(await insurancePool.totalCoverage()).to.equal(0n);
    });

    it("Should revert on expiring an active policy", async function () {
      // Deposit ETH to the pool
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy
      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 86400; // 1 day
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      await expect(insurancePool.connect(policyholder1).expirePolicy(0))
        .to.be.revertedWith("Not expired");
    });

    it("Should revert on expiring a non-active policy", async function () {
      // Deposit ETH to the pool
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy
      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 86400; // 1 day
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Expire the policy
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine");
      await insurancePool.connect(policyholder1).expirePolicy(0);

      // Try to expire it again
      await expect(insurancePool.connect(policyholder1).expirePolicy(0))
        .to.be.revertedWith("Not active");
    });
  });

  describe("Reward Distribution", function () {
    it("Should correctly distribute rewards to LPs", async function () {
      // Deposit ETH to the pool
      const depositAmount1 = ethers.parseEther("1");
      const depositAmount2 = ethers.parseEther("2");
      await insurancePool.connect(lp1).deposit({ value: depositAmount1 });
      await insurancePool.connect(lp2).deposit({ value: depositAmount2 });

      // Buy a policy
      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 86400; // 1 day
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Check pending rewards
      const pendingRewards1 = await insurancePool.pendingRewards(lp1.address);
      const pendingRewards2 = await insurancePool.pendingRewards(lp2.address);

      // The rewards should be proportional to the deposited amounts
      const totalDeposits = depositAmount1 + depositAmount2;
      const expectedRewards1 = (premium * depositAmount1) / totalDeposits;
      const expectedRewards2 = (premium * depositAmount2) / totalDeposits;

      expect(pendingRewards1).to.equal(expectedRewards1);
      expect(pendingRewards2).to.equal(expectedRewards2);
    });

    it("Should update rewards when withdrawing", async function () {
      // Deposit ETH to the pool
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy
      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 86400; // 1 day
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Withdraw some ETH
      const withdrawAmount = ethers.parseEther("0.5");
      await insurancePool.connect(lp1).withdraw(withdrawAmount);

      // Check pending rewards
      const pendingRewards = await insurancePool.pendingRewards(lp1.address);

      // The rewards should be proportional to the remaining deposited amount
      const expectedRewards = (premium * (depositAmount - withdrawAmount)) / depositAmount;
      expect(pendingRewards).to.equal(expectedRewards);
    });
  });
});