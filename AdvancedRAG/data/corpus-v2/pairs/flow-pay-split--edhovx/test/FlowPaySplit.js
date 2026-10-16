const { expect } = require("chai");
const hre = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { ethers } = require("ethers");

describe("FlowPaySplit", function () {
  async function deployFixture() {
    const [owner, funder, alice, bob, carol] = await hre.ethers.getSigners();
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    const Split = await hre.ethers.getContractFactory("FlowPaySplit");
    const split = await Split.deploy(await usdc.getAddress());

    await usdc.mint(funder.address, ethers.parseUnits("100000", 6));
    await usdc
      .connect(funder)
      .approve(await split.getAddress(), ethers.MaxUint256);

    return { usdc, split, owner, funder, alice, bob, carol };
  }

  async function createSplit(f, { accounts, amounts, expiry = 3600n } = {}) {
    const now = BigInt(await time.latest());
    return f.split
      .connect(f.funder)
      .createSplit(
        accounts || [f.alice.address, f.bob.address],
        amounts || [ethers.parseUnits("600", 6), ethers.parseUnits("400", 6)],
        "Revenue share Q3",
        now + expiry,
      );
  }

  it("should create a split with recipients", async function () {
    const f = await deployFixture();
    await expect(createSplit(f))
      .to.emit(f.split, "SplitCreated")
      .withArgs(0, f.funder.address, ethers.parseUnits("1000", 6), anyValue, 2);

    const s = await f.split.getSplit(0);
    expect(s.total).to.equal(ethers.parseUnits("1000", 6));
    expect(s.funder).to.equal(f.funder.address);
    expect(await f.split.getRecipientCount(0)).to.equal(2);
    const r = await f.split.getRecipient(0, 0);
    expect(r.account).to.equal(f.alice.address);
    expect(r.amount).to.equal(ethers.parseUnits("600", 6));
  });

  it("should reject invalid inputs", async function () {
    const f = await deployFixture();
    await expect(
      f.split.connect(f.funder).createSplit([], [], "x", 3600n),
    ).to.be.revertedWithCustomError(f.split, "EmptyRecipients");

    const now = BigInt(await time.latest());
    await expect(
      f.split
        .connect(f.funder)
        .createSplit(
          [f.alice.address],
          [ethers.parseUnits("100", 6), ethers.parseUnits("100", 6)],
          "x",
          now + 3600n,
        ),
    ).to.be.revertedWithCustomError(f.split, "MismatchedArrays");

    await expect(
      f.split
        .connect(f.funder)
        .createSplit(
          [f.alice.address, f.alice.address],
          [ethers.parseUnits("100", 6), ethers.parseUnits("100", 6)],
          "x",
          now + 3600n,
        ),
    ).to.be.revertedWithCustomError(f.split, "DuplicateRecipient");

    await expect(
      f.split.connect(f.funder).createSplit([f.alice.address], [100], "x", now),
    ).to.be.revertedWithCustomError(f.split, "InvalidDeadline");
  });

  it("should fund a split", async function () {
    const f = await deployFixture();
    await createSplit(f);
    await expect(f.split.connect(f.funder).fundSplit(0))
      .to.emit(f.split, "SplitFunded")
      .withArgs(0, f.funder.address, ethers.parseUnits("1000", 6));
    expect(await f.usdc.balanceOf(await f.split.getAddress())).to.equal(
      ethers.parseUnits("1000", 6),
    );
  });

  it("should reject double funding", async function () {
    const f = await deployFixture();
    await createSplit(f);
    await f.split.connect(f.funder).fundSplit(0);
    await expect(
      f.split.connect(f.funder).fundSplit(0),
    ).to.be.revertedWithCustomError(f.split, "AlreadyFunded");
  });

  it("should let each recipient claim their share once", async function () {
    const f = await deployFixture();
    await createSplit(f);
    await f.split.connect(f.funder).fundSplit(0);

    await expect(f.split.connect(f.alice).claim(0, 0))
      .to.emit(f.split, "SplitClaimed")
      .withArgs(0, 0, f.alice.address, ethers.parseUnits("600", 6));
    expect(await f.usdc.balanceOf(f.alice.address)).to.equal(
      ethers.parseUnits("600", 6),
    );

    await f.split.connect(f.bob).claim(0, 1);
    expect(await f.usdc.balanceOf(f.bob.address)).to.equal(
      ethers.parseUnits("400", 6),
    );

    const s = await f.split.getSplit(0);
    expect(s.claimedCount).to.equal(2);
    expect(s.claimedTotal).to.equal(ethers.parseUnits("1000", 6));

    // double claim reverts
    await expect(
      f.split.connect(f.alice).claim(0, 0),
    ).to.be.revertedWithCustomError(f.split, "AlreadyClaimed");
  });

  it("should reject claiming before funding or for others' slots", async function () {
    const f = await deployFixture();
    await createSplit(f);
    // not funded yet
    await expect(
      f.split.connect(f.alice).claim(0, 0),
    ).to.be.revertedWithCustomError(f.split, "NotFunded");
    await f.split.connect(f.funder).fundSplit(0);
    // wrong slot
    await expect(
      f.split.connect(f.alice).claim(0, 1),
    ).to.be.revertedWithCustomError(f.split, "Unauthorized");
  });

  it("should allow claimFor to pay out on a recipient's behalf", async function () {
    const f = await deployFixture();
    await createSplit(f);
    await f.split.connect(f.funder).fundSplit(0);
    await expect(f.split.connect(f.carol).claimFor(0, 1))
      .to.emit(f.split, "SplitClaimed")
      .withArgs(0, 1, f.bob.address, ethers.parseUnits("400", 6));
    expect(await f.usdc.balanceOf(f.bob.address)).to.equal(
      ethers.parseUnits("400", 6),
    );
  });

  it("should refund unclaimed funds to the funder after expiry", async function () {
    const f = await deployFixture();
    await createSplit(f);
    await f.split.connect(f.funder).fundSplit(0);
    await f.split.connect(f.alice).claim(0, 0);

    await time.increase(7200);
    await expect(f.split.connect(f.funder).refundUnclaimed(0))
      .to.emit(f.split, "SplitRefunded")
      .withArgs(0, f.funder.address, ethers.parseUnits("400", 6));

    expect(await f.usdc.balanceOf(f.funder.address)).to.equal(
      ethers.parseUnits("100000", 6) - ethers.parseUnits("600", 6),
    );
    expect((await f.split.getSplit(0)).refunded).to.equal(true);
  });

  it("should reject refund before expiry and double refund", async function () {
    const f = await deployFixture();
    await createSplit(f);
    await f.split.connect(f.funder).fundSplit(0);
    await expect(
      f.split.connect(f.funder).refundUnclaimed(0),
    ).to.be.revertedWithCustomError(f.split, "NotExpired");

    await time.increase(7200);
    await f.split.connect(f.funder).refundUnclaimed(0);
    await expect(
      f.split.connect(f.funder).refundUnclaimed(0),
    ).to.be.revertedWithCustomError(f.split, "AlreadyRefunded");
  });

  it("should list splits by funder and recipient", async function () {
    const f = await deployFixture();
    await createSplit(f);
    await createSplit(f, {
      accounts: [f.alice.address, f.carol.address],
      amounts: [100, 200],
    });
    expect(await f.split.getSplitsByFunder(f.funder.address)).to.deep.equal([
      0n,
      1n,
    ]);
    const aliceSplits = await f.split.getSplitsByRecipient(f.alice.address);
    expect(aliceSplits.length).to.equal(2);
  });
});
