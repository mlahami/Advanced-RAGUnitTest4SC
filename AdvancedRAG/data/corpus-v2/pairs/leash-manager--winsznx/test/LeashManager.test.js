const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const USDC = (n) => ethers.parseUnits(String(n), 6);

describe("LeashManager", () => {
  async function deployFixture() {
    const [owner, beneficiary, other, recipient] = await ethers.getSigners();

    const usdc = await (await ethers.getContractFactory("TestUSDC")).deploy();
    const manager = await (await ethers.getContractFactory("LeashManager")).deploy();

    await usdc.mint(owner.address, USDC(10_000));
    await usdc.connect(owner).approve(await manager.getAddress(), USDC(10_000));

    return { manager, usdc, owner, beneficiary, other, recipient };
  }

  async function createdLeashFixture() {
    const base = await deployFixture();
    const { manager, usdc, owner, beneficiary } = base;

    const expiry = BigInt(await time.latest()) + 30n * 24n * 3600n;
    const tx = await manager
      .connect(owner)
      .createLeash(beneficiary.address, await usdc.getAddress(), USDC(500), expiry);
    const receipt = await tx.wait();
    const created = receipt .logs
      .map((l) => manager.interface.parseLog(l))
      .find((l) => l?.name === "LeashCreated");
    const leashId = created.args.leashId;

    return { ...base, leashId, expiry };
  }

  describe("createLeash", () => {
    it("stores the leash and emits LeashCreated with full fields", async () => {
      const { manager, usdc, owner, beneficiary } = await loadFixture(deployFixture);
      const expiry = BigInt(await time.latest()) + 3600n;

      await expect(
        manager.connect(owner).createLeash(beneficiary.address, await usdc.getAddress(), USDC(500), expiry)
      )
        .to.emit(manager, "LeashCreated")
        .withArgs(
          (id) => ethers.isHexString(id, 32),
          owner.address,
          beneficiary.address,
          await usdc.getAddress(),
          USDC(500),
          expiry
        );
    });

    it("persists exact state readable via getLeash", async () => {
      const { manager, usdc, owner, beneficiary, leashId, expiry } = await loadFixture(createdLeashFixture);
      const leash = await manager.getLeash(leashId);
      expect(leash.owner).to.equal(owner.address);
      expect(leash.beneficiary).to.equal(beneficiary.address);
      expect(leash.token).to.equal(await usdc.getAddress());
      expect(leash.spendLimit).to.equal(USDC(500));
      expect(leash.spent).to.equal(0n);
      expect(leash.expiry).to.equal(expiry);
      expect(leash.revoked).to.equal(false);
    });

    it("generates distinct ids for identical params", async () => {
      const { manager, usdc, owner, beneficiary } = await loadFixture(deployFixture);
      const token = await usdc.getAddress();
      const id1 = await manager.connect(owner).createLeash.staticCall(beneficiary.address, token, USDC(100), 0);
      await manager.connect(owner).createLeash(beneficiary.address, token, USDC(100), 0);
      const id2 = await manager.connect(owner).createLeash.staticCall(beneficiary.address, token, USDC(100), 0);
      expect(id1).to.not.equal(id2);
    });

    it("reverts on zero beneficiary", async () => {
      const { manager, usdc, owner } = await loadFixture(deployFixture);
      await expect(
        manager.connect(owner).createLeash(ethers.ZeroAddress, await usdc.getAddress(), USDC(1), 0)
      ).to.be.revertedWithCustomError(manager, "ZeroAddress");
    });

    it("reverts on zero token", async () => {
      const { manager, owner, beneficiary } = await loadFixture(deployFixture);
      await expect(
        manager.connect(owner).createLeash(beneficiary.address, ethers.ZeroAddress, USDC(1), 0)
      ).to.be.revertedWithCustomError(manager, "ZeroAddress");
    });

    it("reverts on zero limit", async () => {
      const { manager, usdc, owner, beneficiary } = await loadFixture(deployFixture);
      await expect(
        manager.connect(owner).createLeash(beneficiary.address, await usdc.getAddress(), 0, 0)
      ).to.be.revertedWithCustomError(manager, "ZeroAmount");
    });

    it("reverts on leash to self", async () => {
      const { manager, usdc, owner } = await loadFixture(deployFixture);
      await expect(
        manager.connect(owner).createLeash(owner.address, await usdc.getAddress(), USDC(1), 0)
      ).to.be.revertedWithCustomError(manager, "SelfLeash");
    });

    it("reverts on expiry in the past", async () => {
      const { manager, usdc, owner, beneficiary } = await loadFixture(deployFixture);
      const past = BigInt(await time.latest()) - 10n;
      await expect(
        manager.connect(owner).createLeash(beneficiary.address, await usdc.getAddress(), USDC(1), past)
      ).to.be.revertedWithCustomError(manager, "ExpiryInPast");
    });
  });

  describe("spend", () => {
    it("moves funds owner → recipient within the limit and emits remaining", async () => {
      const { manager, usdc, owner, beneficiary, recipient, leashId } = await loadFixture(createdLeashFixture);

      await expect(manager.connect(beneficiary).spend(leashId, USDC(180), recipient.address))
        .to.emit(manager, "LeashSpent")
        .withArgs(leashId, beneficiary.address, recipient.address, USDC(180), USDC(320));

      expect(await usdc.balanceOf(recipient.address)).to.equal(USDC(180));
      expect(await usdc.balanceOf(owner.address)).to.equal(USDC(10_000 - 180));
      expect(await manager.remainingBalance(leashId)).to.equal(USDC(320));
    });

    it("allows spending to the exact limit across multiple pulls", async () => {
      const { manager, beneficiary, recipient, leashId } = await loadFixture(createdLeashFixture);
      await manager.connect(beneficiary).spend(leashId, USDC(200), recipient.address);
      await manager.connect(beneficiary).spend(leashId, USDC(300), recipient.address);
      expect(await manager.remainingBalance(leashId)).to.equal(0n);
    });

    it("reverts when a single spend exceeds the limit", async () => {
      const { manager, beneficiary, recipient, leashId } = await loadFixture(createdLeashFixture);
      await expect(manager.connect(beneficiary).spend(leashId, USDC(501), recipient.address))
        .to.be.revertedWithCustomError(manager, "SpendLimitExceeded")
        .withArgs(USDC(501), USDC(500));
    });

    it("guards double-spend: cumulative spends cannot exceed the cap", async () => {
      const { manager, beneficiary, recipient, leashId } = await loadFixture(createdLeashFixture);
      await manager.connect(beneficiary).spend(leashId, USDC(400), recipient.address);
      await expect(manager.connect(beneficiary).spend(leashId, USDC(101), recipient.address))
        .to.be.revertedWithCustomError(manager, "SpendLimitExceeded")
        .withArgs(USDC(101), USDC(100));
    });

    it("reverts after expiry", async () => {
      const { manager, beneficiary, recipient, leashId, expiry } = await loadFixture(createdLeashFixture);
      await time.increaseTo(expiry + 1n);
      await expect(
        manager.connect(beneficiary).spend(leashId, USDC(1), recipient.address)
      ).to.be.revertedWithCustomError(manager, "LeashExpired");
    });

    it("expiry == 0 never expires", async () => {
      const { manager, usdc, owner, beneficiary, recipient } = await loadFixture(deployFixture);
      const id = await manager
        .connect(owner)
        .createLeash.staticCall(beneficiary.address, await usdc.getAddress(), USDC(50), 0);
      await manager.connect(owner).createLeash(beneficiary.address, await usdc.getAddress(), USDC(50), 0);
      await time.increase(10 * 365 * 24 * 3600);
      await expect(manager.connect(beneficiary).spend(id, USDC(50), recipient.address)).to.not.be.reverted;
    });

    it("reverts for anyone who is not the beneficiary — including the owner", async () => {
      const { manager, owner, other, recipient, leashId } = await loadFixture(createdLeashFixture);
      await expect(
        manager.connect(other).spend(leashId, USDC(1), recipient.address)
      ).to.be.revertedWithCustomError(manager, "NotBeneficiary");
      await expect(
        manager.connect(owner).spend(leashId, USDC(1), recipient.address)
      ).to.be.revertedWithCustomError(manager, "NotBeneficiary");
    });

    it("reverts after revocation", async () => {
      const { manager, owner, beneficiary, recipient, leashId } = await loadFixture(createdLeashFixture);
      await manager.connect(owner).revoke(leashId);
      await expect(
        manager.connect(beneficiary).spend(leashId, USDC(1), recipient.address)
      ).to.be.revertedWithCustomError(manager, "AlreadyRevoked");
    });

    it("reverts on unknown leash id", async () => {
      const { manager, beneficiary, recipient } = await loadFixture(createdLeashFixture);
      await expect(
        manager.connect(beneficiary).spend(ethers.hexlify(ethers.randomBytes(32)), USDC(1), recipient.address)
      ).to.be.revertedWithCustomError(manager, "LeashNotFound");
    });

    it("reverts on zero recipient and zero amount", async () => {
      const { manager, beneficiary, recipient, leashId } = await loadFixture(createdLeashFixture);
      await expect(
        manager.connect(beneficiary).spend(leashId, USDC(1), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(manager, "ZeroAddress");
      await expect(
        manager.connect(beneficiary).spend(leashId, 0, recipient.address)
      ).to.be.revertedWithCustomError(manager, "ZeroAmount");
    });

    it("reverts when the owner's ERC20 allowance is exhausted (leash cap is not an allowance)", async () => {
      const { manager, usdc, owner, beneficiary, recipient, leashId } = await loadFixture(createdLeashFixture);
      await usdc.connect(owner).approve(await manager.getAddress(), USDC(10));
      await expect(manager.connect(beneficiary).spend(leashId, USDC(11), recipient.address))
        .to.be.revertedWithCustomError(usdc, "ERC20InsufficientAllowance");
    });

    it("reverts when the owner's balance is insufficient", async () => {
      const { manager, usdc, owner, beneficiary, other, recipient, leashId } = await loadFixture(
        createdLeashFixture
      );
      await usdc.connect(owner).transfer(other.address, USDC(9_990)); // leave only 10
      await expect(manager.connect(beneficiary).spend(leashId, USDC(11), recipient.address))
        .to.be.revertedWithCustomError(usdc, "ERC20InsufficientBalance");
    });

    it("blocks reentrancy from a malicious token", async () => {
      const { manager, owner, beneficiary, recipient } = await loadFixture(deployFixture);
      const evil = await (await ethers.getContractFactory("ReentrantToken")).deploy();
      await evil.mint(owner.address, USDC(1_000));
      await evil.connect(owner).approve(await manager.getAddress(), USDC(1_000));

      const id = await manager
        .connect(owner)
        .createLeash.staticCall(beneficiary.address, await evil.getAddress(), USDC(100), 0);
      await manager.connect(owner).createLeash(beneficiary.address, await evil.getAddress(), USDC(100), 0);

      await evil.arm(await manager.getAddress(), id);
      await expect(
        manager.connect(beneficiary).spend(id, USDC(10), recipient.address)
      ).to.be.revertedWithCustomError(manager, "ReentrancyGuardReentrantCall");
    });
  });

  describe("revoke", () => {
    it("owner revokes; emits unspent amount", async () => {
      const { manager, owner, beneficiary, recipient, leashId } = await loadFixture(createdLeashFixture);
      await manager.connect(beneficiary).spend(leashId, USDC(120), recipient.address);
      await expect(manager.connect(owner).revoke(leashId))
        .to.emit(manager, "LeashRevoked")
        .withArgs(leashId, owner.address, USDC(380));
    });

    it("non-owner (including beneficiary) cannot revoke", async () => {
      const { manager, beneficiary, other, leashId } = await loadFixture(createdLeashFixture);
      await expect(manager.connect(other).revoke(leashId)).to.be.revertedWithCustomError(manager, "NotOwner");
      await expect(manager.connect(beneficiary).revoke(leashId)).to.be.revertedWithCustomError(
        manager,
        "NotOwner"
      );
    });

    it("double revoke reverts", async () => {
      const { manager, owner, leashId } = await loadFixture(createdLeashFixture);
      await manager.connect(owner).revoke(leashId);
      await expect(manager.connect(owner).revoke(leashId)).to.be.revertedWithCustomError(
        manager,
        "AlreadyRevoked"
      );
    });

    it("revoking an unknown leash reverts", async () => {
      const { manager, owner } = await loadFixture(createdLeashFixture);
      await expect(
        manager.connect(owner).revoke(ethers.hexlify(ethers.randomBytes(32)))
      ).to.be.revertedWithCustomError(manager, "LeashNotFound");
    });
  });

  describe("remainingBalance", () => {
    it("tracks spends, and zeroes on revoke / expiry / unknown id", async () => {
      const { manager, owner, beneficiary, recipient, leashId, expiry } = await loadFixture(
        createdLeashFixture
      );
      expect(await manager.remainingBalance(leashId)).to.equal(USDC(500));

      await manager.connect(beneficiary).spend(leashId, USDC(75), recipient.address);
      expect(await manager.remainingBalance(leashId)).to.equal(USDC(425));

      expect(await manager.remainingBalance(ethers.hexlify(ethers.randomBytes(32)))).to.equal(0n);

      await time.increaseTo(expiry + 1n);
      expect(await manager.remainingBalance(leashId)).to.equal(0n);
    });

    it("zeroes after revocation", async () => {
      const { manager, owner, leashId } = await loadFixture(createdLeashFixture);
      await manager.connect(owner).revoke(leashId);
      expect(await manager.remainingBalance(leashId)).to.equal(0n);
    });
  });

  describe("isolation", () => {
    it("two leashes from one owner are fully independent", async () => {
      const { manager, usdc, owner, beneficiary, other, recipient } = await loadFixture(deployFixture);
      const token = await usdc.getAddress();

      const idA = await manager.connect(owner).createLeash.staticCall(beneficiary.address, token, USDC(100), 0);
      await manager.connect(owner).createLeash(beneficiary.address, token, USDC(100), 0);
      const idB = await manager.connect(owner).createLeash.staticCall(other.address, token, USDC(300), 0);
      await manager.connect(owner).createLeash(other.address, token, USDC(300), 0);

      await manager.connect(beneficiary).spend(idA, USDC(100), recipient.address);
      await manager.connect(owner).revoke(idB);

      expect(await manager.remainingBalance(idA)).to.equal(0n);
      expect(await manager.remainingBalance(idB)).to.equal(0n);
      await expect(manager.connect(other).spend(idB, USDC(1), recipient.address)).to.be.revertedWithCustomError(
        manager,
        "AlreadyRevoked"
      );
    });
  });
});
