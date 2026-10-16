const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("StakingVault", function () {
  async function deploy() {
    const [owner, alice, bob] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("StakeToken");
    const token = await Token.deploy();
    const rate = ethers.parseEther("1"); // 1 token / sec across all stake
    const Vault = await ethers.getContractFactory("StakingVault");
    const vault = await Vault.deploy(await token.getAddress(), rate);
    await token.transfer(alice.address, ethers.parseEther("1000"));
    await token.transfer(bob.address, ethers.parseEther("1000"));
    await token.mint(await vault.getAddress(), ethers.parseEther("100000"));
    return { owner, alice, bob, token, vault, rate };
  }

  it("stakes and records the balance before the transfer returns", async function () {
    const { alice, token, vault } = await deploy();
    await token.connect(alice).approve(await vault.getAddress(), ethers.parseEther("100"));
    await vault.connect(alice).stake(ethers.parseEther("100"));
    expect(await vault.staked(alice.address)).to.equal(ethers.parseEther("100"));
    expect(await vault.totalStaked()).to.equal(ethers.parseEther("100"));
  });

  it("reverts withdraw above the staked amount", async function () {
    const { alice, token, vault } = await deploy();
    await token.connect(alice).approve(await vault.getAddress(), ethers.parseEther("10"));
    await vault.connect(alice).stake(ethers.parseEther("10"));
    await expect(vault.connect(alice).withdraw(ethers.parseEther("11"))).to.be.revertedWith(
      "too much"
    );
  });

  it("returns principal on withdraw", async function () {
    const { alice, token, vault } = await deploy();
    await token.connect(alice).approve(await vault.getAddress(), ethers.parseEther("40"));
    await vault.connect(alice).stake(ethers.parseEther("40"));
    const before = await token.balanceOf(alice.address);
    await vault.connect(alice).withdraw(ethers.parseEther("40"));
    expect(await token.balanceOf(alice.address)).to.equal(before + ethers.parseEther("40"));
    expect(await vault.staked(alice.address)).to.equal(0n);
  });

  it("pays rewards after time passes", async function () {
    const { alice, token, vault } = await deploy();
    await token.connect(alice).approve(await vault.getAddress(), ethers.parseEther("100"));
    await vault.connect(alice).stake(ethers.parseEther("100"));
    await time.increase(100);
    const pending = await vault.earned(alice.address);
    expect(pending).to.be.greaterThan(ethers.parseEther("99"));
    expect(pending).to.be.lessThan(ethers.parseEther("102"));
    const before = await token.balanceOf(alice.address);
    await vault.connect(alice).getReward();
    const paid = (await token.balanceOf(alice.address)) - before;
    expect(paid).to.be.greaterThan(ethers.parseEther("99"));
  });

  it("splits rewards by stake share", async function () {
    const { alice, bob, token, vault } = await deploy();
    await token.connect(alice).approve(await vault.getAddress(), ethers.parseEther("100"));
    await token.connect(bob).approve(await vault.getAddress(), ethers.parseEther("100"));
    await vault.connect(alice).stake(ethers.parseEther("100"));
    await vault.connect(bob).stake(ethers.parseEther("100"));
    await time.increase(100);
    const a = await vault.earned(alice.address);
    const b = await vault.earned(bob.address);
    const diff = a > b ? a - b : b - a;
    expect(diff).to.be.lessThan(ethers.parseEther("2"));
  });

  it("only the owner can change the reward rate", async function () {
    const { alice, vault } = await deploy();
    await expect(vault.connect(alice).setRewardRate(1)).to.be.revertedWithCustomError(
      vault,
      "OwnableUnauthorizedAccount"
    );
    await vault.setRewardRate(0);
    expect(await vault.rewardRate()).to.equal(0n);
  });
});
