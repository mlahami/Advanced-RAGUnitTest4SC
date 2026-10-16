const { expect } = require("chai");
const { ethers } = require("hardhat");

const ONE_DAY = 24 * 60 * 60;

async function increase(days) {
  await ethers.provider.send("evm_increaseTime", [days * ONE_DAY]);
  await ethers.provider.send("evm_mine", []);
}

describe("Fixed Yield Vaults", () => {
  let vault;
  let reward;
  let underlying;
  let user;
  let alice;
  let bob;

  beforeEach(async () => {
    [user, alice, bob] = await ethers.getSigners();

    // 部署合约
    const Reward = await ethers.getContractFactory("RewardToken");
    reward = await Reward.deploy("RewardToken", "RWD");
    await reward.waitForDeployment();

    const Mock = await ethers.getContractFactory("MockERC20");
    underlying = await Mock.deploy("Mock USD", "mUSD", 18);
    await underlying.waitForDeployment();

    const Vault4626 = await ethers.getContractFactory("FixedRateERC4626Vault");
    vault = await Vault4626.deploy(await underlying.getAddress(), await reward.getAddress(), 500); // 5% APR
    await vault.waitForDeployment();

    // 设置 minter
    await reward.setMinter(await vault.getAddress(), true);

    // 给用户铸造代币
    await underlying.mint(user.address, ethers.parseEther("1000"));
    await underlying.mint(alice.address, ethers.parseEther("1000"));
    await underlying.mint(bob.address, ethers.parseEther("1000"));
  });

  describe("Basic functionality", () => {
    it("Should accrue rewards correctly for single deposit", async () => {
      // 存入 200 代币
      await underlying.connect(user).approve(await vault.getAddress(), ethers.parseEther("200"));
      await vault.connect(user).deposit(ethers.parseEther("200"), user.address);

      // 快进 60 天
      await increase(60);

      const pending = await vault.getPendingReward(user.address);
      // 计算期望收益: 200 * 5% * 60/365 ≈ 1.64 tokens
      const expectedReward = ethers.parseEther("200") * 500n * 60n / (10000n * 365n);

      // 允许小的精度误差
      const diff = pending > expectedReward ? pending - expectedReward : expectedReward - pending;
      const tolerance = ethers.parseEther("0.01"); // 1% tolerance
      expect(diff).to.be.lessThan(tolerance);

      // 领取奖励
      await vault.connect(user).claim();
      const bal = await reward.balanceOf(user.address);
      expect(bal).to.be.closeTo(pending, tolerance);
    });
  });

  describe("Multiple deposits interest calculation", () => {
    it("Should calculate rewards correctly for multiple deposits at different times", async () => {
      // Alice 第一次存款: 100 tokens 在 Day 0
      await underlying.connect(alice).approve(await vault.getAddress(), ethers.parseEther("100"));
      await vault.connect(alice).deposit(ethers.parseEther("100"), alice.address);

      // 快进 10 天
      await increase(10);

      // Alice 第二次存款: 200 tokens 在 Day 10
      await underlying.connect(alice).approve(await vault.getAddress(), ethers.parseEther("200"));
      await vault.connect(alice).deposit(ethers.parseEther("200"), alice.address);

      // 再快进 10 天 (到 Day 20)
      await increase(10);

      const pending = await vault.getPendingReward(alice.address);

      // 期望收益计算:
      // 前 100 tokens 计息 20 天: 100 * 5% * 20/365
      // 后 200 tokens 计息 10 天: 200 * 5% * 10/365
      const reward1 = ethers.parseEther("100") * 500n * 20n / (10000n * 365n);
      const reward2 = ethers.parseEther("200") * 500n * 10n / (10000n * 365n);
      const expectedTotal = reward1 + reward2;

      console.log("Expected reward1 (100 tokens * 20 days):", ethers.formatEther(reward1));
      console.log("Expected reward2 (200 tokens * 10 days):", ethers.formatEther(reward2));
      console.log("Expected total:", ethers.formatEther(expectedTotal));
      console.log("Actual pending:", ethers.formatEther(pending));

      // 允许小的精度误差
      const diff = pending > expectedTotal ? pending - expectedTotal : expectedTotal - pending;
      const tolerance = ethers.parseEther("0.001");
      expect(diff).to.be.lessThan(tolerance);
    });

    it("Should handle multiple users independently", async () => {
      // Alice 先存款
      await underlying.connect(alice).approve(await vault.getAddress(), ethers.parseEther("100"));
      await vault.connect(alice).deposit(ethers.parseEther("100"), alice.address);

      // 5 天后 Bob 存款
      await increase(5);
      await underlying.connect(bob).approve(await vault.getAddress(), ethers.parseEther("200"));
      await vault.connect(bob).deposit(ethers.parseEther("200"), bob.address);

      // 再过 10 天
      await increase(10);

      const alicePending = await vault.getPendingReward(alice.address);
      const bobPending = await vault.getPendingReward(bob.address);

      // Alice: 100 tokens * 15 天
      const aliceExpected = ethers.parseEther("100") * 500n * 15n / (10000n * 365n);
      // Bob: 200 tokens * 10 天
      const bobExpected = ethers.parseEther("200") * 500n * 10n / (10000n * 365n);

      const tolerance = ethers.parseEther("0.001");

      const aliceDiff = alicePending > aliceExpected ? alicePending - aliceExpected : aliceExpected - alicePending;
      const bobDiff = bobPending > bobExpected ? bobPending - bobExpected : bobExpected - bobPending;

      expect(aliceDiff).to.be.lessThan(tolerance);
      expect(bobDiff).to.be.lessThan(tolerance);

      console.log("Alice expected:", ethers.formatEther(aliceExpected));
      console.log("Alice actual:", ethers.formatEther(alicePending));
      console.log("Bob expected:", ethers.formatEther(bobExpected));
      console.log("Bob actual:", ethers.formatEther(bobPending));
    });
  });

  describe("Edge cases", () => {
    it("Should handle zero balance periods correctly", async () => {
      // Alice 存款
      await underlying.connect(alice).approve(await vault.getAddress(), ethers.parseEther("100"));
      await vault.connect(alice).deposit(ethers.parseEther("100"), alice.address);

      // 10 天后取出所有资金
      await increase(10);
      const shares = await vault.balanceOf(alice.address);
      await vault.connect(alice).redeem(shares, alice.address, alice.address);

      // 验证余额为 0
      expect(await vault.balanceOf(alice.address)).to.equal(0);

      // 再等待 10 天
      await increase(10);

      // 再次存款
      await underlying.connect(alice).approve(await vault.getAddress(), ethers.parseEther("200"));
      await vault.connect(alice).deposit(ethers.parseEther("200"), alice.address);

      // 10 天后检查奖励
      await increase(10);

      const pending = await vault.getPendingReward(alice.address);

      // 期望收益应该包括:
      // 1. 第一次存款的 10 天奖励 (应该已经累积)
      // 2. 第三次存款的 10 天奖励
      const firstPeriodReward = ethers.parseEther("100") * 500n * 10n / (10000n * 365n);
      const thirdPeriodReward = ethers.parseEther("200") * 500n * 10n / (10000n * 365n);
      const expectedTotal = firstPeriodReward + thirdPeriodReward;

      console.log("First period reward:", ethers.formatEther(firstPeriodReward));
      console.log("Third period reward:", ethers.formatEther(thirdPeriodReward));
      console.log("Expected total:", ethers.formatEther(expectedTotal));
      console.log("Actual pending:", ethers.formatEther(pending));

      const tolerance = ethers.parseEther("0.001");
      const diff = pending > expectedTotal ? pending - expectedTotal : expectedTotal - pending;
      expect(diff).to.be.lessThan(tolerance);
    });

    it("Should handle rate changes correctly", async () => {
      // Alice 存款
      await underlying.connect(alice).approve(await vault.getAddress(), ethers.parseEther("100"));
      await vault.connect(alice).deposit(ethers.parseEther("100"), alice.address);

      // 10 天后改变利率
      await increase(10);
      await vault.setAnnualRateBps(1000); // 改为 10%

      // 再过 10 天
      await increase(10);

      const pending = await vault.getPendingReward(alice.address);

      // 期望收益:
      // 前 10 天: 100 * 5% * 10/365
      // 后 10 天: 100 * 10% * 10/365
      const reward1 = ethers.parseEther("100") * 500n * 10n / (10000n * 365n);
      const reward2 = ethers.parseEther("100") * 1000n * 10n / (10000n * 365n);
      const expectedTotal = reward1 + reward2;

      const tolerance = ethers.parseEther("0.001");
      const diff = pending > expectedTotal ? pending - expectedTotal : expectedTotal - pending;
      expect(diff).to.be.lessThan(tolerance);

      console.log("Period 1 reward (5%):", ethers.formatEther(reward1));
      console.log("Period 2 reward (10%):", ethers.formatEther(reward2));
      console.log("Expected total:", ethers.formatEther(expectedTotal));
      console.log("Actual pending:", ethers.formatEther(pending));
    });
  });
});
