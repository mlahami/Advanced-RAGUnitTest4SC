const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InsurancePool", function () {
  let insurancePool;
  let owner;
  let lp1;
  let lp2;
  let policyholder1;
  let policyholder2;

  beforeEach(async function () {
    [owner, lp1, lp2, policyholder1, policyholder2] = await ethers.getSigners();

    const InsurancePool = await ethers.getContractFactory("InsurancePool");
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

      // Create a policy that would make the pool undercollateralized if withdrawn
      await insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("1"),
        3600,
        { value: ethers.parseEther("0.1") }
      );

      await expect(insurancePool.connect(lp1).withdraw(depositAmount))
        .to.be.revertedWith("Undercollateralized");
    });

    it("Should allow claiming rewards", async function () {
      // Deposit first to establish position
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy a policy to generate rewards
      await insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("0.5"),
        3600,
        { value: ethers.parseEther("0.1") }
      );

      // Withdraw to trigger reward calculation
      await insurancePool.connect(lp1).withdraw(ethers.parseEther("0.1"));

      // Deposit again to accumulate rewards
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("0.1") });

      const pendingRewards = await insurancePool.pendingRewards(lp1.address);
      expect(pendingRewards).to.be.gt(0);

      await expect(() =>
        insurancePool.connect(lp1).claimRewards()
      ).to.changeEtherBalance(lp1, pendingRewards);

      expect(await insurancePool.pendingRewards(lp1.address)).to.equal(0);
    });

    it("Should revert when claiming zero rewards", async function () {
      await expect(insurancePool.connect(lp1).claimRewards())
        .to.be.revertedWith("No rewards");
    });
  });

  describe("Policy Actions", function () {
    it("Should allow buying a policy", async function () {
      // Deposit to provide liquidity
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 3600; // 1 hour

      await expect(() =>
        insurancePool.connect(policyholder1).buyPolicy(
          coverage,
          duration,
          { value: premium }
        )
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

      expect(await insurancePool.totalCoverage()).to.equal(coverage);
    });

    it("Should revert when buying policy with zero coverage", async function () {
      await expect(insurancePool.connect(policyholder1).buyPolicy(
        0,
        3600,
        { value: ethers.parseEther("0.1") }
      )).to.be.revertedWith("Zero coverage");
    });

    it("Should revert when buying policy with insufficient pool liquidity", async function () {
      // Deposit only 0.5 ETH
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("0.5") });

      // Try to buy policy with 0.6 ETH coverage
      await expect(insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("0.6"),
        3600,
        { value: ethers.parseEther("0.1") }
      )).to.be.revertedWith("Insufficient pool");
    });

    it("Should revert when buying policy with zero premium", async function () {
      await expect(insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("0.5"),
        3600,
        { value: 0 }
      )).to.be.revertedWith("No premium");
    });
  });

  describe("Oracle Actions", function () {
    it("Should allow owner to trigger claim", async function () {
      // Deposit to provide liquidity
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy a policy
      const coverage = ethers.parseEther("0.5");
      await insurancePool.connect(policyholder1).buyPolicy(
        coverage,
        3600,
        { value: ethers.parseEther("0.1") }
      );

      // Trigger claim
      await expect(() =>
        insurancePool.connect(owner).triggerClaim(0)
      ).to.changeEtherBalances(
        [policyholder1, await insurancePool.getAddress()],
        [coverage, -coverage]
      );

      const policy = await insurancePool.policies(0);
      expect(policy.claimed).to.be.true;
      expect(policy.active).to.be.false;
      expect(await insurancePool.totalCoverage()).to.equal(0);
    });

    it("Should revert when non-owner tries to trigger claim", async function () {
      await expect(insurancePool.connect(lp1).triggerClaim(0))
        .to.be.revertedWith("Not owner");
    });

    it("Should revert when trying to claim inactive policy", async function () {
      // Deposit to provide liquidity
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy a policy
      await insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("0.5"),
        3600,
        { value: ethers.parseEther("0.1") }
      );

      // Expire the policy
      await ethers.provider.send("evm_increaseTime", [3601]);
      await insurancePool.connect(policyholder1).expirePolicy(0);

      // Try to claim
      await expect(insurancePool.connect(owner).triggerClaim(0))
        .to.be.revertedWith("Not claimable");
    });

    it("Should revert when trying to claim expired policy", async function () {
      // Deposit to provide liquidity
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy a policy
      await insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("0.5"),
        3600,
        { value: ethers.parseEther("0.1") }
      );

      // Expire the policy
      await ethers.provider.send("evm_increaseTime", [3601]);

      // Try to claim
      await expect(insurancePool.connect(owner).triggerClaim(0))
        .to.be.revertedWith("Policy expired");
    });

    it("Should allow expiring a policy", async function () {
      // Deposit to provide liquidity
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy a policy
      const coverage = ethers.parseEther("0.5");
      await insurancePool.connect(policyholder1).buyPolicy(
        coverage,
        3600,
        { value: ethers.parseEther("0.1") }
      );

      // Expire the policy
      await ethers.provider.send("evm_increaseTime", [3601]);
      await insurancePool.connect(policyholder1).expirePolicy(0);

      const policy = await insurancePool.policies(0);
      expect(policy.active).to.be.false;
      expect(await insurancePool.totalCoverage()).to.equal(0);
    });

    it("Should revert when trying to expire active policy", async function () {
      // Deposit to provide liquidity
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy a policy
      await insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("0.5"),
        3600,
        { value: ethers.parseEther("0.1") }
      );

      // Try to expire before expiration
      await expect(insurancePool.connect(policyholder1).expirePolicy(0))
        .to.be.revertedWith("Not expired");
    });

    it("Should revert when trying to expire already expired policy", async function () {
      // Deposit to provide liquidity
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy a policy
      await insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("0.5"),
        3600,
        { value: ethers.parseEther("0.1") }
      );

      // Expire the policy
      await ethers.provider.send("evm_increaseTime", [3601]);
      await insurancePool.connect(policyholder1).expirePolicy(0);

      // Try to expire again
      await expect(insurancePool.connect(policyholder1).expirePolicy(0))
        .to.be.revertedWith("Not active");
    });
  });

  describe("Reward Distribution", function () {
    it("Should distribute premiums to LPs proportionally", async function () {
      // Deposit from two LPs
      const lp1Deposit = ethers.parseEther("1");
      const lp2Deposit = ethers.parseEther("2");
      await insurancePool.connect(lp1).deposit({ value: lp1Deposit });
      await insurancePool.connect(lp2).deposit({ value: lp2Deposit });

      // Buy a policy with premium
      const premium = ethers.parseEther("0.3");
      await insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("0.5"),
        3600,
        { value: premium }
      );

      // Withdraw to trigger reward calculation
      await insurancePool.connect(lp1).withdraw(ethers.parseEther("0.1"));
      await insurancePool.connect(lp2).withdraw(ethers.parseEther("0.1"));

      // Deposit again to accumulate rewards
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("0.1") });
      await insurancePool.connect(lp2).deposit({ value: ethers.parseEther("0.1") });

      const lp1Rewards = await insurancePool.pendingRewards(lp1.address);
      const lp2Rewards = await insurancePool.pendingRewards(lp2.address);

      // LP2 should have received more rewards due to larger deposit
      expect(lp2Rewards).to.be.gt(lp1Rewards);

      // The ratio should be approximately 1:2 (lp1:lp2)
      const ratio = lp1Rewards * 2n / lp2Rewards;
      expect(ratio).to.be.closeTo(1n, 1n); // Allow small deviation due to integer division
    });

    it("Should update rewards when multiple policies are purchased", async function () {
      // Deposit from two LPs
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });
      await insurancePool.connect(lp2).deposit({ value: ethers.parseEther("2") });

      // Buy first policy
      await insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("0.5"),
        3600,
        { value: ethers.parseEther("0.1") }
      );

      // Withdraw to trigger reward calculation
      await insurancePool.connect(lp1).withdraw(ethers.parseEther("0.1"));
      await insurancePool.connect(lp2).withdraw(ethers.parseEther("0.1"));

      // Buy second policy
      await insurancePool.connect(policyholder2).buyPolicy(
        ethers.parseEther("0.3"),
        3600,
        { value: ethers.parseEther("0.2") }
      );

      // Withdraw again to trigger reward calculation
      await insurancePool.connect(lp1).withdraw(ethers.parseEther("0.1"));
      await insurancePool.connect(lp2).withdraw(ethers.parseEther("0.1"));

      // Deposit again to accumulate rewards
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("0.1") });
      await insurancePool.connect(lp2).deposit({ value: ethers.parseEther("0.1") });

      const lp1Rewards = await insurancePool.pendingRewards(lp1.address);
      const lp2Rewards = await insurancePool.pendingRewards(lp2.address);

      // LP2 should have received more rewards due to larger deposit
      expect(lp2Rewards).to.be.gt(lp1Rewards);
    });
  });
});