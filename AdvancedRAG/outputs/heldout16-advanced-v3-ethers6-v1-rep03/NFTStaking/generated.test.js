const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTStaking", function () {
  let nftStaking;
  let nftContract;
  let rewardToken;
  let owner;
  let user1;
  let user2;

  const REWARD_RATE = ethers.parseEther("1"); // 1 reward token per second per NFT

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy NFT contract
    const BenchmarkERC721 = await ethers.getContractFactory("BenchmarkERC721");
    nftContract = await BenchmarkERC721.deploy("TestNFT", "TNFT");
    await nftContract.waitForDeployment();

    // Deploy reward token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    rewardToken = await BenchmarkERC20.deploy("RewardToken", "RT");
    await rewardToken.waitForDeployment();

    // Deploy NFTStaking contract
    const NFTStaking = await ethers.getContractFactory("NFTStaking");
    nftStaking = await NFTStaking.deploy(
      await nftContract.getAddress(),
      await rewardToken.getAddress(),
      REWARD_RATE
    );
    await nftStaking.waitForDeployment();

    // Mint NFTs to users
    await nftContract.mint(user1.address, 1n);
    await nftContract.mint(user1.address, 2n);
    await nftContract.mint(user2.address, 3n);

    // Approve NFT transfers to staking contract
    await nftContract.connect(user1).approve(await nftStaking.getAddress(), 1n);
    await nftContract.connect(user1).approve(await nftStaking.getAddress(), 2n);
    await nftContract.connect(user2).approve(await nftStaking.getAddress(), 3n);

    // Mint reward tokens to staking contract
    await rewardToken.mint(await nftStaking.getAddress(), ethers.parseEther("1000000"));
  });

  describe("Staking", function () {
    it("Should allow staking multiple NFTs", async function () {
      await nftStaking.connect(user1).stake([1n, 2n]);

      const stakedTokens = await nftStaking.stakedTokens(user1.address);
      expect(stakedTokens.length).to.equal(2);
      expect(stakedTokens).to.include.members([1n, 2n]);

      const stakeInfo = await nftStaking.stakes(user1.address);
      expect(stakeInfo.tokenIds.length).to.equal(2);
      expect(stakeInfo.lastUpdateTime).to.be.gt(0n);
    });

    it("Should prevent staking NFTs not owned by the user", async function () {
      await expect(nftStaking.connect(user1).stake([3n])).to.be.revertedWith("Not owner");
    });

    it("Should prevent staking already staked NFTs", async function () {
      await nftStaking.connect(user1).stake([1n]);
      await expect(nftStaking.connect(user1).stake([1n])).to.be.revertedWith("Already staked");
    });

    it("Should emit Staked event when staking", async function () {
      await expect(nftStaking.connect(user1).stake([1n]))
        .to.emit(nftStaking, "Staked")
        .withArgs(user1.address, [1n]);
    });
  });

  describe("Unstaking", function () {
    it("Should allow unstaking multiple NFTs", async function () {
      await nftStaking.connect(user1).stake([1n, 2n]);
      await nftStaking.connect(user1).unstake([1n, 2n]);

      const stakedTokens = await nftStaking.stakedTokens(user1.address);
      expect(stakedTokens.length).to.equal(0);

      const stakeInfo = await nftStaking.stakes(user1.address);
      expect(stakeInfo.tokenIds.length).to.equal(0);
    });

    it("Should prevent unstaking NFTs not staked by the user", async function () {
      await nftStaking.connect(user1).stake([1n]);
      await expect(nftStaking.connect(user2).unstake([1n])).to.be.revertedWith("Not your token");
    });

    it("Should emit Unstaked event when unstaking", async function () {
      await nftStaking.connect(user1).stake([1n]);
      await expect(nftStaking.connect(user1).unstake([1n]))
        .to.emit(nftStaking, "Unstaked")
        .withArgs(user1.address, [1n]);
    });
  });

  describe("Rewards", function () {
    it("Should calculate pending rewards correctly", async function () {
      await nftStaking.connect(user1).stake([1n]);

      // Fast forward time by 10 seconds
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      const pendingRewards = await nftStaking.pendingRewards(user1.address);
      expect(pendingRewards).to.be.closeTo(ethers.parseEther("10"), ethers.parseEther("0.1"));
    });

    it("Should allow claiming rewards", async function () {
      await nftStaking.connect(user1).stake([1n]);

      // Fast forward time by 10 seconds
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      const initialBalance = await rewardToken.balanceOf(user1.address);
      await nftStaking.connect(user1).claimRewards();
      const finalBalance = await rewardToken.balanceOf(user1.address);

      expect(finalBalance - initialBalance).to.be.closeTo(ethers.parseEther("10"), ethers.parseEther("0.1"));
    });

    it("Should prevent claiming rewards when none are available", async function () {
      await expect(nftStaking.connect(user1).claimRewards()).to.be.revertedWith("No rewards");
    });

    it("Should emit RewardClaimed event when claiming rewards", async function () {
      await nftStaking.connect(user1).stake([1n]);

      // Fast forward time by 10 seconds
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      const pendingRewards = await nftStaking.pendingRewards(user1.address);
      await expect(nftStaking.connect(user1).claimRewards())
        .to.emit(nftStaking, "RewardClaimed")
        .withArgs(user1.address, pendingRewards);
    });
  });

  describe("Admin", function () {
    it("Should allow owner to set reward rate", async function () {
      const newRate = ethers.parseEther("2");
      await nftStaking.setRewardRate(newRate);
      expect(await nftStaking.rewardRate()).to.equal(newRate);
    });

    it("Should prevent non-owner from setting reward rate", async function () {
      const newRate = ethers.parseEther("2");
      await expect(nftStaking.connect(user1).setRewardRate(newRate)).to.be.revertedWith("Not owner");
    });
  });

  describe("Views", function () {
    it("Should return correct staked tokens", async function () {
      await nftStaking.connect(user1).stake([1n, 2n]);
      const stakedTokens = await nftStaking.stakedTokens(user1.address);
      expect(stakedTokens).to.include.members([1n, 2n]);
    });

    it("Should return correct pending rewards", async function () {
      await nftStaking.connect(user1).stake([1n]);

      // Fast forward time by 10 seconds
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      const pendingRewards = await nftStaking.pendingRewards(user1.address);
      expect(pendingRewards).to.be.closeTo(ethers.parseEther("10"), ethers.parseEther("0.1"));
    });
  });
});