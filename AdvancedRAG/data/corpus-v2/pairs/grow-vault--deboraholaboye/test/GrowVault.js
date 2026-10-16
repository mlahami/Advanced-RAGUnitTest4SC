const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const SOFT = 0;
const HARD = 1;
const ONE_CUSD = ethers.parseUnits("1", 18);
const TEN_CUSD = ethers.parseUnits("10", 18);
const HUNDRED_CUSD = ethers.parseUnits("100", 18);

async function deployFixture() {
  const [owner, alice, bob] = await ethers.getSigners();
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mockCUSD = await MockERC20.deploy("Celo Dollar", "cUSD", 18);
  const GrowVault = await ethers.getContractFactory("GrowVault");
  const vault = await GrowVault.deploy(await mockCUSD.getAddress());
  await mockCUSD.mint(alice.address, HUNDRED_CUSD * 10n);
  await mockCUSD.mint(bob.address, HUNDRED_CUSD * 10n);
  await mockCUSD.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
  await mockCUSD.connect(bob).approve(await vault.getAddress(), ethers.MaxUint256);
  const oneMonthFromNow = (await time.latest()) + 30 * 24 * 3600;
  return { vault, mockCUSD, owner, alice, bob, oneMonthFromNow };
}

describe("GrowVault", () => {
  describe("createGoal", () => {
    it("creates a goal and records it", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("School fees", "🎓", TEN_CUSD, oneMonthFromNow, SOFT);
      const goal = await vault.goals(0n);
      expect(goal.owner).to.equal(alice.address);
      expect(goal.name).to.equal("School fees");
      expect(goal.emoji).to.equal("🎓");
      expect(goal.targetAmount).to.equal(TEN_CUSD);
      expect(goal.lockMode).to.equal(SOFT);
      expect(goal.completed).to.be.false;
      expect(goal.withdrawn).to.be.false;
    });

    it("increments goalId counter", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Goal A", "🏠", TEN_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).createGoal("Goal B", "📱", TEN_CUSD, oneMonthFromNow, HARD);
      const ids = await vault.getUserGoals(alice.address);
      expect(ids).to.deep.equal([0n, 1n]);
    });

    it("reverts if name is empty", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await expect(
        vault.connect(alice).createGoal("", "🎓", TEN_CUSD, oneMonthFromNow, SOFT)
      ).to.be.revertedWith("Name required");
    });

    it("reverts if targetAmount is zero", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await expect(
        vault.connect(alice).createGoal("Test", "🎓", 0, oneMonthFromNow, SOFT)
      ).to.be.revertedWith("Target required");
    });

    it("reverts if deadline is in the past", async () => {
      const { vault, alice } = await deployFixture();
      const pastDeadline = (await time.latest()) - 1;
      await expect(
        vault.connect(alice).createGoal("Test", "🎓", TEN_CUSD, pastDeadline, SOFT)
      ).to.be.revertedWith("Invalid deadline");
    });
  });

  describe("deposit", () => {
    it("records contribution and updates savedAmount", async () => {
      const { vault, alice, bob, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Laptop", "💻", TEN_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(bob).deposit(0n, ONE_CUSD);
      const goal = await vault.goals(0n);
      expect(goal.savedAmount).to.equal(ONE_CUSD);
      expect(await vault.contributions(0n, bob.address)).to.equal(ONE_CUSD);
    });

    it("marks goal completed when savedAmount reaches target", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Phone", "📱", ONE_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      const goal = await vault.goals(0n);
      expect(goal.completed).to.be.true;
    });

    it("social contribution — non-owner can deposit and appears in contributors", async () => {
      const { vault, alice, bob, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Business", "💼", TEN_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(bob).deposit(0n, ONE_CUSD);
      const contributors = await vault.getContributors(0n);
      expect(contributors).to.include(bob.address);
    });

    it("accumulates multiple deposits from the same contributor", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Trip", "✈️", TEN_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      const goal = await vault.goals(0n);
      expect(goal.savedAmount).to.equal(ONE_CUSD * 2n);
      expect(await vault.contributions(0n, alice.address)).to.equal(ONE_CUSD * 2n);
    });

    it("reverts on a withdrawn goal", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Done", "✅", ONE_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      await vault.connect(alice).withdraw(0n);
      await expect(vault.connect(alice).deposit(0n, ONE_CUSD)).to.be.revertedWith("Goal closed");
    });
  });

  describe("withdraw (soft lock)", () => {
    it("applies 5% penalty on early withdrawal", async () => {
      const { vault, mockCUSD, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Partial", "🎯", HUNDRED_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, TEN_CUSD);
      const balBefore = await mockCUSD.balanceOf(alice.address);
      await vault.connect(alice).withdraw(0n);
      const balAfter = await mockCUSD.balanceOf(alice.address);
      const received = balAfter - balBefore;
      const expected = (TEN_CUSD * 9500n) / 10000n;
      expect(received).to.equal(expected);
      expect(await vault.penaltyPool()).to.equal(TEN_CUSD - expected);
    });

    it("no penalty if soft lock goal is completed", async () => {
      const { vault, mockCUSD, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Full", "🎯", ONE_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      const balBefore = await mockCUSD.balanceOf(alice.address);
      await vault.connect(alice).withdraw(0n);
      const balAfter = await mockCUSD.balanceOf(alice.address);
      expect(balAfter - balBefore).to.equal(ONE_CUSD);
    });

    it("no penalty if withdrawn after deadline", async () => {
      const { vault, mockCUSD, alice } = await deployFixture();
      const deadline = (await time.latest()) + 100;
      await vault.connect(alice).createGoal("After deadline", "🎯", TEN_CUSD, deadline, SOFT);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      await time.increase(200);
      const balBefore = await mockCUSD.balanceOf(alice.address);
      await vault.connect(alice).withdraw(0n);
      const balAfter = await mockCUSD.balanceOf(alice.address);
      expect(balAfter - balBefore).to.equal(ONE_CUSD);
    });

    it("reverts if non-owner tries to withdraw", async () => {
      const { vault, alice, bob, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Mine", "🎯", TEN_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      await expect(vault.connect(bob).withdraw(0n)).to.be.revertedWith("Not owner");
    });
  });

  describe("withdraw (hard lock)", () => {
    it("reverts if hard lock before deadline", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Hard", "🔒", TEN_CUSD, oneMonthFromNow, HARD);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      await expect(vault.connect(alice).withdraw(0n)).to.be.revertedWith("Hard locked until deadline");
    });

    it("succeeds after deadline", async () => {
      const { vault, mockCUSD, alice } = await deployFixture();
      const deadline = (await time.latest()) + 100;
      await vault.connect(alice).createGoal("Hard future", "🔒", TEN_CUSD, deadline, HARD);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      await time.increase(200);
      const balBefore = await mockCUSD.balanceOf(alice.address);
      await vault.connect(alice).withdraw(0n);
      const balAfter = await mockCUSD.balanceOf(alice.address);
      expect(balAfter - balBefore).to.equal(ONE_CUSD);
    });

    it("succeeds before deadline if goal is completed", async () => {
      const { vault, mockCUSD, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Hard complete", "🔒", ONE_CUSD, oneMonthFromNow, HARD);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      const balBefore = await mockCUSD.balanceOf(alice.address);
      await vault.connect(alice).withdraw(0n);
      const balAfter = await mockCUSD.balanceOf(alice.address);
      expect(balAfter - balBefore).to.equal(ONE_CUSD);
    });
  });

  describe("claimMilestone", () => {
    it("claims milestone at 25%", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Save", "🎯", HUNDRED_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ethers.parseUnits("25", 18));
      await vault.connect(alice).claimMilestone(0n);
      expect((await vault.goals(0n)).milestonesClaimed).to.equal(1);
    });

    it("claims all four milestones in sequence", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Full run", "🎯", HUNDRED_CUSD, oneMonthFromNow, SOFT);
      for (const [deposit, expectedMilestone] of [[25, 1], [25, 2], [25, 3], [25, 4]]) {
        await vault.connect(alice).deposit(0n, ethers.parseUnits(deposit.toString(), 18));
        await vault.connect(alice).claimMilestone(0n);
        expect((await vault.goals(0n)).milestonesClaimed).to.equal(expectedMilestone);
      }
    });

    it("reverts if milestone threshold not reached", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Low", "🎯", HUNDRED_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ethers.parseUnits("10", 18));
      await expect(vault.connect(alice).claimMilestone(0n)).to.be.revertedWith("Milestone not reached");
    });

    it("reverts if non-owner tries to claim", async () => {
      const { vault, alice, bob, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Mine", "🎯", HUNDRED_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ethers.parseUnits("25", 18));
      await expect(vault.connect(bob).claimMilestone(0n)).to.be.revertedWith("Not owner");
    });
  });

  describe("withdrawPenalties", () => {
    it("allows owner to collect the penalty pool", async () => {
      const { vault, mockCUSD, owner, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Early exit", "💸", TEN_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      await vault.connect(alice).withdraw(0n);
      const pool = await vault.penaltyPool();
      expect(pool).to.be.gt(0n);
      const balBefore = await mockCUSD.balanceOf(owner.address);
      await vault.connect(owner).withdrawPenalties();
      const balAfter = await mockCUSD.balanceOf(owner.address);
      expect(balAfter - balBefore).to.equal(pool);
      expect(await vault.penaltyPool()).to.equal(0n);
    });

    it("reverts if non-owner tries to collect penalties", async () => {
      const { vault, alice } = await deployFixture();
      await expect(vault.connect(alice).withdrawPenalties()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });
});
