const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenVesting", function () {
  let tokenVesting, token, owner, beneficiary, other;
  const TOTAL = 1000n;
  const START = Math.floor(Date.now() / 1000) + 1000; // 1000 seconds in the future
  const CLIFF_DURATION = 2000; // 2000 seconds
  const VESTING_DURATION = 5000; // 5000 seconds

  beforeEach(async function () {
    [owner, beneficiary, other] = await ethers.getSigners();

    // Deploy BenchmarkERC20 token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Mint tokens to the vesting contract
    await token.mint(await token.getAddress(), TOTAL);

    // Deploy TokenVesting
    const TokenVesting = await ethers.getContractFactory("TokenVesting");
    tokenVesting = await TokenVesting.connect(owner).deploy(await token.getAddress());
    await tokenVesting.waitForDeployment();

    // Approve vesting contract to spend tokens
    await token.connect(owner).approve(await tokenVesting.getAddress(), TOTAL);
  });

  describe("Deployment", function () {
    it("Should set the correct token and owner", async function () {
      expect(await tokenVesting.token()).to.equal(await token.getAddress());
      expect(await tokenVesting.owner()).to.equal(owner.address);
    });
  });

  describe("createGrant", function () {
    it("Should create a new grant", async function () {
      await expect(tokenVesting.connect(owner).createGrant(beneficiary.address, TOTAL, START, CLIFF_DURATION, VESTING_DURATION))
        .to.emit(tokenVesting, "GrantCreated")
        .withArgs(beneficiary.address, 0, TOTAL, START, START + CLIFF_DURATION, START + VESTING_DURATION);

      const grantCount = await tokenVesting.grantCount(beneficiary.address);
      expect(grantCount).to.equal(1);
    });

    it("Should revert if beneficiary is zero address", async function () {
      await expect(tokenVesting.connect(owner).createGrant(ethers.ZeroAddress, TOTAL, START, CLIFF_DURATION, VESTING_DURATION))
        .to.be.revertedWith("Zero address");
    });

    it("Should revert if total is zero", async function () {
      await expect(tokenVesting.connect(owner).createGrant(beneficiary.address, 0, START, CLIFF_DURATION, VESTING_DURATION))
        .to.be.revertedWith("Zero amount");
    });

    it("Should revert if vesting duration is zero", async function () {
      await expect(tokenVesting.connect(owner).createGrant(beneficiary.address, TOTAL, START, CLIFF_DURATION, 0))
        .to.be.revertedWith("Zero duration");
    });

    it("Should revert if end is before cliff", async function () {
      await expect(tokenVesting.connect(owner).createGrant(beneficiary.address, TOTAL, START, VESTING_DURATION, CLIFF_DURATION))
        .to.be.revertedWith("End before cliff");
    });

    it("Should revert if called by non-owner", async function () {
      await expect(tokenVesting.connect(other).createGrant(beneficiary.address, TOTAL, START, CLIFF_DURATION, VESTING_DURATION))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("revokeGrant", function () {
    beforeEach(async function () {
      await tokenVesting.connect(owner).createGrant(beneficiary.address, TOTAL, START, CLIFF_DURATION, VESTING_DURATION);
    });

    it("Should revoke a grant", async function () {
      // Fast forward to after cliff but before end
      await ethers.provider.send("evm_setNextBlockTimestamp", [START + CLIFF_DURATION + 1000]);

      const vestedAmount = await tokenVesting.claimable(beneficiary.address, 0);
      const unreleased = TOTAL - vestedAmount;

      await expect(tokenVesting.connect(owner).revokeGrant(beneficiary.address, 0))
        .to.emit(tokenVesting, "GrantRevoked")
        .withArgs(beneficiary.address, 0, unreleased);
    });

    it("Should revert if called by non-owner", async function () {
      await expect(tokenVesting.connect(other).revokeGrant(beneficiary.address, 0))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("claim", function () {
    beforeEach(async function () {
      await tokenVesting.connect(owner).createGrant(beneficiary.address, TOTAL, START, CLIFF_DURATION, VESTING_DURATION);
    });

    it("Should allow claiming after cliff", async function () {
      // Fast forward to after cliff
      await ethers.provider.send("evm_setNextBlockTimestamp", [START + CLIFF_DURATION + 1000]);

      const claimable = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimable).to.be.gt(0);

      await expect(tokenVesting.connect(beneficiary).claim(0))
        .to.emit(tokenVesting, "TokensClaimed")
        .withArgs(beneficiary.address, 0, claimable);

      const newClaimable = await tokenVesting.claimable(beneficiary.address, 0);
      expect(newClaimable).to.equal(0);
    });

    it("Should not allow claiming before cliff", async function () {
      // Fast forward to before cliff
      await ethers.provider.send("evm_setNextBlockTimestamp", [START + CLIFF_DURATION - 1000]);

      const claimable = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimable).to.equal(0);

      await expect(tokenVesting.connect(beneficiary).claim(0))
        .to.be.revertedWith("Nothing to claim");
    });

    it("Should allow claiming after vesting ends", async function () {
      // Fast forward to after vesting ends
      await ethers.provider.send("evm_setNextBlockTimestamp", [START + VESTING_DURATION + 1000]);

      const claimable = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimable).to.equal(TOTAL);

      await expect(tokenVesting.connect(beneficiary).claim(0))
        .to.emit(tokenVesting, "TokensClaimed")
        .withArgs(beneficiary.address, 0, TOTAL);

      const newClaimable = await tokenVesting.claimable(beneficiary.address, 0);
      expect(newClaimable).to.equal(0);
    });
  });

  describe("claimable", function () {
    beforeEach(async function () {
      await tokenVesting.connect(owner).createGrant(beneficiary.address, TOTAL, START, CLIFF_DURATION, VESTING_DURATION);
    });

    it("Should return 0 before cliff", async function () {
      // Fast forward to before cliff
      await ethers.provider.send("evm_setNextBlockTimestamp", [START + CLIFF_DURATION - 1000]);

      const claimable = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimable).to.equal(0);
    });

    it("Should return correct amount after cliff", async function () {
      // Fast forward to after cliff but before end
      await ethers.provider.send("evm_setNextBlockTimestamp", [START + CLIFF_DURATION + 1000]);

      const claimable = await tokenVesting.claimable(beneficiary.address, 0);
      const expected = TOTAL * 1000n / VESTING_DURATION;
      expect(claimable).to.equal(expected);
    });

    it("Should return total amount after vesting ends", async function () {
      // Fast forward to after vesting ends
      await ethers.provider.send("evm_setNextBlockTimestamp", [START + VESTING_DURATION + 1000]);

      const claimable = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimable).to.equal(TOTAL);
    });
  });

  describe("grantCount", function () {
    it("Should return correct grant count", async function () {
      expect(await tokenVesting.grantCount(beneficiary.address)).to.equal(0);

      await tokenVesting.connect(owner).createGrant(beneficiary.address, TOTAL, START, CLIFF_DURATION, VESTING_DURATION);
      expect(await tokenVesting.grantCount(beneficiary.address)).to.equal(1);

      await tokenVesting.connect(owner).createGrant(beneficiary.address, TOTAL, START, CLIFF_DURATION, VESTING_DURATION);
      expect(await tokenVesting.grantCount(beneficiary.address)).to.equal(2);
    });
  });
});