const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenVesting", function () {
  let tokenVesting;
  let token;
  let owner;
  let beneficiary;
  let otherAccount;

  const TOKEN_NAME = "TestToken";
  const TOKEN_SYMBOL = "TT";
  const INITIAL_SUPPLY = ethers.parseEther("1000000");

  beforeEach(async function () {
    [owner, beneficiary, otherAccount] = await ethers.getSigners();

    // Deploy BenchmarkERC20 token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy(TOKEN_NAME, TOKEN_SYMBOL);
    await token.waitForDeployment();

    // Mint tokens to owner
    await token.mint(owner.address, INITIAL_SUPPLY);

    // Deploy TokenVesting contract
    const TokenVesting = await ethers.getContractFactory("TokenVesting");
    tokenVesting = await TokenVesting.deploy(await token.getAddress());
    await tokenVesting.waitForDeployment();

    // Approve vesting contract to spend tokens
    await token.approve(await tokenVesting.getAddress(), INITIAL_SUPPLY);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await tokenVesting.owner()).to.equal(owner.address);
    });

    it("Should set the right token address", async function () {
      expect(await tokenVesting.token()).to.equal(await token.getAddress());
    });
  });

  describe("Grant Creation", function () {
    it("Should create a grant with valid parameters", async function () {
      const now = Math.floor(Date.now() / 1000);
      const start = now + 1000; // 1000 seconds in the future
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 180 * 24 * 60 * 60; // 180 days
      const total = 1000n;

      await expect(tokenVesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration))
        .to.emit(tokenVesting, "GrantCreated")
        .withArgs(beneficiary.address, 0, total, start, start + cliffDuration, start + vestingDuration);

      const grantCount = await tokenVesting.grantCount(beneficiary.address);
      expect(grantCount).to.equal(1);
    });

    it("Should revert when creating a grant with zero address", async function () {
      const now = Math.floor(Date.now() / 1000);
      const start = now + 1000;
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 180 * 24 * 60 * 60;
      const total = 1000n;

      await expect(tokenVesting.createGrant(ethers.ZeroAddress, total, start, cliffDuration, vestingDuration))
        .to.be.revertedWith("Zero address");
    });

    it("Should revert when creating a grant with zero amount", async function () {
      const now = Math.floor(Date.now() / 1000);
      const start = now + 1000;
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 180 * 24 * 60 * 60;

      await expect(tokenVesting.createGrant(beneficiary.address, 0, start, cliffDuration, vestingDuration))
        .to.be.revertedWith("Zero amount");
    });

    it("Should revert when creating a grant with zero duration", async function () {
      const now = Math.floor(Date.now() / 1000);
      const start = now + 1000;
      const cliffDuration = 30 * 24 * 60 * 60;

      await expect(tokenVesting.createGrant(beneficiary.address, 1000n, start, cliffDuration, 0))
        .to.be.revertedWith("Zero duration");
    });

    it("Should revert when creating a grant with end before cliff", async function () {
      const now = Math.floor(Date.now() / 1000);
      const start = now + 1000;
      const cliffDuration = 180 * 24 * 60 * 60; // 180 days
      const vestingDuration = 30 * 24 * 60 * 60; // 30 days

      await expect(tokenVesting.createGrant(beneficiary.address, 1000n, start, cliffDuration, vestingDuration))
        .to.be.revertedWith("End before cliff");
    });
  });

  describe("Grant Revocation", function () {
    it("Should revoke a grant and emit event", async function () {
      const now = Math.floor(Date.now() / 1000);
      const start = now + 1000;
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 180 * 24 * 60 * 60;
      const total = 1000n;

      await tokenVesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration);

      // Fast forward to after cliff but before end
      await ethers.provider.send("evm_increaseTime", [cliffDuration + 1000]);
      await ethers.provider.send("evm_mine");

      await expect(tokenVesting.revokeGrant(beneficiary.address, 0))
        .to.emit(tokenVesting, "GrantRevoked")
        .withArgs(beneficiary.address, 0, total);
    });

    it("Should revert when revoking a grant from non-owner", async function () {
      const now = Math.floor(Date.now() / 1000);
      const start = now + 1000;
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 180 * 24 * 60 * 60;
      const total = 1000n;

      await tokenVesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration);

      await expect(tokenVesting.connect(otherAccount).revokeGrant(beneficiary.address, 0))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Token Claiming", function () {
    it("Should allow beneficiary to claim tokens after cliff", async function () {
      const now = Math.floor(Date.now() / 1000);
      const start = now + 1000;
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 180 * 24 * 60 * 60;
      const total = 1000n;

      await tokenVesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration);

      // Fast forward to after cliff
      await ethers.provider.send("evm_increaseTime", [cliffDuration + 1000]);
      await ethers.provider.send("evm_mine");

      const claimable = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimable).to.be.gt(0);

      await expect(tokenVesting.connect(beneficiary).claim(0))
        .to.emit(tokenVesting, "TokensClaimed")
        .withArgs(beneficiary.address, 0, claimable);
    });

    it("Should revert when claiming before cliff", async function () {
      const now = Math.floor(Date.now() / 1000);
      const start = now + 1000;
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 180 * 24 * 60 * 60;
      const total = 1000n;

      await tokenVesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration);

      await expect(tokenVesting.connect(beneficiary).claim(0))
        .to.be.revertedWith("Nothing to claim");
    });

    it("Should revert when claiming from non-beneficiary", async function () {
      const now = Math.floor(Date.now() / 1000);
      const start = now + 1000;
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 180 * 24 * 60 * 60;
      const total = 1000n;

      await tokenVesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration);

      // Fast forward to after cliff
      await ethers.provider.send("evm_increaseTime", [cliffDuration + 1000]);
      await ethers.provider.send("evm_mine");

      await expect(tokenVesting.connect(otherAccount).claim(0))
        .to.be.revertedWith("Nothing to claim");
    });
  });

  describe("View Functions", function () {
    it("Should return correct claimable amount", async function () {
      const now = Math.floor(Date.now() / 1000);
      const start = now + 1000;
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 180 * 24 * 60 * 60;
      const total = 1000n;

      await tokenVesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration);

      // Before cliff
      let claimable = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimable).to.equal(0);

      // After cliff but before end
      await ethers.provider.send("evm_increaseTime", [cliffDuration + 1000]);
      await ethers.provider.send("evm_mine");

      claimable = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimable).to.be.gt(0);
      expect(claimable).to.be.lt(total);

      // After end
      await ethers.provider.send("evm_increaseTime", [vestingDuration - cliffDuration]);
      await ethers.provider.send("evm_mine");

      claimable = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimable).to.equal(total);
    });

    it("Should return correct grant count", async function () {
      const now = Math.floor(Date.now() / 1000);
      const start = now + 1000;
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 180 * 24 * 60 * 60;
      const total = 1000n;

      let count = await tokenVesting.grantCount(beneficiary.address);
      expect(count).to.equal(0);

      await tokenVesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration);

      count = await tokenVesting.grantCount(beneficiary.address);
      expect(count).to.equal(1);
    });
  });
});