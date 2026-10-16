const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTStaking", function () {
  let nftStaking, nftContract, rewardToken;
  let owner, staker1, staker2;
  const rewardRate = ethers.parseEther("1"); // 1 token per second per NFT

  beforeEach(async function () {
    [owner, staker1, staker2] = await ethers.getSigners();

    // Deploy NFT contract
    const NFT = await ethers.getContractFactory("BenchmarkERC721");
    nftContract = await NFT.deploy("TestNFT", "TNFT");
    await nftContract.waitForDeployment();

    // Deploy reward token
    const RewardToken = await ethers.getContractFactory("BenchmarkERC20");
    rewardToken = await RewardToken.deploy("RewardToken", "RT");
    await rewardToken.waitForDeployment();

    // Deploy NFTStaking contract
    const NFTStaking = await ethers.getContractFactory("NFTStaking");
    nftStaking = await NFTStaking.deploy(
      await nftContract.getAddress(),
      await rewardToken.getAddress(),
      rewardRate
    );
    await nftStaking.waitForDeployment();

    // Mint NFTs to stakers
    await nftContract.mint(staker1.address, 1n);
    await nftContract.mint(staker1.address, 2n);
    await nftContract.mint(staker2.address, 3n);

    // Approve NFT transfers to staking contract
    await nftContract.connect(staker1).approve(await nftStaking.getAddress(), 1n);
    await nftContract.connect(staker1).approve(await nftStaking.getAddress(), 2n);
    await nftContract.connect(staker2).approve(await nftStaking.getAddress(), 3n);

    // Mint reward tokens to staking contract
    await rewardToken.mint(await nftStaking.getAddress(), ethers.parseEther("1000000"));
  });

  describe("Staking", function () {
    it("Should allow staking multiple NFTs", async function () {
      await expect(nftStaking.connect(staker1).stake([1n, 2n]))
        .to.emit(nftStaking, "Staked")
        .withArgs(staker1.address, [1n, 2n]);

      const stakedTokens = await nftStaking.stakedTokens(staker1.address);
      expect(stakedTokens).to.deep.equal([1n, 2n]);

      // Verify NFT ownership transferred to staking contract
      expect(await nftContract.ownerOf(1n)).to.equal(await nftStaking.getAddress());
      expect(await nftContract.ownerOf(2n)).to.equal(await nftStaking.getAddress());
    });

    it("Should prevent staking NFTs not owned by the caller", async function () {
      await expect(nftStaking.connect(staker1).stake([3n]))
        .to.be.revertedWith("Not owner");
    });

    it("Should prevent staking already staked NFTs", async function () {
      await nftStaking.connect(staker1).stake([1n]);
      await expect(nftStaking.connect(staker1).stake([1n]))
        .to.be.revertedWith("Already staked");
    });
  });

  describe("Unstaking", function () {
    beforeEach(async function () {
      await nftStaking.connect(staker1).stake([1n, 2n]);
    });

    it("Should allow unstaking multiple NFTs", async function () {
      await expect(nftStaking.connect(staker1).unstake([1n, 2n]))
        .to.emit(nftStaking, "Unstaked")
        .withArgs(staker1.address, [1n, 2n]);

      const stakedTokens = await nftStaking.stakedTokens(staker1.address);
      expect(stakedTokens).to.be.empty;

      // Verify NFT ownership returned to staker
      expect(await nftContract.ownerOf(1n)).to.equal(staker1.address);
      expect(await nftContract.ownerOf(2n)).to.equal(staker1.address);
    });

    it("Should prevent unstaking NFTs not owned by the caller", async function () {
      await expect(nftStaking.connect(staker2).unstake([1n]))
        .to.be.revertedWith("Not your token");
    });

    it("Should prevent unstaking NFTs not staked", async function () {
      await expect(nftStaking.connect(staker1).unstake([3n]))
        .to.be.revertedWith("Not your token");
    });
  });

  describe("Rewards", function () {
    beforeEach(async function () {
      await nftStaking.connect(staker1).stake([1n, 2n]);
      await nftStaking.connect(staker2).stake([3n]);
    });

    it("Should calculate pending rewards correctly", async function () {
      // Fast forward 10 seconds
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      // Staker1 should have 2 NFTs staked for 10 seconds: 2 * 10 * 1 = 20 tokens
      const pending1 = await nftStaking.pendingRewards(staker1.address);
      expect(pending1).to.equal(20n * 10n ** 18n);

      // Staker2 should have 1 NFT staked for 10 seconds: 1 * 10 * 1 = 10 tokens
      const pending2 = await nftStaking.pendingRewards(staker2.address);
      expect(pending2).to.equal(10n * 10n ** 18n);
    });

    it("Should allow claiming rewards", async function () {
      // Fast forward 10 seconds
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      const initialBalance = await rewardToken.balanceOf(staker1.address);
      await expect(nftStaking.connect(staker1).claimRewards())
        .to.emit(nftStaking, "RewardClaimed")
        .withArgs(staker1.address, 20n * 10n ** 18n);

      const finalBalance = await rewardToken.balanceOf(staker1.address);
      expect(finalBalance - initialBalance).to.equal(20n * 10n ** 18n);

      // Verify rewards were reset
      const pending = await nftStaking.pendingRewards(staker1.address);
      expect(pending).to.equal(0n);
    });

    it("Should prevent claiming rewards when none are available", async function () {
      await expect(nftStaking.connect(staker1).claimRewards())
        .to.be.revertedWith("No rewards");
    });
  });

  describe("Admin", function () {
    it("Should allow owner to set reward rate", async function () {
      await expect(nftStaking.setRewardRate(ethers.parseEther("2")))
        .to.emit(nftStaking, "RewardRateUpdated")
        .withArgs(ethers.parseEther("2"));

      expect(await nftStaking.rewardRate()).to.equal(ethers.parseEther("2"));
    });

    it("Should prevent non-owner from setting reward rate", async function () {
      await expect(nftStaking.connect(staker1).setRewardRate(ethers.parseEther("2")))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Views", function () {
    beforeEach(async function () {
      await nftStaking.connect(staker1).stake([1n, 2n]);
    });

    it("Should return correct staked tokens", async function () {
      const stakedTokens = await nftStaking.stakedTokens(staker1.address);
      expect(stakedTokens).to.deep.equal([1n, 2n]);
    });

    it("Should return correct pending rewards", async function () {
      // Fast forward 5 seconds
      await ethers.provider.send("evm_increaseTime", [5]);
      await ethers.provider.send("evm_mine");

      // 2 NFTs * 5 seconds * 1 token per second per NFT = 10 tokens
      const pending = await nftStaking.pendingRewards(staker1.address);
      expect(pending).to.equal(10n * 10n ** 18n);
    });
  });
});