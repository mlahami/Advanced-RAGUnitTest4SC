const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AirdropDistributor", function () {
  async function deployFixture() {
    const [owner, user1, user2] = await ethers.getSigners();

    // Deploy LiminalToken (pre-mints full supply to owner)
    const Token = await ethers.getContractFactory("LiminalToken");
    const token = await Token.deploy();
    await token.waitForDeployment();

    const totalReserves = ethers.parseEther("10000000");
    const cliff = 30 * 24 * 60 * 60; // 30 days
    const duration = 182 * 24 * 60 * 60; // aprox. 6 months

    // Deploy AirdropDistributor
    const Airdrop = await ethers.getContractFactory("AirdropDistributor");
    const airdrop = await Airdrop.deploy(await token.getAddress(), totalReserves, cliff, duration);
    await airdrop.waitForDeployment();

    // Transfer tokens to AirdropDistributor
    await token.transfer(await airdrop.getAddress(), totalReserves);

    return { owner, user1, user2, token, airdrop, totalReserves, cliff, duration };
  }

  it("should not allow claimable assignment before cliff", async () => {
    const { airdrop, user1 } = await loadFixture(deployFixture);
    await expect(airdrop.setClaimable(user1.address, ethers.parseEther("1000"))).to.be.revertedWith("Exceeds unlocked tokens");
  });

  it("should allow claimable assignment after cliff", async () => {
    const { airdrop, user1, cliff } = await loadFixture(deployFixture);
    await time.increase(cliff + 1);

    const unlocked = await airdrop.getUnlockedReserves();
    expect(unlocked).to.be.gt(0);

    const safeAmount = unlocked / 10n; // use a safe fraction of unlocked amount
    await expect(airdrop.setClaimable(user1.address, safeAmount)).to.not.be.reverted;
  });

  it("should allow claim and reset claimable balance", async () => {
    const { airdrop, token, user1, cliff } = await loadFixture(deployFixture);
    await time.increase(cliff + 100);
    const claimAmount = ethers.parseEther("50");

    await airdrop.setClaimable(user1.address, claimAmount);
    await airdrop.connect(user1).claim();

    expect(await token.balanceOf(user1.address)).to.equal(claimAmount);
    expect(await airdrop.getClaimableAmount(user1.address)).to.equal(0n);
  });

  it("should not allow claim more than unlocked", async () => {
    const { airdrop, user1, user2, duration, cliff } = await loadFixture(deployFixture);
    await time.increase(cliff + Math.floor(duration / 2));
  
    const unlocked = await airdrop.getUnlockedReserves();
    console.log(`unlocked: ${unlocked}`);
  
    await airdrop.setClaimable(user2.address, unlocked);
  
    await expect(airdrop.setClaimable(user1.address, ethers.parseEther("200"))).to.be.revertedWith("Exceeds unlocked tokens");

    await airdrop.connect(user2).claim();
  });

  it("should unlock 100% after full duration", async () => {
    const { airdrop, totalReserves, duration, cliff } = await loadFixture(deployFixture);
    await time.increase(cliff + duration);

    const unlocked = await airdrop.getUnlockedReserves();
    expect(unlocked).to.equal(totalReserves);
  });

  it("should revert on claim when nothing is claimable", async () => {
    const { airdrop, user1 } = await loadFixture(deployFixture);
    await expect(airdrop.connect(user1).claim()).to.be.revertedWith("Nothing to claim");
  });

  it("should correctly update allocation without double-counting", async () => {
    const { airdrop, user1, cliff } = await loadFixture(deployFixture);

    const now = await time.latest();
    const fixedTime = now + cliff + 100;
    await time.setNextBlockTimestamp(fixedTime);
    await ethers.provider.send("evm_mine"); // freeze timestamp

    const unlocked = await airdrop.getUnlockedReserves();
    const half = unlocked / 2n;

    await airdrop.setClaimable(user1.address, half);
    await airdrop.setClaimable(user1.address, half);

    const unallocated = await airdrop.getUnallocatedReserves();
    const expected = unlocked - half;

    expect(unallocated).to.be.closeTo(expected, ethers.parseEther("200"));
  });

  it("should accumulate reservesAllocated across multiple users", async () => {
    const { airdrop, user1, user2, cliff } = await loadFixture(deployFixture);
    await time.increase(cliff + 100);
  
    const unlocked = await airdrop.getUnlockedReserves();
    const portion = unlocked / 4n;
  
    await airdrop.setClaimable(user1.address, portion);
    await airdrop.setClaimable(user2.address, portion);
  
    const totalAllocated = await airdrop.reservesAllocated();
    expect(totalAllocated).to.equal(portion * 2n);
  });
});