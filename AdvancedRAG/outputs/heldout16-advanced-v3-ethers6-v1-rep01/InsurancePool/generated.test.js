const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InsurancePool", function () {
  let insurancePool;
  let owner, lp1, lp2, policyholder1, policyholder2;
  const COVERAGE = ethers.parseEther("1");
  const PREMIUM = ethers.parseEther("0.1");
  const DURATION = 3600; // 1 hour

  beforeEach(async function () {
    [owner, lp1, lp2, policyholder1, policyholder2] = await ethers.getSigners();

    const InsurancePool = await ethers.getContractFactory("InsurancePool");
    insurancePool = await InsurancePool.deploy();
    await insurancePool.waitForDeployment();

    // Deposit initial liquidity
    await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("10") });
    await insurancePool.connect(lp2).deposit({ value: ethers.parseEther("5") });
  });

  describe("LP Actions", function () {
    it("should allow ETH deposits", async function () {
      const depositAmount = ethers.parseEther("1");
      await expect(() =>
        insurancePool.connect(lp1).deposit({ value: depositAmount })
      ).to.changeEtherBalances(
        [lp1, await insurancePool.getAddress()],
        [-depositAmount, depositAmount]
      );

      const lpPosition = await insurancePool.lpPositions(lp1.address);
      expect(lpPosition.deposited).to.equal(ethers.parseEther("11")); // 10 initial + 1 new
      expect(await insurancePool.totalLiquidity()).to.equal(ethers.parseEther("16")); // 10 + 5 + 1
    });

    it("should emit Deposited event on deposit", async function () {
      const depositAmount = ethers.parseEther("1");
      await expect(insurancePool.connect(lp1).deposit({ value: depositAmount }))
        .to.emit(insurancePool, "Deposited")
        .withArgs(lp1.address, depositAmount);
    });

    it("should revert on zero deposit", async function () {
      await expect(insurancePool.connect(lp1).deposit({ value: 0 }))
        .to.be.revertedWith("Zero deposit");
    });

    it("should allow ETH withdrawals", async function () {
      const withdrawAmount = ethers.parseEther("1");
      await expect(() =>
        insurancePool.connect(lp1).withdraw(withdrawAmount)
      ).to.changeEtherBalances(
        [lp1, await insurancePool.getAddress()],
        [withdrawAmount, -withdrawAmount]
      );

      const lpPosition = await insurancePool.lpPositions(lp1.address);
      expect(lpPosition.deposited).to.equal(ethers.parseEther("9")); // 10 - 1
      expect(await insurancePool.totalLiquidity()).to.equal(ethers.parseEther("14")); // 15 - 1
    });

    it("should emit Withdrawn event on withdrawal", async function () {
      const withdrawAmount = ethers.parseEther("1");
      await expect(insurancePool.connect(lp1).withdraw(withdrawAmount))
        .to.emit(insurancePool, "Withdrawn")
        .withArgs(lp1.address, withdrawAmount);
    });

    it("should revert on insufficient deposit", async function () {
      const withdrawAmount = ethers.parseEther("11");
      await expect(insurancePool.connect(lp1).withdraw(withdrawAmount))
        .to.be.revertedWith("Insufficient deposit");
    });

    it("should revert on undercollateralized pool", async function () {
      // Create a policy that would make the pool undercollateralized
      await insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("15"), DURATION, { value: PREMIUM });

      // Try to withdraw from lp1 (should fail because pool is undercollateralized)
      await expect(insurancePool.connect(lp1).withdraw(ethers.parseEther("1")))
        .to.be.revertedWith("Undercollateralized");
    });

    it("should allow claiming rewards", async function () {
      // Buy a policy to generate rewards
      await insurancePool.connect(policyholder1).buyPolicy(COVERAGE, DURATION, { value: PREMIUM });

      // Claim rewards
      const pendingRewardsBefore = await insurancePool.pendingRewards(lp1.address);
      await expect(() =>
        insurancePool.connect(lp1).claimRewards()
      ).to.changeEtherBalances(
        [lp1, await insurancePool.getAddress()],
        [pendingRewardsBefore, -pendingRewardsBefore]
      );

      expect(await insurancePool.pendingRewards(lp1.address)).to.equal(0);
    });

    it("should revert on claiming zero rewards", async function () {
      await expect(insurancePool.connect(lp1).claimRewards())
        .to.be.revertedWith("No rewards");
    });
  });

  describe("Policy Actions", function () {
    it("should allow buying policies", async function () {
      const initialTotalCoverage = await insurancePool.totalCoverage();
      const initialRewardPerShare = await insurancePool.rewardPerShare();

      await expect(() =>
        insurancePool.connect(policyholder1).buyPolicy(COVERAGE, DURATION, { value: PREMIUM })
      ).to.changeEtherBalances(
        [policyholder1, await insurancePool.getAddress()],
        [-PREMIUM, PREMIUM]
      );

      const policyCount = await insurancePool.policyCount();
      expect(policyCount).to.equal(1);

      const policy = await insurancePool.policies(0);
      expect(policy.holder).to.equal(policyholder1.address);
      expect(policy.coverage).to.equal(COVERAGE);
      expect(policy.premium).to.equal(PREMIUM);
      expect(policy.active).to.be.true;
      expect(policy.claimed).to.be.false;

      expect(await insurancePool.totalCoverage()).to.equal(initialTotalCoverage + COVERAGE);
      expect(await insurancePool.rewardPerShare()).to.be.gt(initialRewardPerShare);
    });

    it("should emit PolicyPurchased event on policy purchase", async function () {
      await expect(insurancePool.connect(policyholder1).buyPolicy(COVERAGE, DURATION, { value: PREMIUM }))
        .to.emit(insurancePool, "PolicyPurchased")
        .withArgs(0, policyholder1.address, COVERAGE, PREMIUM, await ethers.provider.getBlock("latest").then(b => b.timestamp + DURATION));
    });

    it("should revert on zero coverage", async function () {
      await expect(insurancePool.connect(policyholder1).buyPolicy(0, DURATION, { value: PREMIUM }))
        .to.be.revertedWith("Zero coverage");
    });

    it("should revert on insufficient pool liquidity", async function () {
      // Try to buy a policy with coverage exceeding total liquidity
      await expect(insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("20"), DURATION, { value: PREMIUM }))
        .to.be.revertedWith("Insufficient pool");
    });

    it("should revert on zero premium", async function () {
      await expect(insurancePool.connect(policyholder1).buyPolicy(COVERAGE, DURATION, { value: 0 }))
        .to.be.revertedWith("No premium");
    });
  });

  describe("Oracle-triggered Payouts", function () {
    let policyId;

    beforeEach(async function () {
      // Buy a policy
      const tx = await insurancePool.connect(policyholder1).buyPolicy(COVERAGE, DURATION, { value: PREMIUM });
      const receipt = await tx.wait();
      policyId = 0; // First policy
    });

    it("should allow owner to trigger claim", async function () {
      const initialTotalCoverage = await insurancePool.totalCoverage();
      const initialTotalLiquidity = await insurancePool.totalLiquidity();

      await expect(() =>
        insurancePool.connect(owner).triggerClaim(policyId)
      ).to.changeEtherBalances(
        [policyholder1, await insurancePool.getAddress()],
        [COVERAGE, -COVERAGE]
      );

      const policy = await insurancePool.policies(policyId);
      expect(policy.claimed).to.be.true;
      expect(policy.active).to.be.false;

      expect(await insurancePool.totalCoverage()).to.equal(initialTotalCoverage - COVERAGE);
      expect(await insurancePool.totalLiquidity()).to.equal(initialTotalLiquidity - COVERAGE);
    });

    it("should emit Claimed event on successful claim", async function () {
      await expect(insurancePool.connect(owner).triggerClaim(policyId))
        .to.emit(insurancePool, "Claimed")
        .withArgs(policyId, policyholder1.address, COVERAGE);
    });

    it("should revert on non-owner trying to trigger claim", async function () {
      await expect(insurancePool.connect(lp1).triggerClaim(policyId))
        .to.be.revertedWith("Not owner");
    });

    it("should revert on trying to claim non-claimable policy", async function () {
      // First claim the policy
      await insurancePool.connect(owner).triggerClaim(policyId);

      // Try to claim again
      await expect(insurancePool.connect(owner).triggerClaim(policyId))
        .to.be.revertedWith("Not claimable");
    });

    it("should revert on trying to claim expired policy", async function () {
      // Fast forward time to after policy expiry
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      await expect(insurancePool.connect(owner).triggerClaim(policyId))
        .to.be.revertedWith("Policy expired");
    });

    it("should allow expiring policies", async function () {
      // Fast forward time to after policy expiry
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      const initialTotalCoverage = await insurancePool.totalCoverage();

      await insurancePool.connect(policyholder1).expirePolicy(policyId);

      const policy = await insurancePool.policies(policyId);
      expect(policy.active).to.be.false;

      expect(await insurancePool.totalCoverage()).to.equal(initialTotalCoverage - COVERAGE);
    });

    it("should emit PolicyExpired event on policy expiration", async function () {
      // Fast forward time to after policy expiry
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine");

      await expect(insurancePool.connect(policyholder1).expirePolicy(policyId))
        .to.emit(insurancePool, "PolicyExpired")
        .withArgs(policyId);
    });

    it("should revert on trying to expire non-active policy", async function () {
      // First claim the policy
      await insurancePool.connect(owner).triggerClaim(policyId);

      // Try to expire it
      await expect(insurancePool.connect(policyholder1).expirePolicy(policyId))
        .to.be.revertedWith("Not active");
    });

    it("should revert on trying to expire non-expired policy", async function () {
      await expect(insurancePool.connect(policyholder1).expirePolicy(policyId))
        .to.be.revertedWith("Not expired");
    });
  });

  describe("Reward Distribution", function () {
    it("should correctly update rewards for LPs", async function () {
      // Deposit for lp1
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy a policy to generate rewards
      await insurancePool.connect(policyholder1).buyPolicy(COVERAGE, DURATION, { value: PREMIUM });

      // Check pending rewards
      const pendingRewards = await insurancePool.pendingRewards(lp1.address);
      expect(pendingRewards).to.be.gt(0);

      // Claim rewards
      await insurancePool.connect(lp1).claimRewards();

      // Check pending rewards after claiming
      expect(await insurancePool.pendingRewards(lp1.address)).to.equal(0);
    });

    it("should distribute rewards proportionally to LPs", async function () {
      // Deposit for lp1 and lp2
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("2") });
      await insurancePool.connect(lp2).deposit({ value: ethers.parseEther("1") });

      // Buy a policy to generate rewards
      await insurancePool.connect(policyholder1).buyPolicy(COVERAGE, DURATION, { value: PREMIUM });

      // Claim rewards for both LPs
      const pendingRewardsLp1 = await insurancePool.pendingRewards(lp1.address);
      const pendingRewardsLp2 = await insurancePool.pendingRewards(lp2.address);

      // The rewards should be distributed in the ratio of their deposits (2:1)
      expect(pendingRewardsLp1).to.be.closeTo(pendingRewardsLp2 * 2n, pendingRewardsLp2 / 100n);
    });
  });
});