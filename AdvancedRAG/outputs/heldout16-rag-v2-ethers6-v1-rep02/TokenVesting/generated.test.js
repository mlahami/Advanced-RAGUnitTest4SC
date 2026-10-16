const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenVesting", function () {
  let tokenVesting;
  let token;
  let owner;
  let beneficiary;
  let other;

  const TOTAL_GRANT = 1000n;
  const START_TIME = Math.floor(Date.now() / 1000) + 1000;
  const CLIFF_DURATION = 30 * 24 * 60 * 60; // 30 days
  const VESTING_DURATION = 365 * 24 * 60 * 60; // 1 year

  beforeEach(async function () {
    [owner, beneficiary, other] = await ethers.getSigners();

    // Deploy mock ERC20 token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Deploy TokenVesting contract
    const TokenVesting = await ethers.getContractFactory("TokenVesting");
    tokenVesting = await TokenVesting.deploy(await token.getAddress());
    await tokenVesting.waitForDeployment();

    // Mint tokens to owner and approve vesting contract
    await token.mint(owner.address, ethers.parseEther("1000000"));
    await token.approve(await tokenVesting.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the correct token address", async function () {
      expect(await tokenVesting.token()).to.equal(await token.getAddress());
    });

    it("Should set the correct owner", async function () {
      expect(await tokenVesting.owner()).to.equal(owner.address);
    });
  });

  describe("createGrant", function () {
    it("Should create a new grant", async function () {
      const tx = await tokenVesting.createGrant(
        beneficiary.address,
        TOTAL_GRANT,
        START_TIME,
        CLIFF_DURATION,
        VESTING_DURATION
      );

      await expect(tx)
        .to.emit(tokenVesting, "GrantCreated")
        .withArgs(beneficiary.address, 0, TOTAL_GRANT, START_TIME, START_TIME + CLIFF_DURATION, START_TIME + VESTING_DURATION);

      const grantCount = await tokenVesting.grantCount(beneficiary.address);
      expect(grantCount).to.equal(1);

      const grant = await tokenVesting.grants(beneficiary.address, 0);
      expect(grant.total).to.equal(TOTAL_GRANT);
      expect(grant.claimed).to.equal(0);
      expect(grant.start).to.equal(START_TIME);
      expect(grant.cliff).to.equal(START_TIME + CLIFF_DURATION);
      expect(grant.end).to.equal(START_TIME + VESTING_DURATION);
    });

    it("Should revert if beneficiary is zero address", async function () {
      await expect(
        tokenVesting.createGrant(
          ethers.ZeroAddress,
          TOTAL_GRANT,
          START_TIME,
          CLIFF_DURATION,
          VESTING_DURATION
        )
      ).to.be.revertedWith("Zero address");
    });

    it("Should revert if total is zero", async function () {
      await expect(
        tokenVesting.createGrant(
          beneficiary.address,
          0,
          START_TIME,
          CLIFF_DURATION,
          VESTING_DURATION
        )
      ).to.be.revertedWith("Zero amount");
    });

    it("Should revert if vesting duration is zero", async function () {
      await expect(
        tokenVesting.createGrant(
          beneficiary.address,
          TOTAL_GRANT,
          START_TIME,
          CLIFF_DURATION,
          0
        )
      ).to.be.revertedWith("Zero duration");
    });

    it("Should revert if end is before cliff", async function () {
      await expect(
        tokenVesting.createGrant(
          beneficiary.address,
          TOTAL_GRANT,
          START_TIME,
          VESTING_DURATION,
          CLIFF_DURATION
        )
      ).to.be.revertedWith("End before cliff");
    });

    it("Should revert if called by non-owner", async function () {
      await expect(
        tokenVesting.connect(other).createGrant(
          beneficiary.address,
          TOTAL_GRANT,
          START_TIME,
          CLIFF_DURATION,
          VESTING_DURATION
        )
      ).to.be.revertedWith("Not owner");
    });
  });

  describe("revokeGrant", function () {
    beforeEach(async function () {
      await tokenVesting.createGrant(
        beneficiary.address,
        TOTAL_GRANT,
        START_TIME,
        CLIFF_DURATION,
        VESTING_DURATION
      );
    });

    it("Should revoke a grant", async function () {
      // Fast forward to after cliff but before end
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + CLIFF_DURATION + 1000]);
      await ethers.provider.send("evm_mine");

      const tx = await tokenVesting.revokeGrant(beneficiary.address, 0);
      const grant = await tokenVesting.grants(beneficiary.address, 0);

      // Calculate expected vested amount
      const elapsed = (START_TIME + CLIFF_DURATION + 1000) - START_TIME;
      const duration = VESTING_DURATION;
      const expectedVested = (BigInt(TOTAL_GRANT) * BigInt(elapsed)) / BigInt(duration);

      await expect(tx)
        .to.emit(tokenVesting, "GrantRevoked")
        .withArgs(beneficiary.address, 0, TOTAL_GRANT - expectedVested);

      expect(grant.total).to.equal(expectedVested);
    });

    it("Should revert if called by non-owner", async function () {
      await expect(
        tokenVesting.connect(other).revokeGrant(beneficiary.address, 0)
      ).to.be.revertedWith("Not owner");
    });
  });

  describe("claim", function () {
    beforeEach(async function () {
      await tokenVesting.createGrant(
        beneficiary.address,
        TOTAL_GRANT,
        START_TIME,
        CLIFF_DURATION,
        VESTING_DURATION
      );
    });

    it("Should allow claiming after cliff", async function () {
      // Fast forward to after cliff
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + CLIFF_DURATION + 1000]);
      await ethers.provider.send("evm_mine");

      const tx = await tokenVesting.connect(beneficiary).claim(0);
      const grant = await tokenVesting.grants(beneficiary.address, 0);

      // Calculate expected vested amount
      const elapsed = (START_TIME + CLIFF_DURATION + 1000) - START_TIME;
      const duration = VESTING_DURATION;
      const expectedVested = (BigInt(TOTAL_GRANT) * BigInt(elapsed)) / BigInt(duration);

      await expect(tx)
        .to.emit(tokenVesting, "TokensClaimed")
        .withArgs(beneficiary.address, 0, expectedVested);

      expect(grant.claimed).to.equal(expectedVested);
      expect(await token.balanceOf(beneficiary.address)).to.equal(expectedVested);
    });

    it("Should not allow claiming before cliff", async function () {
      await expect(
        tokenVesting.connect(beneficiary).claim(0)
      ).to.be.revertedWith("Nothing to claim");
    });

    it("Should allow claiming full amount after vesting period", async function () {
      // Fast forward to after vesting period
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + VESTING_DURATION + 1000]);
      await ethers.provider.send("evm_mine");

      const tx = await tokenVesting.connect(beneficiary).claim(0);
      const grant = await tokenVesting.grants(beneficiary.address, 0);

      await expect(tx)
        .to.emit(tokenVesting, "TokensClaimed")
        .withArgs(beneficiary.address, 0, TOTAL_GRANT);

      expect(grant.claimed).to.equal(TOTAL_GRANT);
      expect(await token.balanceOf(beneficiary.address)).to.equal(TOTAL_GRANT);
    });

    it("Should revert if nothing to claim", async function () {
      // Fast forward to after cliff
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + CLIFF_DURATION + 1000]);
      await ethers.provider.send("evm_mine");

      // Claim first time
      await tokenVesting.connect(beneficiary).claim(0);

      // Try to claim again
      await expect(
        tokenVesting.connect(beneficiary).claim(0)
      ).to.be.revertedWith("Nothing to claim");
    });
  });

  describe("claimable", function () {
    beforeEach(async function () {
      await tokenVesting.createGrant(
        beneficiary.address,
        TOTAL_GRANT,
        START_TIME,
        CLIFF_DURATION,
        VESTING_DURATION
      );
    });

    it("Should return 0 before cliff", async function () {
      const claimable = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimable).to.equal(0);
    });

    it("Should return correct amount after cliff but before end", async function () {
      // Fast forward to after cliff
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + CLIFF_DURATION + 1000]);
      await ethers.provider.send("evm_mine");

      const elapsed = (START_TIME + CLIFF_DURATION + 1000) - START_TIME;
      const duration = VESTING_DURATION;
      const expectedClaimable = (BigInt(TOTAL_GRANT) * BigInt(elapsed)) / BigInt(duration);

      const claimable = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimable).to.equal(expectedClaimable);
    });

    it("Should return total amount after vesting period", async function () {
      // Fast forward to after vesting period
      await ethers.provider.send("evm_setNextBlockTimestamp", [START_TIME + VESTING_DURATION + 1000]);
      await ethers.provider.send("evm_mine");

      const claimable = await tokenVesting.claimable(beneficiary.address, 0);
      expect(claimable).to.equal(TOTAL_GRANT);
    });
  });

  describe("grantCount", function () {
    it("Should return correct grant count", async function () {
      expect(await tokenVesting.grantCount(beneficiary.address)).to.equal(0);

      await tokenVesting.createGrant(
        beneficiary.address,
        TOTAL_GRANT,
        START_TIME,
        CLIFF_DURATION,
        VESTING_DURATION
      );

      expect(await tokenVesting.grantCount(beneficiary.address)).to.equal(1);

      await tokenVesting.createGrant(
        beneficiary.address,
        TOTAL_GRANT,
        START_TIME,
        CLIFF_DURATION,
        VESTING_DURATION
      );

      expect(await tokenVesting.grantCount(beneficiary.address)).to.equal(2);
    });
  });
});