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

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await insurancePool.owner()).to.equal(owner.address);
    });

    it("Should initialize with zero values", async function () {
      expect(await insurancePool.totalLiquidity()).to.equal(0n);
      expect(await insurancePool.totalCoverage()).to.equal(0n);
      expect(await insurancePool.rewardPerShare()).to.equal(0n);
      expect(await insurancePool.policyCount()).to.equal(0n);
    });
  });

  describe("LP Actions", function () {
    describe("Deposit", function () {
      it("Should allow ETH deposits", async function () {
        const depositAmount = ethers.parseEther("1.0");
        await expect(insurancePool.connect(lp1).deposit({ value: depositAmount }))
          .to.emit(insurancePool, "Deposited")
          .withArgs(lp1.address, depositAmount);

        expect(await insurancePool.totalLiquidity()).to.equal(depositAmount);
        expect(await insurancePool.lpPositions(lp1.address)).to.deep.equal({
          deposited: depositAmount,
          rewardDebt: 0n
        });
      });

      it("Should revert on zero deposit", async function () {
        await expect(insurancePool.connect(lp1).deposit({ value: 0 }))
          .to.be.revertedWith("Zero deposit");
      });
    });

    describe("Withdraw", function () {
      beforeEach(async function () {
        await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("2.0") });
      });

      it("Should allow partial withdrawals", async function () {
        const withdrawAmount = ethers.parseEther("1.0");
        await expect(insurancePool.connect(lp1).withdraw(withdrawAmount))
          .to.emit(insurancePool, "Withdrawn")
          .withArgs(lp1.address, withdrawAmount);

        expect(await insurancePool.totalLiquidity()).to.equal(ethers.parseEther("1.0"));
        expect(await insurancePool.lpPositions(lp1.address).deposited).to.equal(ethers.parseEther("1.0"));
      });

      it("Should revert on insufficient deposit", async function () {
        await expect(insurancePool.connect(lp1).withdraw(ethers.parseEther("3.0")))
          .to.be.revertedWith("Insufficient deposit");
      });

      it("Should revert if pool is undercollateralized", async function () {
        // Create a policy that would make the pool undercollateralized
        await insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("1.5"), 3600, { value: ethers.parseEther("0.1") });

        await expect(insurancePool.connect(lp1).withdraw(ethers.parseEther("1.0")))
          .to.be.revertedWith("Undercollateralized");
      });
    });

    describe("Claim Rewards", function () {
      beforeEach(async function () {
        await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1.0") });
        await insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 3600, { value: ethers.parseEther("0.1") });
      });

      it("Should allow claiming rewards", async function () {
        const initialBalance = await ethers.provider.getBalance(lp1.address);
        const tx = await insurancePool.connect(lp1).claimRewards();
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;
        const finalBalance = await ethers.provider.getBalance(lp1.address);

        expect(finalBalance).to.be.greaterThan(initialBalance - gasUsed);
        expect(await insurancePool.pendingRewards(lp1.address)).to.equal(0n);
      });

      it("Should revert when no rewards to claim", async function () {
        await expect(insurancePool.connect(lp2).claimRewards())
          .to.be.revertedWith("No rewards");
      });
    });
  });

  describe("Policy Actions", function () {
    describe("Buy Policy", function () {
      beforeEach(async function () {
        await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1.0") });
      });

      it("Should allow buying a policy", async function () {
        const coverage = ethers.parseEther("0.5");
        const premium = ethers.parseEther("0.1");
        const duration = 3600;

        await expect(insurancePool.connect(policyholder1).buyPolicy(coverage, duration, { value: premium }))
          .to.emit(insurancePool, "PolicyPurchased")
          .withArgs(0n, policyholder1.address, coverage, premium, (await ethers.provider.getBlock("latest")).timestamp + duration);

        expect(await insurancePool.totalCoverage()).to.equal(coverage);
        expect(await insurancePool.policyCount()).to.equal(1n);
      });

      it("Should revert on zero coverage", async function () {
        await expect(insurancePool.connect(policyholder1).buyPolicy(0, 3600, { value: ethers.parseEther("0.1") }))
          .to.be.revertedWith("Zero coverage");
      });

      it("Should revert on insufficient pool liquidity", async function () {
        await expect(insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("2.0"), 3600, { value: ethers.parseEther("0.1") }))
          .to.be.revertedWith("Insufficient pool");
      });

      it("Should revert on zero premium", async function () {
        await expect(insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 3600, { value: 0 }))
          .to.be.revertedWith("No premium");
      });
    });

    describe("Trigger Claim", function () {
      let policyId;

      beforeEach(async function () {
        await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1.0") });
        await insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 3600, { value: ethers.parseEther("0.1") });
        policyId = 0n;
      });

      it("Should allow owner to trigger claim", async function () {
        const initialBalance = await ethers.provider.getBalance(policyholder1.address);
        const tx = await insurancePool.connect(owner).triggerClaim(policyId);
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;
        const finalBalance = await ethers.provider.getBalance(policyholder1.address);

        expect(finalBalance).to.be.greaterThan(initialBalance - gasUsed);
        expect(await insurancePool.totalCoverage()).to.equal(0n);
        expect(await insurancePool.totalLiquidity()).to.equal(ethers.parseEther("0.5"));
      });

      it("Should revert if not owner", async function () {
        await expect(insurancePool.connect(lp1).triggerClaim(policyId))
          .to.be.revertedWith("Not owner");
      });

      it("Should revert if policy is not claimable", async function () {
        await insurancePool.connect(owner).triggerClaim(policyId);
        await expect(insurancePool.connect(owner).triggerClaim(policyId))
          .to.be.revertedWith("Not claimable");
      });

      it("Should revert if policy is expired", async function () {
        // Fast forward time
        await ethers.provider.send("evm_increaseTime", [3601]);
        await ethers.provider.send("evm_mine");

        await expect(insurancePool.connect(owner).triggerClaim(policyId))
          .to.be.revertedWith("Policy expired");
      });
    });

    describe("Expire Policy", function () {
      let policyId;

      beforeEach(async function () {
        await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1.0") });
        await insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 3600, { value: ethers.parseEther("0.1") });
        policyId = 0n;
      });

      it("Should allow expiring a policy", async function () {
        // Fast forward time
        await ethers.provider.send("evm_increaseTime", [3601]);
        await ethers.provider.send("evm_mine");

        await expect(insurancePool.connect(policyholder1).expirePolicy(policyId))
          .to.emit(insurancePool, "PolicyExpired")
          .withArgs(policyId);

        expect(await insurancePool.totalCoverage()).to.equal(0n);
      });

      it("Should revert if policy is not active", async function () {
        await insurancePool.connect(owner).triggerClaim(policyId);
        await expect(insurancePool.connect(policyholder1).expirePolicy(policyId))
          .to.be.revertedWith("Not active");
      });

      it("Should revert if policy is not expired", async function () {
        await expect(insurancePool.connect(policyholder1).expirePolicy(policyId))
          .to.be.revertedWith("Not expired");
      });
    });
  });

  describe("Reward Distribution", function () {
    it("Should correctly distribute rewards to LPs", async function () {
      // LP1 deposits 1 ETH
      await insurancePool.connect(lp1).deposit({ value: ethers.parseEther("1.0") });

      // Policyholder buys policy with 0.1 ETH premium
      await insurancePool.connect(policyholder1).buyPolicy(ethers.parseEther("0.5"), 3600, { value: ethers.parseEther("0.1") });

      // LP2 deposits 1 ETH
      await insurancePool.connect(lp2).deposit({ value: ethers.parseEther("1.0") });

      // Policyholder buys another policy with 0.2 ETH premium
      await insurancePool.connect(policyholder2).buyPolicy(ethers.parseEther("0.5"), 3600, { value: ethers.parseEther("0.2") });

      // Claim rewards for both LPs
      await insurancePool.connect(lp1).claimRewards();
      await insurancePool.connect(lp2).claimRewards();

      // LP1 should have received 0.1 ETH (100% of first premium)
      // LP2 should have received 0.2 ETH (100% of second premium)
      // Since both LPs had equal deposits, they should have equal rewards
      const lp1Reward = await ethers.provider.getBalance(lp1.address);
      const lp2Reward = await ethers.provider.getBalance(lp2.address);

      // The exact amounts will vary slightly due to gas costs, but the distribution should be roughly equal
      expect(lp1Reward).to.be.closeTo(lp2Reward, ethers.parseEther("0.01"));
    });
  });
});