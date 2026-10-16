const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InsurancePool", function () {
  let insurancePool;
  let owner, lp1, lp2, policyholder1, policyholder2;
  const COVERAGE = ethers.parseEther("100");
  const PREMIUM = ethers.parseEther("10");
  const DURATION = 3600n; // 1 hour

  beforeEach(async function () {
    [owner, lp1, lp2, policyholder1, policyholder2] = await ethers.getSigners();

    const InsurancePool = await ethers.getContractFactory("InsurancePool");
    insurancePool = await InsurancePool.deploy();
    await insurancePool.waitForDeployment();
  });

  describe("LP Actions", function () {
    it("should allow depositing ETH", async function () {
      const depositAmount = ethers.parseEther("100");
      await expect(insurancePool.connect(lp1).deposit({ value: depositAmount }))
        .to.emit(insurancePool, "Deposited")
        .withArgs(lp1.address, depositAmount);

      const lpPosition = await insurancePool.lpPositions(lp1.address);
      expect(lpPosition.deposited).to.equal(depositAmount);
      expect(await insurancePool.totalLiquidity()).to.equal(depositAmount);
    });

    it("should revert on zero deposit", async function () {
      await expect(insurancePool.connect(lp1).deposit({ value: 0 }))
        .to.be.revertedWith("Zero deposit");
    });

    it("should allow withdrawing ETH", async function () {
      const depositAmount = ethers.parseEther("100");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      const withdrawAmount = ethers.parseEther("50");
      await expect(insurancePool.connect(lp1).withdraw(withdrawAmount))
        .to.emit(insurancePool, "Withdrawn")
        .withArgs(lp1.address, withdrawAmount);

      const lpPosition = await insurancePool.lpPositions(lp1.address);
      expect(lpPosition.deposited).to.equal(depositAmount - withdrawAmount);
      expect(await insurancePool.totalLiquidity()).to.equal(depositAmount - withdrawAmount);
    });

    it("should revert on insufficient deposit", async function () {
      const depositAmount = ethers.parseEther("100");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      await expect(insurancePool.connect(lp1).withdraw(depositAmount + 1n))
        .to.be.revertedWith("Insufficient deposit");
    });

    it("should revert on undercollateralized withdrawal", async function () {
      const depositAmount = ethers.parseEther("100");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Create a policy that would make the pool undercollateralized
      await insurancePool.connect(policyholder1).buyPolicy(COVERAGE, DURATION, { value: PREMIUM });

      await expect(insurancePool.connect(lp1).withdraw(depositAmount))
        .to.be.revertedWith("Undercollateralized");
    });

    it("should allow claiming rewards", async function () {
      // Deposit for LP
      const depositAmount = ethers.parseEther("100");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy policy to generate rewards
      await insurancePool.connect(policyholder1).buyPolicy(COVERAGE, DURATION, { value: PREMIUM });

      // Claim rewards
      const pendingRewardsBefore = await insurancePool.pendingRewards(lp1.address);
      await expect(insurancePool.connect(lp1).claimRewards())
        .to.emit(insurancePool, "Withdrawn")
        .withArgs(lp1.address, pendingRewardsBefore);

      expect(await insurancePool.pendingRewards(lp1.address)).to.equal(0n);
    });

    it("should revert on claiming zero rewards", async function () {
      await expect(insurancePool.connect(lp1).claimRewards())
        .to.be.revertedWith("No rewards");
    });
  });

  describe("Policy Actions", function () {
    it("should allow buying a policy", async function () {
      // Deposit for LP
      const depositAmount = ethers.parseEther("100");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy policy
      await expect(insurancePool.connect(policyholder1).buyPolicy(COVERAGE, DURATION, { value: PREMIUM }))
        .to.emit(insurancePool, "PolicyPurchased")
        .withArgs(0n, policyholder1.address, COVERAGE, PREMIUM, await ethers.provider.getBlock("latest")).then(b => b.timestamp + DURATION);

      const policyCount = await insurancePool.policyCount();
      expect(policyCount).to.equal(1n);

      const policy = await insurancePool.policies(0);
      expect(policy.holder).to.equal(policyholder1.address);
      expect(policy.coverage).to.equal(COVERAGE);
      expect(policy.premium).to.equal(PREMIUM);
      expect(policy.active).to.be.true;
      expect(policy.claimed).to.be.false;

      expect(await insurancePool.totalCoverage()).to.equal(COVERAGE);
    });

    it("should revert on zero coverage", async function () {
      await expect(insurancePool.connect(policyholder1).buyPolicy(0n, DURATION, { value: PREMIUM }))
        .to.be.revertedWith("Zero coverage");
    });

    it("should revert on insufficient pool liquidity", async function () {
      // Deposit less than coverage
      const depositAmount = COVERAGE - 1n;
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      await expect(insurancePool.connect(policyholder1).buyPolicy(COVERAGE, DURATION, { value: PREMIUM }))
        .to.be.revertedWith("Insufficient pool");
    });

    it("should revert on zero premium", async function () {
      await expect(insurancePool.connect(policyholder1).buyPolicy(COVERAGE, DURATION, { value: 0n }))
        .to.be.revertedWith("No premium");
    });
  });

  describe("Oracle Actions", function () {
    it("should allow owner to trigger claim", async function () {
      // Deposit for LP
      const depositAmount = ethers.parseEther("100");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy policy
      await insurancePool.connect(policyholder1).buyPolicy(COVERAGE, DURATION, { value: PREMIUM });

      // Trigger claim
      await expect(insurancePool.connect(owner).triggerClaim(0n))
        .to.emit(insurancePool, "Claimed")
        .withArgs(0n, policyholder1.address, COVERAGE);

      const policy = await insurancePool.policies(0);
      expect(policy.claimed).to.be.true;
      expect(policy.active).to.be.false;
      expect(await insurancePool.totalCoverage()).to.equal(0n);
      expect(await insurancePool.totalLiquidity()).to.equal(depositAmount - COVERAGE);
    });

    it("should revert on non-owner triggering claim", async function () {
      await expect(insurancePool.connect(lp1).triggerClaim(0n))
        .to.be.revertedWith("Not owner");
    });

    it("should revert on claiming non-claimable policy", async function () {
      await expect(insurancePool.connect(owner).triggerClaim(0n))
        .to.be.revertedWith("Not claimable");
    });

    it("should revert on expired policy", async function () {
      // Deposit for LP
      const depositAmount = ethers.parseEther("100");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy policy with short duration
      await insurancePool.connect(policyholder1).buyPolicy(COVERAGE, 1n, { value: PREMIUM });

      // Wait for policy to expire
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");

      await expect(insurancePool.connect(owner).triggerClaim(0n))
        .to.be.revertedWith("Policy expired");
    });

    it("should allow expiring a policy", async function () {
      // Deposit for LP
      const depositAmount = ethers.parseEther("100");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy policy with short duration
      await insurancePool.connect(policyholder1).buyPolicy(COVERAGE, 1n, { value: PREMIUM });

      // Wait for policy to expire
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");

      // Expire policy
      await expect(insurancePool.connect(policyholder1).expirePolicy(0n))
        .to.emit(insurancePool, "PolicyExpired")
        .withArgs(0n);

      const policy = await insurancePool.policies(0);
      expect(policy.active).to.be.false;
      expect(await insurancePool.totalCoverage()).to.equal(0n);
    });

    it("should revert on expiring non-active policy", async function () {
      await expect(insurancePool.connect(policyholder1).expirePolicy(0n))
        .to.be.revertedWith("Not active");
    });

    it("should revert on expiring non-expired policy", async function () {
      // Deposit for LP
      const depositAmount = ethers.parseEther("100");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy policy
      await insurancePool.connect(policyholder1).buyPolicy(COVERAGE, DURATION, { value: PREMIUM });

      await expect(insurancePool.connect(policyholder1).expirePolicy(0n))
        .to.be.revertedWith("Not expired");
    });
  });

  describe("Reward Distribution", function () {
    it("should correctly distribute rewards to LPs", async function () {
      // Deposit for LPs
      const depositAmount1 = ethers.parseEther("100");
      const depositAmount2 = ethers.parseEther("200");
      await insurancePool.connect(lp1).deposit({ value: depositAmount1 });
      await insurancePool.connect(lp2).deposit({ value: depositAmount2 });

      // Buy policies to generate rewards
      await insurancePool.connect(policyholder1).buyPolicy(COVERAGE, DURATION, { value: PREMIUM });
      await insurancePool.connect(policyholder2).buyPolicy(COVERAGE, DURATION, { value: PREMIUM });

      // Check pending rewards
      const pendingRewards1 = await insurancePool.pendingRewards(lp1.address);
      const pendingRewards2 = await insurancePool.pendingRewards(lp2.address);

      // The rewards should be proportional to the deposit amounts
      const totalDeposit = depositAmount1 + depositAmount2;
      const totalPremium = PREMIUM * 2n;
      const expectedReward1 = (totalPremium * depositAmount1) / totalDeposit;
      const expectedReward2 = (totalPremium * depositAmount2) / totalDeposit;

      // Allow small rounding differences
      expect(pendingRewards1).to.be.closeTo(expectedReward1, 1n);
      expect(pendingRewards2).to.be.closeTo(expectedReward2, 1n);
    });

    it("should update rewards on deposit", async function () {
      // Deposit for LP
      const depositAmount = ethers.parseEther("100");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy policy to generate rewards
      await insurancePool.connect(policyholder1).buyPolicy(COVERAGE, DURATION, { value: PREMIUM });

      // Deposit again to update rewards
      const additionalDeposit = ethers.parseEther("50");
      await insurancePool.connect(lp1).deposit({ value: additionalDeposit });

      // Check pending rewards
      const pendingRewards = await insurancePool.pendingRewards(lp1.address);
      expect(pendingRewards).to.be.gt(0n);
    });

    it("should update rewards on withdraw", async function () {
      // Deposit for LP
      const depositAmount = ethers.parseEther("100");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy policy to generate rewards
      await insurancePool.connect(policyholder1).buyPolicy(COVERAGE, DURATION, { value: PREMIUM });

      // Withdraw to update rewards
      const withdrawAmount = ethers.parseEther("50");
      await insurancePool.connect(lp1).withdraw(withdrawAmount);

      // Check pending rewards
      const pendingRewards = await insurancePool.pendingRewards(lp1.address);
      expect(pendingRewards).to.be.gt(0n);
    });
  });
});