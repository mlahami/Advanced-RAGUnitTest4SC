const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InsurancePool", function () {
  let InsurancePool;
  let insurancePool;
  let owner;
  let lp1;
  let lp2;
  let policyholder1;
  let policyholder2;

  beforeEach(async function () {
    [owner, lp1, lp2, policyholder1, policyholder2] = await ethers.getSigners();

    InsurancePool = await ethers.getContractFactory("InsurancePool");
    insurancePool = await InsurancePool.deploy();
    await insurancePool.waitForDeployment();
  });

  describe("LP Actions", function () {
    it("Should allow ETH deposit", async function () {
      const depositAmount = ethers.parseEther("1");
      await expect(() =>
        insurancePool.connect(lp1).deposit({ value: depositAmount })
      ).to.changeEtherBalances(
        [lp1, await insurancePool.getAddress()],
        [-depositAmount, depositAmount]
      );

      expect(await insurancePool.totalLiquidity()).to.equal(depositAmount);
      expect(await insurancePool.lpPositions(lp1.address)).to.deep.equal([
        depositAmount,
        0n
      ]);

      await expect(insurancePool.connect(lp1).deposit({ value: 0 }))
        .to.be.revertedWith("Zero deposit");
    });

    it("Should allow ETH withdrawal", async function () {
      const depositAmount = ethers.parseEther("2");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      const withdrawAmount = ethers.parseEther("1");
      await expect(() =>
        insurancePool.connect(lp1).withdraw(withdrawAmount)
      ).to.changeEtherBalances(
        [lp1, await insurancePool.getAddress()],
        [withdrawAmount, -withdrawAmount]
      );

      expect(await insurancePool.totalLiquidity()).to.equal(ethers.parseEther("1"));
      expect(await insurancePool.lpPositions(lp1.address)).to.deep.equal([
        ethers.parseEther("1"),
        0n
      ]);

      await expect(insurancePool.connect(lp1).withdraw(ethers.parseEther("2")))
        .to.be.revertedWith("Insufficient deposit");
    });

    it("Should prevent withdrawal when pool is undercollateralized", async function () {
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Create a policy that would make the pool undercollateralized
      const coverage = ethers.parseEther("1.1");
      const duration = 3600; // 1 hour
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: ethers.parseEther("0.1") });

      await expect(insurancePool.connect(lp1).withdraw(depositAmount))
        .to.be.revertedWith("Undercollateralized");
    });

    it("Should allow claiming rewards", async function () {
      // Deposit first
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy to generate rewards
      const coverage = ethers.parseEther("0.5");
      const duration = 3600; // 1 hour
      const premium = ethers.parseEther("0.1");
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Check pending rewards
      const pendingRewards = await insurancePool.pendingRewards(lp1.address);
      expect(pendingRewards).to.be.gt(0);

      // Claim rewards
      await expect(() =>
        insurancePool.connect(lp1).claimRewards()
      ).to.changeEtherBalance(lp1, pendingRewards);

      expect(await insurancePool.pendingRewards(lp1.address)).to.equal(0);
    });

    it("Should prevent claiming zero rewards", async function () {
      await expect(insurancePool.connect(lp1).claimRewards())
        .to.be.revertedWith("No rewards");
    });
  });

  describe("Policy Actions", function () {
    it("Should allow buying a policy", async function () {
      // Deposit liquidity first
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      const coverage = ethers.parseEther("0.5");
      const duration = 3600; // 1 hour
      const premium = ethers.parseEther("0.1");

      await expect(() =>
        insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium })
      ).to.changeEtherBalances(
        [policyholder1, await insurancePool.getAddress()],
        [-premium, premium]
      );

      const policyCount = await insurancePool.policyCount();
      expect(policyCount).to.equal(1);

      const policy = await insurancePool.policies(0);
      expect(policy.holder).to.equal(policyholder1.address);
      expect(policy.coverage).to.equal(coverage);
      expect(policy.premium).to.equal(premium);
      expect(policy.active).to.be.true;
      expect(policy.claimed).to.be.false;
    });

    it("Should prevent buying policy with zero coverage", async function () {
      await expect(insurancePool.connect(policyholder1).buyPolicy(0, 3600, { value: ethers.parseEther("0.1") }))
        .to.be.revertedWith("Zero coverage");
    });

    it("Should prevent buying policy with insufficient pool liquidity", async function () {
      // Deposit less than required coverage
      const depositAmount = ethers.parseEther("0.4");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      const coverage = ethers.parseEther("0.5");
      const duration = 3600; // 1 hour
      const premium = ethers.parseEther("0.1");

      await expect(insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium }))
        .to.be.revertedWith("Insufficient pool");
    });

    it("Should prevent buying policy with zero premium", async function () {
      await expect(insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 3600, { value: 0 }))
        .to.be.revertedWith("No premium");
    });
  });

  describe("Oracle Actions", function () {
    it("Should allow owner to trigger claim", async function () {
      // Deposit liquidity first
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy
      const coverage = ethers.parseEther("0.5");
      const duration = 3600; // 1 hour
      const premium = ethers.parseEther("0.1");
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Trigger claim
      await expect(() =>
        insurancePool.connect(owner).triggerClaim(0)
      ).to.changeEtherBalance(policyholder1, coverage);

      const policy = await insurancePool.policies(0);
      expect(policy.claimed).to.be.true;
      expect(policy.active).to.be.false;
      expect(await insurancePool.totalCoverage()).to.equal(0);
      expect(await insurancePool.totalLiquidity()).to.equal(ethers.parseEther("0.6")); // 1 - 0.5 coverage + 0.1 premium
    });

    it("Should prevent non-owner from triggering claim", async function () {
      await expect(insurancePool.connect(lp1).triggerClaim(0))
        .to.be.revertedWith("Not owner");
    });

    it("Should prevent claiming inactive or already claimed policy", async function () {
      // Deposit liquidity first
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy
      const coverage = ethers.parseEther("0.5");
      const duration = 3600; // 1 hour
      const premium = ethers.parseEther("0.1");
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Trigger claim first
      await insurancePool.connect(owner).triggerClaim(0);

      // Try to claim again
      await expect(insurancePool.connect(owner).triggerClaim(0))
        .to.be.revertedWith("Not claimable");
    });

    it("Should prevent claiming expired policy", async function () {
      // Deposit liquidity first
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy with short duration
      const coverage = ethers.parseEther("0.5");
      const duration = 1; // 1 second
      const premium = ethers.parseEther("0.1");
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Wait for policy to expire
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");

      // Try to claim
      await expect(insurancePool.connect(owner).triggerClaim(0))
        .to.be.revertedWith("Policy expired");
    });

    it("Should allow expiring a policy", async function () {
      // Deposit liquidity first
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy with short duration
      const coverage = ethers.parseEther("0.5");
      const duration = 1; // 1 second
      const premium = ethers.parseEther("0.1");
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Wait for policy to expire
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");

      // Expire the policy
      await insurancePool.connect(policyholder1).expirePolicy(0);

      const policy = await insurancePool.policies(0);
      expect(policy.active).to.be.false;
      expect(await insurancePool.totalCoverage()).to.equal(0);
    });

    it("Should prevent expiring active or already claimed policy", async function () {
      // Deposit liquidity first
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy
      const coverage = ethers.parseEther("0.5");
      const duration = 3600; // 1 hour
      const premium = ethers.parseEther("0.1");
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Try to expire active policy
      await expect(insurancePool.connect(policyholder1).expirePolicy(0))
        .to.be.revertedWith("Not expired");

      // Trigger claim
      await insurancePool.connect(owner).triggerClaim(0);

      // Try to expire already claimed policy
      await expect(insurancePool.connect(policyholder1).expirePolicy(0))
        .to.be.revertedWith("Not active");
    });

    it("Should prevent expiring non-expired policy", async function () {
      // Deposit liquidity first
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy
      const coverage = ethers.parseEther("0.5");
      const duration = 3600; // 1 hour
      const premium = ethers.parseEther("0.1");
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Try to expire before expiration
      await expect(insurancePool.connect(policyholder1).expirePolicy(0))
        .to.be.revertedWith("Not expired");
    });
  });

  describe("Reward Distribution", function () {
    it("Should correctly distribute rewards to multiple LPs", async function () {
      // Deposit from two LPs
      const depositAmount1 = ethers.parseEther("1");
      const depositAmount2 = ethers.parseEther("2");
      await insurancePool.connect(lp1).deposit({ value: depositAmount1 });
      await insurancePool.connect(lp2).deposit({ value: depositAmount2 });

      // Buy a policy
      const coverage = ethers.parseEther("0.5");
      const duration = 3600; // 1 hour
      const premium = ethers.parseEther("0.1");
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Check pending rewards
      const pendingRewards1 = await insurancePool.pendingRewards(lp1.address);
      const pendingRewards2 = await insurancePool.pendingRewards(lp2.address);

      // The rewards should be proportional to the deposit amounts
      const totalDeposits = depositAmount1 + depositAmount2;
      const expectedRewards1 = (premium * depositAmount1) / totalDeposits;
      const expectedRewards2 = (premium * depositAmount2) / totalDeposits;

      expect(pendingRewards1).to.equal(expectedRewards1);
      expect(pendingRewards2).to.equal(expectedRewards2);
    });

    it("Should update rewards when new deposits are made", async function () {
      // Initial deposit
      const depositAmount1 = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount1 });

      // Buy a policy
      const coverage = ethers.parseEther("0.5");
      const duration = 3600; // 1 hour
      const premium = ethers.parseEther("0.1");
      await insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium });

      // Second deposit
      const depositAmount2 = ethers.parseEther("1");
      await insurancePool.connect(lp2).deposit({ value: depositAmount2 });

      // Check pending rewards
      const pendingRewards1 = await insurancePool.pendingRewards(lp1.address);
      const pendingRewards2 = await insurancePool.pendingRewards(lp2.address);

      // The first LP should have rewards from the initial policy
      expect(pendingRewards1).to.be.gt(0);
      // The second LP should have zero rewards since they just deposited
      expect(pendingRewards2).to.equal(0);
    });
  });
});