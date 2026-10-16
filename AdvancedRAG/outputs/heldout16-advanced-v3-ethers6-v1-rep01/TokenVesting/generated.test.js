const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenVesting", function () {
  let token, vesting, owner, beneficiary, other;
  const TOTAL_SUPPLY = 1000000n;
  const TOKEN_NAME = "Test Token";
  const TOKEN_SYMBOL = "TEST";

  beforeEach(async function () {
    [owner, beneficiary, other] = await ethers.getSigners();

    // Deploy token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy(TOKEN_NAME, TOKEN_SYMBOL);
    await token.waitForDeployment();

    // Mint tokens to owner
    await token.mint(owner.address, TOTAL_SUPPLY);

    // Deploy vesting
    const TokenVesting = await ethers.getContractFactory("TokenVesting");
    vesting = await TokenVesting.deploy(await token.getAddress());
    await vesting.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct token and owner", async function () {
      expect(await vesting.token()).to.equal(await token.getAddress());
      expect(await vesting.owner()).to.equal(owner.address);
    });
  });

  describe("Grant Creation", function () {
    it("Should create a grant with correct parameters", async function () {
      const total = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      // Approve tokens for vesting contract
      await token.approve(await vesting.getAddress(), total);

      await expect(vesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration))
        .to.emit(vesting, "GrantCreated")
        .withArgs(beneficiary.address, 0, total, start, start + cliffDuration, start + vestingDuration);

      const grant = await vesting.grants(beneficiary.address, 0);
      expect(grant.total).to.equal(total);
      expect(grant.claimed).to.equal(0);
      expect(grant.start).to.equal(start);
      expect(grant.cliff).to.equal(start + cliffDuration);
      expect(grant.end).to.equal(start + vestingDuration);
    });

    it("Should revert if beneficiary is zero address", async function () {
      const total = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 365 * 24 * 60 * 60;

      await expect(vesting.createGrant(ethers.ZeroAddress, total, start, cliffDuration, vestingDuration))
        .to.be.revertedWith("Zero address");
    });

    it("Should revert if total is zero", async function () {
      const total = 0n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 365 * 24 * 60 * 60;

      await expect(vesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration))
        .to.be.revertedWith("Zero amount");
    });

    it("Should revert if vesting duration is zero", async function () {
      const total = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 0;

      await expect(vesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration))
        .to.be.revertedWith("Zero duration");
    });

    it("Should revert if end is before cliff", async function () {
      const total = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 365 * 24 * 60 * 60; // 1 year
      const vestingDuration = 30 * 24 * 60 * 60; // 30 days

      await expect(vesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration))
        .to.be.revertedWith("End before cliff");
    });
  });

  describe("Grant Revocation", function () {
    it("Should revoke a grant and emit event", async function () {
      const total = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      // Approve tokens for vesting contract
      await token.approve(await vesting.getAddress(), total);

      // Create grant
      await vesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration);

      // Fast forward to halfway through vesting period
      const halfway = start + (vestingDuration / 2n);
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(halfway)]);
      await ethers.provider.send("evm_mine");

      // Revoke grant
      const vestedAmount = await vesting.claimable(beneficiary.address, 0);
      const unreleased = total - vestedAmount;

      await expect(vesting.revokeGrant(beneficiary.address, 0))
        .to.emit(vesting, "GrantRevoked")
        .withArgs(beneficiary.address, 0, unreleased);

      const grant = await vesting.grants(beneficiary.address, 0);
      expect(grant.total).to.equal(vestedAmount);
    });

    it("Should revert if not owner", async function () {
      const total = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 365 * 24 * 60 * 60;

      // Approve tokens for vesting contract
      await token.approve(await vesting.getAddress(), total);

      // Create grant
      await vesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration);

      await expect(vesting.connect(other).revokeGrant(beneficiary.address, 0))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Token Claiming", function () {
    it("Should allow beneficiary to claim vested tokens", async function () {
      const total = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      // Approve tokens for vesting contract
      await token.approve(await vesting.getAddress(), total);

      // Create grant
      await vesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration);

      // Fast forward past cliff
      const afterCliff = start + cliffDuration + 1000;
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(afterCliff)]);
      await ethers.provider.send("evm_mine");

      // Claim tokens
      const claimableAmount = await vesting.claimable(beneficiary.address, 0);
      await expect(vesting.connect(beneficiary).claim(0))
        .to.emit(vesting, "TokensClaimed")
        .withArgs(beneficiary.address, 0, claimableAmount);

      const grant = await vesting.grants(beneficiary.address, 0);
      expect(grant.claimed).to.equal(claimableAmount);
    });

    it("Should revert if nothing to claim", async function () {
      const total = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      // Approve tokens for vesting contract
      await token.approve(await vesting.getAddress(), total);

      // Create grant
      await vesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration);

      // Try to claim before cliff
      await expect(vesting.connect(beneficiary).claim(0))
        .to.be.revertedWith("Nothing to claim");
    });

    it("Should revert if transfer fails", async function () {
      const total = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      // Approve tokens for vesting contract
      await token.approve(await vesting.getAddress(), total);

      // Create grant
      await vesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration);

      // Fast forward past cliff
      const afterCliff = start + cliffDuration + 1000;
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(afterCliff)]);
      await ethers.provider.send("evm_mine");

      // Revoke all tokens from vesting contract
      await token.burnFrom(await vesting.getAddress(), total);

      // Try to claim
      await expect(vesting.connect(beneficiary).claim(0))
        .to.be.revertedWith("Transfer failed");
    });
  });

  describe("View Functions", function () {
    it("Should return correct claimable amount", async function () {
      const total = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      // Approve tokens for vesting contract
      await token.approve(await vesting.getAddress(), total);

      // Create grant
      await vesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration);

      // Before cliff
      expect(await vesting.claimable(beneficiary.address, 0)).to.equal(0);

      // After cliff but before end
      const halfway = start + (vestingDuration / 2n);
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(halfway)]);
      await ethers.provider.send("evm_mine");

      const expectedClaimable = (total * (halfway - start)) / vestingDuration;
      expect(await vesting.claimable(beneficiary.address, 0)).to.equal(expectedClaimable);

      // After end
      const afterEnd = start + vestingDuration + 1000;
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(afterEnd)]);
      await ethers.provider.send("evm_mine");

      expect(await vesting.claimable(beneficiary.address, 0)).to.equal(total);
    });

    it("Should return correct grant count", async function () {
      const total = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      // Approve tokens for vesting contract
      await token.approve(await vesting.getAddress(), total);

      // Create first grant
      await vesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration);
      expect(await vesting.grantCount(beneficiary.address)).to.equal(1);

      // Create second grant
      await vesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration);
      expect(await vesting.grantCount(beneficiary.address)).to.equal(2);

      // Check for other address
      expect(await vesting.grantCount(other.address)).to.equal(0);
    });
  });

  describe("Vesting Schedule", function () {
    it("Should calculate vested amount correctly", async function () {
      const total = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      // Approve tokens for vesting contract
      await token.approve(await vesting.getAddress(), total);

      // Create grant
      await vesting.createGrant(beneficiary.address, total, start, cliffDuration, vestingDuration);

      // Before start
      expect(await vesting.claimable(beneficiary.address, 0)).to.equal(0);

      // After cliff but before end
      const halfway = start + (vestingDuration / 2n);
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(halfway)]);
      await ethers.provider.send("evm_mine");

      const expectedVested = (total * (halfway - start)) / vestingDuration;
      expect(await vesting.claimable(beneficiary.address, 0)).to.equal(expectedVested);

      // After end
      const afterEnd = start + vestingDuration + 1000;
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(afterEnd)]);
      await ethers.provider.send("evm_mine");

      expect(await vesting.claimable(beneficiary.address, 0)).to.equal(total);
    });
  });
});