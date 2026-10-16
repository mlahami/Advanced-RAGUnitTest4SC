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

      expect(await insurancePool.totalLiquidity()).to.equal(withdrawAmount);
      expect(await insurancePool.lpPositions(lp1.address)).to.deep.equal([
        withdrawAmount,
        0n
      ]);

      await expect(insurancePool.connect(lp1).withdraw(ethers.parseEther("2")))
        .to.be.revertedWith("Insufficient deposit");
    });

    it("Should prevent withdrawal when pool is undercollateralized", async function () {
      const depositAmount = ethers.parseEther("1");
      await insurancePool.connect(lp1).deposit({ value: depositAmount });

      // Buy a policy that requires full collateralization
      await insurancePool.connect(policyholder1).buyPolicy(
        depositAmount,
        3600,
        { value: ethers.parseEther("0.1") }
      );

      await expect(insurancePool.connect(lp1).withdraw(depositAmount))
        .to.be.revertedWith("Undercollateralized");
    });

    it("Should allow claiming rewards", async function () {
      // Deposit first LP
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy policy to generate rewards
      await insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("0.5"),
        3600,
        { value: ethers.parseEther("0.1") }
      );

      // Deposit second LP to earn rewards
      await insurancePool.connect(lp2).deposit({ value: ethers.parseEther("1") });

      // Withdraw first LP to claim rewards
      await insurancePool.connect(lp1).withdraw(ethers.parseEther("1"));

      expect(await insurancePool.pendingRewards(lp1.address)).to.be.gt(0n);
      await expect(() =>
        insurancePool.connect(lp1).claimRewards()
      ).to.changeEtherBalance(lp1, await insurancePool.pendingRewards(lp1.address));

      expect(await insurancePool.pendingRewards(lp1.address)).to.equal(0n);
    });

    it("Should prevent claiming zero rewards", async function () {
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

      expect(await insurancePool.totalCoverage()).to.equal(coverage);
      expect(await insurancePool.policyCount()).to.equal(1n);

      const policy = await insurancePool.policies(0);
      expect(policy.holder).to.equal(policyholder1.address);
      expect(policy.coverage).to.equal(coverage);
      expect(policy.premium).to.equal(premium);
      expect(policy.active).to.be.true;
      expect(policy.claimed).to.be.false;
    });

    it("Should prevent buying policy with zero coverage", async function () {
      await expect(insurancePool.connect(policyholder1).buyPolicy(
        0,
        3600,
        { value: ethers.parseEther("0.1") }
      )).to.be.revertedWith("Zero coverage");
    });

    it("Should prevent buying policy with insufficient pool liquidity", async function () {
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy policy that uses all liquidity
      await insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("1"),
        3600,
        { value: ethers.parseEther("0.1") }
      );

      // Try to buy another policy
      await expect(insurancePool.connect(policyholder2).buyPolicy(
        ethers.parseEther("0.1"),
        3600,
        { value: ethers.parseEther("0.1") }
      )).to.be.revertedWith("Insufficient pool");
    });

    it("Should prevent buying policy with zero premium", async function () {
      await expect(insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("0.5"),
        3600,
        { value: 0 }
      )).to.be.revertedWith("No premium");
    });
  });

  describe("Oracle Actions", function () {
    it("Should allow owner to trigger claim", async function () {
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      const coverage = ethers.parseEther("0.5");
      const premium = ethers.parseEther("0.1");
      const duration = 3600;

      await insurancePool.connect(policyholder1).buyPolicy(
        coverage,
        duration,
        { value: premium }
      );

      await expect(() =>
        insurancePool.connect(owner).triggerClaim(0)
      ).to.changeEtherBalances(
        [policyholder1, await insurancePool.getAddress()],
        [coverage, -coverage]
      );

      const policy = await insurancePool.policies(0);
      expect(policy.claimed).to.be.true;
      expect(policy.active).to.be.false;
      expect(await insurancePool.totalCoverage()).to.equal(0n);
    });

    it("Should prevent non-owner from triggering claim", async function () {
      await expect(insurancePool.connect(lp1).triggerClaim(0))
        .to.be.revertedWith("Not owner");
    });

    it("Should prevent claiming inactive or already claimed policy", async function () {
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      await insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("0.5"),
        3600,
        { value: ethers.parseEther("0.1") }
      );

      // Expire the policy
      await ethers.provider.send("evm_increaseTime", [3601]);
      await insurancePool.expirePolicy(0);

      await expect(insurancePool.connect(owner).triggerClaim(0))
        .to.be.revertedWith("Not claimable");
    });

    it("Should prevent claiming expired policy", async function () {
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      await insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("0.5"),
        3600,
        { value: ethers.parseEther("0.1") }
      );

      // Try to claim before expiration
      await expect(insurancePool.connect(owner).triggerClaim(0))
        .to.be.revertedWith("Policy expired");
    });

    it("Should allow expiring a policy", async function () {
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      const coverage = ethers.parseEther("0.5");
      await insurancePool.connect(policyholder1).buyPolicy(
        coverage,
        3600,
        { value: ethers.parseEther("0.1") }
      );

      // Increase time to expire the policy
      await ethers.provider.send("evm_increaseTime", [3601]);

      await insurancePool.expirePolicy(0);

      const policy = await insurancePool.policies(0);
      expect(policy.active).to.be.false;
      expect(await insurancePool.totalCoverage()).to.equal(0n);
    });

    it("Should prevent expiring active or already claimed policy", async function () {
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      await insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("0.5"),
        3600,
        { value: ethers.parseEther("0.1") }
      );

      // Try to expire active policy
      await expect(insurancePool.expirePolicy(0))
        .to.be.revertedWith("Not expired");
    });

    it("Should prevent expiring non-existent policy", async function () {
      await expect(insurancePool.expirePolicy(0))
        .to.be.revertedWith("Not active");
    });
  });

  describe("Reward Distribution", function () {
    it("Should distribute premiums to LPs proportionally", async function () {
      // Deposit first LP
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy first policy
      const premium1 = ethers.parseEther("0.1");
      await insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("0.5"),
        3600,
        { value: premium1 }
      );

      // Deposit second LP
      await insurancePool.connect(lp2).deposit({ value: ethers.parseEther("1") });

      // Buy second policy
      const premium2 = ethers.parseEther("0.2");
      await insurancePool.connect(policyholder2).buyPolicy(
        ethers.parseEther("0.5"),
        3600,
        { value: premium2 }
      );

      // Withdraw both LPs to claim rewards
      await insurancePool.connect(lp1).withdraw(ethers.parseEther("1"));
      await insurancePool.connect(lp2).withdraw(ethers.parseEther("1"));

      const rewards1 = await insurancePool.pendingRewards(lp1.address);
      const rewards2 = await insurancePool.pendingRewards(lp2.address);

      // LP1 should have received more rewards because they were there for the first policy
      expect(rewards1).to.be.gt(rewards2);
      expect(rewards1 + rewards2).to.be.closeTo(premium1 + premium2, ethers.parseEther("0.0001"));
    });

    it("Should update rewards when new LPs deposit", async function () {
      // Deposit first LP
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1") });

      // Buy policy
      const premium = ethers.parseEther("0.1");
      await insurancePool.connect(policyholder1).buyPolicy(
        ethers.parseEther("0.5"),
        3600,
        { value: premium }
      );

      // Deposit second LP
      await insurancePool.connect(lp2).deposit({ value: ethers.parseEther("1") });

      // Withdraw first LP
      await insurancePool.connect(lp1).withdraw(ethers.parseEther("1"));

      const rewards1 = await insurancePool.pendingRewards(lp1.address);
      expect(rewards1).to.be.gt(0n);

      // Withdraw second LP
      await insurancePool.connect(lp2).withdraw(ethers.parseEther("1"));
      const rewards2 = await insurancePool.pendingRewards(lp2.address);

      // Second LP should have zero rewards because they joined after the policy was bought
      expect(rewards2).to.equal(0n);
    });
  });
});