const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiminalStakingPool – Emission Decay", function () {
  async function deployFixture() {
    const [owner, user1, user2, stranger] = await ethers.getSigners();

    // Deploy token
    const Token = await ethers.getContractFactory("LiminalToken");
    const lim = await Token.deploy();
    await lim.waitForDeployment();

    // Deploy staking pool
    const Pool = await ethers.getContractFactory("LiminalStakingPool");
    const pool = await Pool.deploy(await lim.getAddress());
    await pool.waitForDeployment();

    // Grant loader role and fund rewards
    const preload = ethers.parseUnits("40000000", 18);
    await pool.connect(owner).grantLoaderRole(owner.address);
    await lim.connect(owner).approve(pool.getAddress(), preload);
    await pool.connect(owner).receiveRewardTokens(preload);

    // Distribute LIM to users
    const stake1 = ethers.parseUnits("1000", 18);
    const stake2 = ethers.parseUnits("2000000", 18);
    await lim.transfer(user1.address, stake1);
    await lim.transfer(user2.address, stake2);

    return { owner, user1, user2, stranger, lim, pool, stake1, stake2 };
  }

  it("should only allow POOL_LOADER_ROLE to load rewards", async () => {
    const { stranger, lim, pool } = await loadFixture(deployFixture);
    const amt = ethers.parseUnits("100", 18);
    await lim.approve(await pool.getAddress(), amt);
    await expect(pool.connect(stranger).receiveRewardTokens(amt)).to.be.reverted;
  });

  it("should emit decaying rewards (12h stake)", async () => {
    const { user1, lim, pool, stake1 } = await loadFixture(deployFixture);
    await lim.connect(user1).approve(pool.getAddress(), stake1);
    await pool.connect(user1).stake(stake1);

    const seconds = 43200; // 12 hours
    await time.increase(seconds);
    await ethers.provider.send("evm_mine");

    const rps = await pool.currentRewardPerSecond();
    const expected = rps * BigInt(seconds);
    const pending = await pool.pendingReward(user1.address);
    const tolerance = ethers.parseUnits("20", 18);

    console.log("⏱ Elapsed:", seconds);
    console.log("📈 RPS:", rps.toString());
    console.log("💰 Expected:", expected.toString());
    console.log("🧾 Pending:", pending.toString());

    expect(pending).to.be.closeTo(expected, tolerance);
  });

  it("should split rewards between multiple users proportionally", async () => {
    const { user1, user2, lim, pool, stake1, stake2 } = await loadFixture(deployFixture);

    await lim.connect(user1).approve(pool.getAddress(), stake1);
    await pool.connect(user1).stake(stake1);

    await lim.connect(user2).approve(pool.getAddress(), stake2);
    await pool.connect(user2).stake(stake2);

    await time.increase(86400); // 1 day
    await ethers.provider.send("evm_mine");

    const p1 = await pool.pendingReward(user1.address);
    const p2 = await pool.pendingReward(user2.address);

    const totalPending = p1 + p2;
    const expectedRatio1 = (stake1 * 10000n) / (stake1 + stake2); // basis points (10000 = 100%)
    const actualRatio1 = (p1 * 10000n) / totalPending;

    console.log("🧑‍🌾 User1 pending:", p1.toString());
    console.log("🧑‍🌾 User2 pending:", p2.toString());
    console.log("📊 Expected User1 ratio (bps):", expectedRatio1.toString());
    console.log("📐 Actual User1 ratio (bps):", actualRatio1.toString());

    expect(actualRatio1).to.be.closeTo(expectedRatio1, 50); // 0.5% tolerance
  });

  it("should reward early stakers more under decaying emissions", async () => {
    const { user1, user2, lim, pool } = await loadFixture(deployFixture);
    const amt = ethers.parseUnits("100", 18);

    await lim.connect(user1).approve(pool.getAddress(), amt);
    await pool.connect(user1).stake(amt);

    await time.increase(12 * 3600); // 12h
    await lim.connect(user2).approve(pool.getAddress(), amt);
    await pool.connect(user2).stake(amt);

    await time.increase(12 * 3600); // another 12h
    await ethers.provider.send("evm_mine");

    const pending1 = await pool.pendingReward(user1.address);
    const pending2 = await pool.pendingReward(user2.address);
    const total = pending1 + pending2;

    const percent1 = (pending1 * 10000n) / total;
    const percent2 = (pending2 * 10000n) / total;

    console.log("User1 Share:", Number(percent1) / 100, "%");
    console.log("User2 Share:", Number(percent2) / 100, "%");

    expect(percent1).to.be.greaterThan(percent2); // User1 should earn more
  });

  it("should decay emission rate over time (day 1 vs day 30)", async () => {
    const { pool } = await loadFixture(deployFixture);

    const rpsDay0 = await pool.currentRewardPerSecond();
    await time.increase(30 * 86400); // 30 days
    await ethers.provider.send("evm_mine");

    const rpsDay30 = await pool.currentRewardPerSecond();

    const expectedEnd = BigInt("1157407407407407407");
    const tolerance = BigInt("10000000000000000"); // 0.01 LIM

    console.log("📊 RPS Day 0:", rpsDay0.toString());
    console.log("📉 RPS Day 30:", rpsDay30.toString());

    expect(rpsDay30).to.be.closeTo(expectedEnd, tolerance);
  });

  it("should not go below EMISSION_END after 30 days", async () => {
    const { pool } = await loadFixture(deployFixture);
    await time.increase(45 * 86400); // advance 45 days
    const rps = await pool.currentRewardPerSecond();

    const expectedEnd = BigInt("1157407407407407407");
    expect(rps).to.equal(expectedEnd);
  });

  it("should fully drain the reward pool over time without reverts", async () => {
    const { user1, lim, pool } = await loadFixture(deployFixture);

    const stakeAmt = ethers.parseUnits("1000", 18);
    await lim.connect(user1).approve(pool.getAddress(), stakeAmt);
    await pool.connect(user1).stake(stakeAmt);

    let lastPending = 0n;
    let totalClaimed = 0n;

    for (let i = 0; i < 400; i++) {
      await time.increase(86400); // 1 day
      await ethers.provider.send("evm_mine");

      const pending = await pool.pendingReward(user1.address);
      const poolBal = await lim.balanceOf(pool.getAddress());

      console.log(`📅 Day ${i + 1}: Pending = ${pending}, Pool = ${poolBal}`);

      if (pending > 0n) {
        await pool.connect(user1).claim();
        totalClaimed += pending;
      }

      if (poolBal < ethers.parseUnits("0.0001", 18)) {
        console.log("🎯 Pool drained.");
        break;
      }

      lastPending = pending;
    }

    const finalPool = await lim.balanceOf(pool.getAddress());
    expect(finalPool).to.be.lte(ethers.parseUnits("1001", 18));

    console.log("✅ Final Pool:", finalPool.toString());
    console.log("✅ Total Claimed:", totalClaimed.toString());
  });

  it("should emit Claimed and Unstaked events on full unstake", async () => {
    const { user1, lim, pool, stake1 } = await loadFixture(deployFixture);

    await lim.connect(user1).approve(pool.getAddress(), stake1);
    await pool.connect(user1).stake(stake1);

    await time.increase(86400);

    await expect(pool.connect(user1).unstake(stake1))
      .to.emit(pool, "Claimed")
      .and.to.emit(pool, "Unstaked");
  });

  it("should correctly split rewards when User2 stakes later with more weight", async () => {
    const { user1, user2, lim, pool } = await loadFixture(deployFixture);

    const stake1 = ethers.parseUnits("1000", 18);
    const stake2 = ethers.parseUnits("2000", 18);

    // User1 stakes on Day 0
    await lim.connect(user1).approve(pool.getAddress(), stake1);
    await pool.connect(user1).stake(stake1);

    // ⏩ Advance 1 day
    await time.increase(86400);
    await ethers.provider.send("evm_mine");

    // User2 stakes on Day 1
    await lim.connect(user2).approve(pool.getAddress(), stake2);
    await pool.connect(user2).stake(stake2);

    // ⏩ Advance another day
    await time.increase(86400);
    await ethers.provider.send("evm_mine");

    // Collect pending rewards
    const p1 = await pool.pendingReward(user1.address);
    const p2 = await pool.pendingReward(user2.address);

    const total = p1 + p2;
    const actualUser1Bps = (p1 * 10000n) / total; // basis points (1/100 of %)

    // Expected:
    // - Day 1: User1 gets 100%
    // - Day 2: User1 gets 1/3, User2 gets 2/3
    // => User1 total = 1 + 1/3 = 4/3
    // => Total = 2
    // => Ratio = (4/3) / 2 = 2/3 = 6666.66 bps
    const expectedUser1Bps = 6667n;

    console.log("🧑‍🌾 User1 pending:", p1.toString());
    console.log("🧑‍🌾 User2 pending:", p2.toString());
    console.log("📊 Expected User1 ratio (bps):", expectedUser1Bps.toString());
    console.log("📐 Actual User1 ratio (bps):", actualUser1Bps.toString());

    expect(actualUser1Bps).to.be.closeTo(expectedUser1Bps, 50); // now ±0.5%
  });
});
