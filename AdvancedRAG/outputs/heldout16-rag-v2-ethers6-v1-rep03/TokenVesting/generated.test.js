const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenVesting", function () {
  let tokenVesting;
  let token;
  let owner;
  let beneficiary;
  let otherAccount;

  const TOTAL_GRANT = 1000n;
  const START_TIME = Math.floor(Date.now() / 1000) + 1000; // 1000 seconds in the future
  const CLIFF_DURATION = 30 * 24 * 60 * 60; // 30 days
  const VESTING_DURATION = 365 * 24 * 60 * 60; // 1 year

  beforeEach(async function () {
    [owner, beneficiary, otherAccount] = await ethers.getSigners();

    // Deploy BenchmarkERC20 token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Mint tokens to owner
    await token.mint(owner.address, ethers.parseEther("1000000"));

    // Deploy TokenVesting contract
    const TokenVesting = await ethers.getContractFactory("TokenVesting");
    tokenVesting = await TokenVesting.deploy(await token.getAddress());
    await tokenVesting.waitForDeployment();

    // Approve vesting contract to transfer tokens
    await token.approve(await tokenVesting.getAddress(), ethers.MaxUint256);
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
    it("Should create a grant and emit GrantCreated event", async function () {
      await expect(tokenVesting.createGrant(
        beneficiary.address,
        TOTAL_GRANT,
        START_TIME,
        CLIFF_DURATION,
        VESTING_DURATION
      ))
        .to.emit(tokenVesting, "GrantCreated")
        .withArgs(beneficiary.address, 0, TOTAL_GRANT, START_TIME, START_TIME + CLIFF_DURATION, START_TIME + VESTING_DURATION);
    });

    it("Should revert if beneficiary is zero address", async function () {
      await expect(tokenVesting.createGrant(
        ethers.ZeroAddress,
        TOTAL_GRANT,
        START_TIME,
        CLIFF_DURATION,
        VESTING_DURATION
      )).to.be.revertedWith("Zero address");
    });

    it("Should revert if total amount is zero", async function () {
      await expect(tokenVesting.createGrant(
        beneficiary.address,
        0,
        START_TIME,
        CLIFF_DURATION,
        VESTING_DURATION
      )).to.be.revertedWith("Zero amount");
    });

    it("Should revert if vesting duration is zero", async function () {
      await expect(tokenVesting.createGrant(
        beneficiary.address,
        TOTAL_GRANT,
        START_TIME,
        CLIFF_DURATION,
        0
      )).to.be.revertedWith("Zero duration");
    });

    it("Should revert if end time is before cliff time", async function () {
      await expect(tokenVesting.createGrant(
        beneficiary.address,
        TOTAL_GRANT,
        START_TIME,
        VESTING_DURATION + 1,
        VESTING_DURATION
      )).to.be.revertedWith("End before cliff");
    });

    it("Should not allow non-owner to create grant", async function () {
      await expect(tokenVesting.connect(otherAccount).createGrant(
        beneficiary.address,
        TOTAL_GRANT,
        START_TIME,
        CLIFF_DURATION,
        VESTING_DURATION
      )).to.be.revertedWith("Not owner");
    });
  });

  describe("Grant Revocation", function () {
    beforeEach(async function () {
      await tokenVesting.createGrant(
        beneficiary.address,
        TOTAL_GRANT,
        START_TIME,
        CLIFF_DURATION,
        VESTING_DURATION
      );
    });

    it("Should revoke a grant and emit GrantRevoked event", async function () {
      // Fast forward to after cliff period
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + CLIFF_DURATION + 1000]);
      await ethers.provider.send("evm_mine");

      const grant = await tokenVesting.grants(beneficiary.address, 0);
      const vestedAmount = await tokenVesting._vestedAmount(grant);
      const unreleased = TOTAL_GRANT - vestedAmount;

      await expect(tokenVesting.revokeGrant(beneficiary.address, 0))
        .to.emit(tokenVesting, "GrantRevoked")
        .withArgs(beneficiary.address, 0, unreleased);
    });

    it("Should not allow non-owner to revoke grant", async function () {
      await expect(tokenVesting.connect(otherAccount).revokeGrant(beneficiary.address, 0))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Token Claiming", function () {
    beforeEach(async function () {
      await tokenVesting.createGrant(
        beneficiary.address,
        TOTAL_GRANT,
        START_TIME,
        CLIFF_DURATION,
        VESTING_DURATION
      );
    });

    it("Should allow beneficiary to claim tokens after cliff", async function () {
      // Fast forward to after cliff period
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + CLIFF_DURATION + 1000]);
      await ethers.provider.send("evm_mine");

      const claimableAmount = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimableAmount).to.be.gt(0);

      await expect(tokenVesting.connect(beneficiary).claim(0))
        .to.emit(tokenVesting, "TokensClaimed")
        .withArgs(beneficiary.address, 0, claimableAmount);

      const grant = await tokenVesting.grants(beneficiary.address, 0);
      expect(grant.claimed).to.equal(claimableAmount);
    });

    it("Should not allow claiming before cliff", async function () {
      await expect(tokenVesting.connect(beneficiary).claim(0))
        .to.be.revertedWith("Nothing to claim");
    });

    it("Should not allow claiming more than vested amount", async function () {
      // Fast forward to after cliff but before full vesting
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + CLIFF_DURATION + 1000]);
      await ethers.provider.send("evm_mine");

      const claimableAmount = await tokenVesting.claimable(beneficiary.address, 0);
      await tokenVesting.connect(beneficiary).claim(0);

      // Try to claim again - should revert as nothing more is claimable
      await expect(tokenVesting.connect(beneficiary).claim(0))
        .to.be.revertedWith("Nothing to claim");
    });

    it("Should allow claiming all tokens after vesting period", async function () {
      // Fast forward to after vesting period
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + VESTING_DURATION + 1000]);
      await ethers.provider.send("evm_mine");

      const claimableAmount = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimableAmount).to.equal(TOTAL_GRANT);

      await expect(tokenVesting.connect(beneficiary).claim(0))
        .to.emit(tokenVesting, "TokensClaimed")
        .withArgs(beneficiary.address, 0, TOTAL_GRANT);

      const grant = await tokenVesting.grants(beneficiary.address, 0);
      expect(grant.claimed).to.equal(TOTAL_GRANT);
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await tokenVesting.createGrant(
        beneficiary.address,
        TOTAL_GRANT,
        START_TIME,
        CLIFF_DURATION,
        VESTING_DURATION
      );
    });

    it("Should return correct claimable amount", async function () {
      // Before cliff
      let claimable = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimable).to.equal(0);

      // After cliff but before full vesting
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + CLIFF_DURATION + 1000]);
      await ethers.provider.send("evm_mine");

      claimable = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimable).to.be.gt(0);

      // After full vesting
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + VESTING_DURATION + 1000]);
      await ethers.provider.send("evm_mine");

      claimable = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimable).to.equal(TOTAL_GRANT);
    });

    it("Should return correct grant count", async function () {
      const count = await tokenVesting.grantCount(beneficiary.address);
      expect(count).to.equal(1);

      // Create another grant
      await tokenVesting.createGrant(
        beneficiary.address,
        TOTAL_GRANT,
        START_TIME + VESTING_DURATION + 1000,
        CLIFF_DURATION,
        VESTING_DURATION
      );

      const newCount = await tokenVesting.grantCount(beneficiary.address);
      expect(newCount).to.equal(2);
    });
  });

  describe("Vesting Calculation", function () {
    it("Should calculate vested amount correctly", async function () {
      await tokenVesting.createGrant(
        beneficiary.address,
        TOTAL_GRANT,
        START_TIME,
        CLIFF_DURATION,
        VESTING_DURATION
      );

      // Before cliff
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME - 1000]);
      await ethers.provider.send("evm_mine");

      let grant = await tokenVesting.grants(beneficiary.address, 0);
      let vested = await tokenVesting._vestedAmount(grant);
      expect(vested).to.equal(0);

      // After cliff but before full vesting
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + CLIFF_DURATION + 1000]);
      await ethers.provider.send("evm_mine");

      grant = await tokenVesting.grants(beneficiary.address, 0);
      vested = await tokenVesting._vestedAmount(grant);
      expect(vested).to.be.gt(0);
      expect(vested).to.be.lt(TOTAL_GRANT);

      // After full vesting
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + VESTING_DURATION + 1000]);
      await ethers.provider.send("evm_mine");

      grant = await tokenVesting.grants(beneficiary.address, 0);
      vested = await tokenVesting._vestedAmount(grant);
      expect(vested).to.equal(TOTAL_GRANT);
    });
  });
});