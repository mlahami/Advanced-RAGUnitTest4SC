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

      expect(await ethers.provider.getBalance(await insurancePool.getAddress())).to.equal(depositAmount);
      expect(await insurancePool.totalLiquidity()).to.equal(depositAmount);
      expect(await insurancePool.lpPositions(lp1.address)).to.deep.equal([depositAmount, 0n]);
    });

    it("Should revert on zero deposit", async function () {
      await expect(insurancePool.connect(lp1).deposit({ value: 0 }))
        .to.be.revertedWith("Zero deposit");
    });

    it("Should allow ETH withdrawal and emit Withdrawn event", async function () {
      const depositAmount = ethers.parseEther("2");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      const withdrawAmount = ethers.parseEther("1");
      const initialBalance = await ethers.provider.getBalance(lp1.address);

      const tx = await insurancePool.connect(lp1).withdraw(withdrawAmount);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      expect(await ethers.provider.getBalance(await insurancePool.getAddress())).to.equal(withdrawAmount);
      expect(await insurancePool.totalLiquidity()).to.equal(withdrawAmount);
      expect(await insurancePool.lpPositions(lp1.address)).to.deep.equal([withdrawAmount, 0n]);

      const finalBalance = await ethers.provider.getBalance(lp1.address);
      expect(finalBalance).to.equal(initialBalance - gasUsed + withdrawAmount);
    });

    it("Should revert on insufficient deposit", async function () {
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      await expect(insurancePool.connect(lp1).withdraw(ethers.parseEther("2")))
        .to.be.revertedWith("Insufficient deposit");
    });

    it("Should revert on undercollateralized withdrawal", async function () {
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Create a policy that would make the pool undercollateralized
      await insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 3600, { value: ethers.parseEther("0.1") });

      await expect(insurancePool.connect(lp1).withdraw(ethers.parseEther("0.6")))
        .to.be.revertedWith("Undercollateralized");
    });

    it("Should allow claiming rewards", async function () {
      // Deposit ETH
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy a policy to generate rewards
      await insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 3600, { value: ethers.parseEther("0.1") });

      // Claim rewards
      const initialBalance = await ethers.provider.getBalance(lp1.address);
      const tx = await insurancePool.connect(lp1).claimRewards();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalBalance = await ethers.provider.getBalance(lp1.address);
      expect(finalBalance).to.be.gt(initialBalance - gasUsed);
      expect(await insurancePool.pendingRewards(lp1.address)).to.equal(0n);
    });

    it("Should revert on claiming zero rewards", async function () {
      await expect(insurancePool.connect(lp1).claimRewards())
        .to.be.revertedWith("No rewards");
    });
  });

  describe("Policy Actions", function () {
    it("Should allow buying a policy and emit PolicyPurchased event", async function () {
      // Deposit ETH to the pool
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 3600; // 1 hour

      const tx = await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });
      const receipt = await tx.wait();

      const policyId = 0n;
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const expiry = block.timestamp + duration;

      await expect(tx)
        .to.emit(insurancePool, "PolicyPurchased")
        .withArgs(policyId, policyholder1.address, coverage, premium, expiry);

      expect(await insurancePool.policyCount()).to.equal(1n);
      expect(await insurancePool.totalCoverage()).to.equal(coverage);

      const policy = await insurancePool.policies(policyId);
      expect(policy.holder).to.equal(policyholder1.address);
      expect(policy.coverage).to.equal(coverage);
      expect(policy.premium).to.equal(premium);
      expect(policy.expiry).to.equal(expiry);
      expect(policy.active).to.be.true;
      expect(policy.claimed).to.be.false;
    });

    it("Should revert on zero coverage", async function () {
      await expect(insurancePool.connect(policyholder1).buyPolicy(0, 3600, { value: ethers.parseEther("0.1") }))
        .to.be.revertedWith("Zero coverage");
    });

    it("Should revert on insufficient pool liquidity", async function () {
      // Deposit ETH to the pool
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy a policy that would exceed the pool's liquidity
      await expect(insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("2"), 3600, { value: ethers.parseEther("0.1") }))
        .to.be.revertedWith("Insufficient pool");
    });

    it("Should revert on zero premium", async function () {
      await expect(insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 3600, { value: 0 }))
        .to.be.revertedWith("No premium");
    });
  });

  describe("Oracle-triggered Payouts", function () {
    it("Should allow owner to trigger a claim and emit Claimed event", async function () {
      // Deposit ETH to the pool
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy a policy
      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 3600; // 1 hour
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Trigger the claim
      const policyId = 0n;
      const initialBalance = await ethers.provider.getBalance(policyholder1.address);

      const tx = await insurancePool.connect(owner).triggerClaim(policyId);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      await expect(tx)
        .to.emit(insurancePool, "Claimed")
        .withArgs(policyId, policyholder1.address, coverage);

      const finalBalance = await ethers.provider.getBalance(policyholder1.address);
      expect(finalBalance).to.equal(initialBalance - gasUsed + coverage);

      const policy = await insurancePool.policies(policyId);
      expect(policy.claimed).to.be.true;
      expect(policy.active).to.be.false;
      expect(await insurancePool.totalCoverage()).to.equal(0n);
      expect(await insurancePool.totalLiquidity()).to.equal(premium);
    });

    it("Should revert on non-owner trying to trigger claim", async function () {
      // Deposit ETH to the pool
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy a policy
      await insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 3600, { value: ethers.parseEther("0.1") });

      await expect(insurancePool.connect(policyholder1).triggerClaim(0n))
        .to.be.revertedWith("Not owner");
    });

    it("Should revert on trying to claim an already claimed policy", async function () {
      // Deposit ETH to the pool
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy a policy
      await insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 3600, { value: ethers.parseEther("0.1") });

      // Trigger the claim
      await insurancePool.connect(owner).triggerClaim(0n);

      // Try to claim again
      await expect(insurancePool.connect(owner).triggerClaim(0n))
        .to.be.revertedWith("Not claimable");
    });

    it("Should revert on trying to claim an expired policy", async function () {
      // Deposit ETH to the pool
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy a policy with a very short duration
      await insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 1, { value: ethers.parseEther("0.1") });

      // Wait for the policy to expire
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");

      // Try to claim the expired policy
      await expect(insurancePool.connect(owner).triggerClaim(0n))
        .to.be.revertedWith("Policy expired");
    });

    it("Should allow expiring a policy and emit PolicyExpired event", async function () {
      // Deposit ETH to the pool
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy a policy with a very short duration
      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      await insurancePool.connect(policyholder1).buyPolicy(coverage, 1, { value: premium });

      // Wait for the policy to expire
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");

      // Expire the policy
      const policyId = 0n;
      const tx = await insurancePool.connect(policyholder1).expirePolicy(policyId);

      await expect(tx)
        .to.emit(insurancePool, "PolicyExpired")
        .withArgs(policyId);

      const policy = await insurancePool.policies(policyId);
      expect(policy.active).to.be.false;
      expect(await insurancePool.totalCoverage()).to.equal(0n);
    });

    it("Should revert on trying to expire an already claimed policy", async function () {
      // Deposit ETH to the pool
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy a policy
      await insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 3600, { value: ethers.parseEther("0.1") });

      // Trigger the claim
      await insurancePool.connect(owner).triggerClaim(0n);

      // Try to expire the claimed policy
      await expect(insurancePool.connect(policyholder1).expirePolicy(0n))
        .to.be.revertedWith("Not active");
    });

    it("Should revert on trying to expire an active policy that hasn't expired yet", async function () {
      // Deposit ETH to the pool
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy a policy
      await insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 3600, { value: ethers.parseEther("0.1") });

      // Try to expire the active policy
      await expect(insurancePool.connect(policyholder1).expirePolicy(0n))
        .to.be.revertedWith("Not expired");
    });
  });

  describe("Reward Distribution", function () {
    it("Should correctly distribute rewards to LPs", async function () {
      // Deposit ETH from multiple LPs
      const depositAmount1 = ethers.parseEther("1");
      const depositAmount2 = ethers.parseEther("2");
      await insurancePool.connect(lp1).deposit({ value: depositAmount1 });
      await insurancePool.connect(lp2).deposit({ value: depositAmount2 });

      // Buy policies to generate rewards
      const premium1 = ethers.parseEther("0.1");
      const premium2 = ethers.parseEther("0.2");
      await insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 3600, { value: premium1 });
      await insurancePool.connect(policyholder2).buyPolicy(ethers.parseEther("0.3"), 3600, { value: premium2 });

      // Calculate expected rewards
      const totalPremium = premium1 + premium2;
      const totalLiquidity = depositAmount1 + depositAmount2;
      const rewardPerShare = (totalPremium * 10n ** 18n) / totalLiquidity;

      // Update rewards for both LPs
      await insurancePool.connect(lp1).deposit({ value: 0 }); // Just to trigger _updateRewards
      await insurancePool.connect(lp2).deposit({ value: 0 }); // Just to trigger _updateRewards

      // Calculate expected pending rewards
      const expectedReward1 = (depositAmount1 * rewardPerShare) / 10n ** 18n;
      const expectedReward2 = (depositAmount2 * rewardPerShare) / 10n ** 18n;

      // Verify pending rewards
      expect(await insurancePool.pendingRewards(lp1.address)).to.equal(expectedReward1);
      expect(await insurancePool.pendingRewards(lp2.address)).to.equal(expectedReward2);

      // Verify rewardPerShare
      expect(await insurancePool.rewardPerShare()).to.equal(rewardPerShare);
    });

    it("Should handle reward distribution when totalLiquidity is zero", async function () {
      // Buy a policy when there's no liquidity in the pool
      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 3600;

      await expect(insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium }))
        .to.be.revertedWith("Insufficient pool");

      // Verify rewardPerShare remains zero
      expect(await insurancePool.rewardPerShare()).to.equal(0n);
    });
  });
});