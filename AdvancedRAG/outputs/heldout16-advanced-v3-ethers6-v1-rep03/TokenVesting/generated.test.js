const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenVesting", function () {
  let token, vesting, owner, beneficiary, other;
  const TOKEN_NAME = "Test Token";
  const TOKEN_SYMBOL = "TEST";
  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const DECIMALS = 18;

  beforeEach(async function () {
    [owner, beneficiary, other] = await ethers.getSigners();

    // Deploy token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy(TOKEN_NAME, TOKEN_SYMBOL);
    await token.waitForDeployment();

    // Mint tokens to owner
    await token.mint(owner.address, INITIAL_SUPPLY);

    // Deploy vesting
    const TokenVesting = await ethers.getContractFactory("TokenVesting");
    vesting = await TokenVesting.deploy(await token.getAddress());
    await vesting.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await vesting.owner()).to.equal(owner.address);
    });

    it("Should set the right token", async function () {
      expect(await vesting.token()).to.equal(await token.getAddress());
    });
  });

  describe("Grant Creation", function () {
    it("Should create a grant with correct parameters", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      await token.approve(await vesting.getAddress(), amount);

      await expect(vesting.createGrant(beneficiary.address, amount, start, cliffDuration, vestingDuration))
        .to.emit(vesting, "GrantCreated")
        .withArgs(beneficiary.address, 0, amount, start, start + cliffDuration, start + vestingDuration);

      const grant = await vesting.grants(beneficiary.address, 0);
      expect(grant.total).to.equal(amount);
      expect(grant.claimed).to.equal(0);
      expect(grant.start).to.equal(start);
      expect(grant.cliff).to.equal(start + cliffDuration);
      expect(grant.end).to.equal(start + vestingDuration);
    });

    it("Should revert if beneficiary is zero address", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 365 * 24 * 60 * 60;

      await expect(vesting.createGrant(ethers.ZeroAddress, amount, start, cliffDuration, vestingDuration))
        .to.be.revertedWith("Zero address");
    });

    it("Should revert if amount is zero", async function () {
      const amount = 0n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 365 * 24 * 60 * 60;

      await expect(vesting.createGrant(beneficiary.address, amount, start, cliffDuration, vestingDuration))
        .to.be.revertedWith("Zero amount");
    });

    it("Should revert if vesting duration is zero", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 0;

      await expect(vesting.createGrant(beneficiary.address, amount, start, cliffDuration, vestingDuration))
        .to.be.revertedWith("Zero duration");
    });

    it("Should revert if end is before cliff", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 365 * 24 * 60 * 60; // 1 year
      const vestingDuration = 30 * 24 * 60 * 60; // 30 days

      await expect(vesting.createGrant(beneficiary.address, amount, start, cliffDuration, vestingDuration))
        .to.be.revertedWith("End before cliff");
    });
  });

  describe("Grant Revocation", function () {
    it("Should revoke a grant and emit event", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createGrant(beneficiary.address, amount, start, cliffDuration, vestingDuration);

      // Fast forward to halfway through vesting period
      await ethers.provider.send("evm_setNextBlockTimestamp", [start + (vestingDuration / 2)]);
      await ethers.provider.send("evm_mine", []);

      const vestedAmount = await vesting.claimable(beneficiary.address, 0);
      const unreleasedAmount = amount - vestedAmount;

      await expect(vesting.revokeGrant(beneficiary.address, 0))
        .to.emit(vesting, "GrantRevoked")
        .withArgs(beneficiary.address, 0, unreleasedAmount);

      const grant = await vesting.grants(beneficiary.address, 0);
      expect(grant.total).to.equal(vestedAmount);
    });

    it("Should revert if not owner", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 365 * 24 * 60 * 60;

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createGrant(beneficiary.address, amount, start, cliffDuration, vestingDuration);

      await expect(vesting.connect(other).revokeGrant(beneficiary.address, 0))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Token Claiming", function () {
    it("Should allow beneficiary to claim tokens", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createGrant(beneficiary.address, amount, start, cliffDuration, vestingDuration);

      // Fast forward past cliff
      await ethers.provider.send("evm_setNextBlockTimestamp", [start + cliffDuration + 1]);
      await ethers.provider.send("evm_mine", []);

      const claimableAmount = await vesting.claimable(beneficiary.address, 0);

      await expect(vesting.connect(beneficiary).claim(0))
        .to.emit(vesting, "TokensClaimed")
        .withArgs(beneficiary.address, 0, claimableAmount);

      const grant = await vesting.grants(beneficiary.address, 0);
      expect(grant.claimed).to.equal(claimableAmount);
    });

    it("Should revert if nothing to claim", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createGrant(beneficiary.address, amount, start, cliffDuration, vestingDuration);

      // Claim before cliff
      await expect(vesting.connect(beneficiary).claim(0))
        .to.be.revertedWith("Nothing to claim");
    });

    it("Should revert if transfer fails", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createGrant(beneficiary.address, amount, start, cliffDuration, vestingDuration);

      // Fast forward past cliff
      await ethers.provider.send("evm_setNextBlockTimestamp", [start + cliffDuration + 1]);
      await ethers.provider.send("evm_mine", []);

      // Revoke the grant to make transfer fail
      await vesting.revokeGrant(beneficiary.address, 0);

      await expect(vesting.connect(beneficiary).claim(0))
        .to.be.revertedWith("Transfer failed");
    });
  });

  describe("View Functions", function () {
    it("Should return correct claimable amount", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createGrant(beneficiary.address, amount, start, cliffDuration, vestingDuration);

      // Before cliff
      expect(await vesting.claimable(beneficiary.address, 0)).to.equal(0);

      // After cliff but before end
      await ethers.provider.send("evm_setNextBlockTimestamp", [start + cliffDuration + 1]);
      await ethers.provider.send("evm_mine", []);
      const expectedClaimable = amount / 2n; // Halfway through vesting period
      expect(await vesting.claimable(beneficiary.address, 0)).to.be.closeTo(expectedClaimable, 1n);

      // After end
      await ethers.provider.send("evm_setNextBlockTimestamp", [start + vestingDuration + 1]);
      await ethers.provider.send("evm_mine", []);
      expect(await vesting.claimable(beneficiary.address, 0)).to.equal(amount);
    });

    it("Should return correct grant count", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60;
      const vestingDuration = 365 * 24 * 60 * 60;

      expect(await vesting.grantCount(beneficiary.address)).to.equal(0);

      await token.approve(await vesting.getAddress(), amount * 2n);
      await vesting.createGrant(beneficiary.address, amount, start, cliffDuration, vestingDuration);
      await vesting.createGrant(beneficiary.address, amount, start, cliffDuration, vestingDuration);

      expect(await vesting.grantCount(beneficiary.address)).to.equal(2);
    });
  });

  describe("Vesting Calculations", function () {
    it("Should calculate vested amount correctly", async function () {
      const amount = 1000n;
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createGrant(beneficiary.address, amount, start, cliffDuration, vestingDuration);

      // Before start
      expect(await vesting.claimable(beneficiary.address, 0)).to.equal(0);

      // After cliff but before end
      await ethers.provider.send("evm_setNextBlockTimestamp", [start + cliffDuration + 1]);
      await ethers.provider.send("evm_mine", []);
      const expectedClaimable = amount / 2n; // Halfway through vesting period
      expect(await vesting.claimable(beneficiary.address, 0)).to.be.closeTo(expectedClaimable, 1n);

      // After end
      await ethers.provider.send("evm_setNextBlockTimestamp", [start + vestingDuration + 1]);
      await ethers.provider.send("evm_mine", []);
      expect(await vesting.claimable(beneficiary.address, 0)).to.equal(amount);
    });
  });
});