const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenVesting", function () {
  let tokenVesting;
  let token;
  let owner;
  let beneficiary;
  let otherAccount;

  const TOTAL_AMOUNT = 1000n;
  const START_TIME = Math.floor(Date.now() / 1000) + 1000; // 1000 seconds in the future
  const CLIFF_DURATION = 3600; // 1 hour
  const VESTING_DURATION = 7200; // 2 hours

  beforeEach(async function () {
    [owner, beneficiary, otherAccount] = await ethers.getSigners();

    // Deploy BenchmarkERC20 token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Deploy TokenVesting contract
    const TokenVesting = await ethers.getContractFactory("TokenVesting");
    tokenVesting = await TokenVesting.deploy(await token.getAddress());
    await tokenVesting.waitForDeployment();

    // Mint tokens to the vesting contract
    await token.mint(await tokenVesting.getAddress(), TOTAL_AMOUNT);
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
    it("Should create a grant with correct parameters", async function () {
      await expect(tokenVesting.createGrant(beneficiary.address, TOTAL_AMOUNT, START_TIME, CLIFF_DURATION, VESTING_DURATION))
        .to.emit(tokenVesting, "GrantCreated")
        .withArgs(beneficiary.address, 0, TOTAL_AMOUNT, START_TIME, START_TIME + CLIFF_DURATION, START_TIME + VESTING_DURATION);

      const grant = await tokenVesting.grants(beneficiary.address, 0);
      expect(grant.total).to.equal(TOTAL_AMOUNT);
      expect(grant.claimed).to.equal(0);
      expect(grant.start).to.equal(START_TIME);
      expect(grant.cliff).to.equal(START_TIME + CLIFF_DURATION);
      expect(grant.end).to.equal(START_TIME + VESTING_DURATION);
    });

    it("Should revert with zero address", async function () {
      await expect(tokenVesting.createGrant(ethers.ZeroAddress, TOTAL_AMOUNT, START_TIME, CLIFF_DURATION, VESTING_DURATION))
        .to.be.revertedWith("Zero address");
    });

    it("Should revert with zero amount", async function () {
      await expect(tokenVesting.createGrant(beneficiary.address, 0, START_TIME, CLIFF_DURATION, VESTING_DURATION))
        .to.be.revertedWith("Zero amount");
    });

    it("Should revert with zero duration", async function () {
      await expect(tokenVesting.createGrant(beneficiary.address, TOTAL_AMOUNT, START_TIME, CLIFF_DURATION, 0))
        .to.be.revertedWith("Zero duration");
    });

    it("Should revert when end is before cliff", async function () {
      await expect(tokenVesting.createGrant(beneficiary.address, TOTAL_AMOUNT, START_TIME, VESTING_DURATION, CLIFF_DURATION))
        .to.be.revertedWith("End before cliff");
    });

    it("Should only allow owner to create grants", async function () {
      await expect(tokenVesting.connect(otherAccount).createGrant(beneficiary.address, TOTAL_AMOUNT, START_TIME, CLIFF_DURATION, VESTING_DURATION))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Grant Revocation", function () {
    beforeEach(async function () {
      await tokenVesting.createGrant(beneficiary.address, TOTAL_AMOUNT, START_TIME, CLIFF_DURATION, VESTING_DURATION);
    });

    it("Should revoke a grant and emit event", async function () {
      // Fast forward to after cliff but before end
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + CLIFF_DURATION + 1000]);

      const grantBefore = await tokenVesting.grants(beneficiary.address, 0);
      const vestedAmount = await tokenVesting.claimable(beneficiary.address, 0);

      await expect(tokenVesting.revokeGrant(beneficiary.address, 0))
        .to.emit(tokenVesting, "GrantRevoked")
        .withArgs(beneficiary.address, 0, TOTAL_AMOUNT - vestedAmount);

      const grantAfter = await tokenVesting.grants(beneficiary.address, 0);
      expect(grantAfter.total).to.equal(vestedAmount);
    });

    it("Should only allow owner to revoke grants", async function () {
      await expect(tokenVesting.connect(otherAccount).revokeGrant(beneficiary.address, 0))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Token Claiming", function () {
    beforeEach(async function () {
      await tokenVesting.createGrant(beneficiary.address, TOTAL_AMOUNT, START_TIME, CLIFF_DURATION, VESTING_DURATION);
    });

    it("Should allow claiming after cliff", async function () {
      // Fast forward to after cliff
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + CLIFF_DURATION + 1000]);

      const claimableAmount = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimableAmount).to.be.gt(0);

      await expect(tokenVesting.connect(beneficiary).claim(0))
        .to.emit(tokenVesting, "TokensClaimed")
        .withArgs(beneficiary.address, 0, claimableAmount);

      const grant = await tokenVesting.grants(beneficiary.address, 0);
      expect(grant.claimed).to.equal(claimableAmount);
    });

    it("Should not allow claiming before cliff", async function () {
      // Fast forward to before cliff
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + CLIFF_DURATION - 1000]);

      await expect(tokenVesting.connect(beneficiary).claim(0))
        .to.be.revertedWith("Nothing to claim");
    });

    it("Should not allow claiming after end", async function () {
      // Fast forward to after end
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + VESTING_DURATION + 1000]);

      const claimableAmount = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimableAmount).to.equal(TOTAL_AMOUNT);

      await expect(tokenVesting.connect(beneficiary).claim(0))
        .to.emit(tokenVesting, "TokensClaimed")
        .withArgs(beneficiary.address, 0, TOTAL_AMOUNT);

      // Try to claim again
      await expect(tokenVesting.connect(beneficiary).claim(0))
        .to.be.revertedWith("Nothing to claim");
    });

    it("Should not allow non-beneficiary to claim", async function () {
      await expect(tokenVesting.connect(otherAccount).claim(0))
        .to.be.revertedWith("Nothing to claim");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await tokenVesting.createGrant(beneficiary.address, TOTAL_AMOUNT, START_TIME, CLIFF_DURATION, VESTING_DURATION);
    });

    it("Should return correct claimable amount", async function () {
      // Before cliff
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + CLIFF_DURATION - 1000]);
      expect(await tokenVesting.claimable(beneficiary.address, 0)).to.equal(0);

      // After cliff but before end
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + CLIFF_DURATION + 1000]);
      const claimableAmount = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimableAmount).to.be.gt(0);
      expect(claimableAmount).to.be.lt(TOTAL_AMOUNT);

      // After end
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + VESTING_DURATION + 1000]);
      expect(await tokenVesting.claimable(beneficiary.address, 0)).to.equal(TOTAL_AMOUNT);
    });

    it("Should return correct grant count", async function () {
      expect(await tokenVesting.grantCount(beneficiary.address)).to.equal(1);

      await tokenVesting.createGrant(beneficiary.address, TOTAL_AMOUNT, START_TIME + VESTING_DURATION + 1000, CLIFF_DURATION, VESTING_DURATION);
      expect(await tokenVesting.grantCount(beneficiary.address)).to.equal(2);
    });
  });
});