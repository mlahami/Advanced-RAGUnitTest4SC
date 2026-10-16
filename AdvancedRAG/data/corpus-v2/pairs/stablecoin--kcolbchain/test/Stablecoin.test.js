const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Stablecoin", function () {
  let stablecoin, owner, user1, user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    const Stablecoin = await ethers.getContractFactory("Stablecoin");
    stablecoin = await Stablecoin.deploy("Test Stablecoin", "TSTBL", owner.address);
    await stablecoin.waitForDeployment();
  });

  it("should have correct name and symbol", async function () {
    expect(await stablecoin.name()).to.equal("Test Stablecoin");
    expect(await stablecoin.symbol()).to.equal("TSTBL");
  });

  it("should have 6 decimals", async function () {
    expect(await stablecoin.decimals()).to.equal(6);
  });

  it("should allow minter to mint", async function () {
    await stablecoin.mint(user1.address, 1000000n); // 1 token
    expect(await stablecoin.balanceOf(user1.address)).to.equal(1000000n);
  });

  it("should not allow non-minter to mint", async function () {
    await expect(
      stablecoin.connect(user1).mint(user2.address, 1000000n)
    ).to.be.reverted;
  });

  it("should allow pausing and unpausing", async function () {
    await stablecoin.mint(user1.address, 1000000n);
    await stablecoin.pause();

    await expect(
      stablecoin.connect(user1).transfer(user2.address, 500000n)
    ).to.be.reverted;

    await stablecoin.unpause();
    await stablecoin.connect(user1).transfer(user2.address, 500000n);
    expect(await stablecoin.balanceOf(user2.address)).to.equal(500000n);
  });

  it("should allow blacklisting", async function () {
    await stablecoin.mint(user1.address, 1000000n);
    await stablecoin.blacklist(user1.address);

    expect(await stablecoin.isBlacklisted(user1.address)).to.be.true;

    await expect(
      stablecoin.connect(user1).transfer(user2.address, 500000n)
    ).to.be.revertedWithCustomError(stablecoin, "AccountBlacklisted");

    await stablecoin.unblacklist(user1.address);
    await stablecoin.connect(user1).transfer(user2.address, 500000n);
    expect(await stablecoin.balanceOf(user2.address)).to.equal(500000n);
  });

  it("should not mint to blacklisted address", async function () {
    await stablecoin.blacklist(user1.address);
    await expect(
      stablecoin.mint(user1.address, 1000000n)
    ).to.be.revertedWithCustomError(stablecoin, "AccountBlacklisted");
  });
});

describe("ReserveManager", function () {
  let reserveManager, owner;

  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    const ReserveManager = await ethers.getContractFactory("ReserveManager");
    reserveManager = await ReserveManager.deploy(10000); // 100% minimum
    await reserveManager.waitForDeployment();
  });

  it("should track reserves", async function () {
    const assetId = ethers.id("USD_BANK");
    await reserveManager.addReserveAsset(assetId, "USD Bank Deposit", 10000000n);
    expect(await reserveManager.totalReserves()).to.equal(10000000n);
  });

  it("should enforce reserve ratio", async function () {
    const assetId = ethers.id("USD_BANK");
    await reserveManager.addReserveAsset(assetId, "USD Bank Deposit", 5000000n);
    await reserveManager.updateTrackedSupply(10000000n);

    // Ratio is 50% but minimum is 100%
    await expect(
      reserveManager.checkReserveRatio()
    ).to.be.revertedWithCustomError(reserveManager, "ReserveRatioTooLow");
  });

  it("should pass when reserves are sufficient", async function () {
    const assetId = ethers.id("USD_BANK");
    await reserveManager.addReserveAsset(assetId, "USD Bank Deposit", 10000000n);
    await reserveManager.updateTrackedSupply(10000000n);
    await reserveManager.checkReserveRatio(); // should not revert
  });
});
