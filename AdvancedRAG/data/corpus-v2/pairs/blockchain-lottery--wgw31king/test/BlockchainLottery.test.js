const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("BlockchainLottery", function () {
  const MIN_BET = ethers.parseEther("0.1");

  async function deployFixture() {
    const [owner, alice, bob, carol, dave] = await ethers.getSigners();
    const Lottery = await ethers.getContractFactory("BlockchainLottery");
    const lottery = await Lottery.deploy(MIN_BET, owner.address);
    await lottery.waitForDeployment();
    return { lottery, owner, alice, bob, carol, dave };
  }

  it("runs full flow and distributes prize by weights", async function () {
    const { lottery, owner, alice, bob, carol } = await loadFixture(deployFixture);

    await expect(lottery.connect(alice).placeBet({ value: ethers.parseEther("1") }))
      .to.emit(lottery, "BetPlaced");
    await lottery.connect(bob).placeBet({ value: ethers.parseEther("2") });
    await lottery.connect(carol).placeBet({ value: ethers.parseEther("3") });

    expect(await lottery.totalPool()).to.equal(ethers.parseEther("6"));

    await expect(lottery.connect(owner).closeBetting())
      .to.emit(lottery, "BettingClosed");

    const beforeAlice = await ethers.provider.getBalance(alice.address);
    const beforeBob = await ethers.provider.getBalance(bob.address);
    const beforeCarol = await ethers.provider.getBalance(carol.address);

    const tx = await lottery
      .connect(owner)
      .drawAndDistribute([alice.address, bob.address, carol.address], [1, 2, 3]);

    await expect(tx).to.emit(lottery, "WinnersDrawn");
    await expect(tx).to.emit(lottery, "DistributionCompleted")
      .withArgs(ethers.parseEther("6"));

    const afterAlice = await ethers.provider.getBalance(alice.address);
    const afterBob = await ethers.provider.getBalance(bob.address);
    const afterCarol = await ethers.provider.getBalance(carol.address);

    expect(afterAlice - beforeAlice).to.equal(ethers.parseEther("1"));
    expect(afterBob - beforeBob).to.equal(ethers.parseEther("2"));
    expect(afterCarol - beforeCarol).to.equal(ethers.parseEther("3"));

    expect(await lottery.settled()).to.equal(true);
    expect(await ethers.provider.getBalance(await lottery.getAddress())).to.equal(0n);
  });

  it("rejects non-owner admin actions", async function () {
    const { lottery, alice, bob } = await loadFixture(deployFixture);
    await expect(lottery.connect(alice).closeBetting()).to.be.reverted;
    await expect(
      lottery.connect(bob).drawAndDistribute([alice.address], [1])
    ).to.be.reverted;
  });

  it("reverts on invalid bet and invalid draw inputs", async function () {
    const { lottery, owner, alice } = await loadFixture(deployFixture);

    await expect(lottery.connect(alice).placeBet({ value: 0 }))
      .to.be.revertedWithCustomError(lottery, "InvalidBetAmount");

    await lottery.connect(alice).placeBet({ value: MIN_BET });

    await expect(
      lottery.connect(owner).drawAndDistribute([alice.address], [1])
    ).to.be.revertedWithCustomError(lottery, "BettingStillOpen");

    await lottery.connect(owner).closeBetting();

    await expect(
      lottery.connect(owner).drawAndDistribute([], [])
    ).to.be.revertedWithCustomError(lottery, "InvalidInput");

    await expect(
      lottery.connect(owner).drawAndDistribute([alice.address], [])
    ).to.be.revertedWithCustomError(lottery, "InvalidInput");

    await expect(
      lottery.connect(owner).drawAndDistribute([alice.address, alice.address], [1, 1])
    ).to.be.revertedWithCustomError(lottery, "InvalidInput");
  });

  it("cannot draw twice", async function () {
    const { lottery, owner, alice } = await loadFixture(deployFixture);
    await lottery.connect(alice).placeBet({ value: ethers.parseEther("1") });
    await lottery.connect(owner).closeBetting();
    await lottery.connect(owner).drawAndDistribute([alice.address], [1]);

    await expect(
      lottery.connect(owner).drawAndDistribute([alice.address], [1])
    ).to.be.revertedWithCustomError(lottery, "AlreadySettled");
  });

  it("prevents reentrancy during payout", async function () {
    const { lottery, owner, alice, bob } = await loadFixture(deployFixture);
    await lottery.connect(alice).placeBet({ value: ethers.parseEther("1") });
    await lottery.connect(bob).placeBet({ value: ethers.parseEther("1") });
    await lottery.connect(owner).closeBetting();

    const Attacker = await ethers.getContractFactory("ReentrantDrawAttacker");
    const attacker = await Attacker.deploy(await lottery.getAddress());
    await attacker.waitForDeployment();

    await lottery.connect(owner).transferOwnership(await attacker.getAddress());
    await attacker.triggerDraw([await attacker.getAddress()], [1]);

    expect(await attacker.attemptedReentry()).to.equal(true);
    expect(await attacker.reentrySucceeded()).to.equal(false);
    expect(await lottery.settled()).to.equal(true);
  });
});
