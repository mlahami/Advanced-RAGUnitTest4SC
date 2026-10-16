const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTStaking", function () {
  let nftStaking;
  let nftContract;
  let rewardToken;
  let owner;
  let staker1;
  let staker2;
  const rewardRate = ethers.parseEther("1"); // 1 reward token per second per NFT

  beforeEach(async function () {
    [owner, staker1, staker2] = await ethers.getSigners();

    // Deploy mock NFT contract
    const BenchmarkERC721 = await ethers.getContractFactory("BenchmarkERC721");
    nftContract = await BenchmarkERC721.deploy("TestNFT", "TNFT");
    await nftContract.waitForDeployment();

    // Deploy mock reward token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    rewardToken = await BenchmarkERC20.deploy("RewardToken", "RT");
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
    await nftContract.mint(staker1.address, 1);
    await nftContract.mint(staker1.address, 2);
    await nftContract.mint(staker2.address, 3);

    // Approve NFT transfers to staking contract
    await nftContract.connect(staker1).approve(await nftStaking.getAddress(), 1);
    await nftContract.connect(staker1).approve(await nftStaking.getAddress(), 2);
    await nftContract.connect(staker2).approve(await nftStaking.getAddress(), 3);
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await nftStaking.owner()).to.equal(owner.address);
    });

    it("Should set the correct reward rate", async function () {
      expect(await nftStaking.rewardRate()).to.equal(rewardRate);
    });
  });

  describe("Staking", function () {
    it("Should allow staking NFTs", async function () {
      await expect(nftStaking.connect(staker1).stake([1, 2]))
        .to.emit(nftStaking, "Staked")
        .withArgs(staker1.address, [1, 2]);

      const stakedTokens = await nftStaking.stakedTokens(staker1.address);
      expect(stakedTokens).to.deep.equal([1, 2]);

      expect(await nftContract.ownerOf(1)).to.equal(await nftStaking.getAddress());
      expect(await nftContract.ownerOf(2)).to.equal(await nftStaking.getAddress());
    });

    it("Should revert if not the owner of the NFT", async function () {
      await expect(nftStaking.connect(staker1).stake([3])).to.be.revertedWith("Not owner");
    });

    it("Should revert if NFT is already staked", async function () {
      await nftStaking.connect(staker1).stake([1]);
      await expect(nftStaking.connect(staker1).stake([1])).to.be.revertedWith("Already staked");
    });
  });

  describe("Unstaking", function () {
    beforeEach(async function () {
      await nftStaking.connect(staker1).stake([1, 2]);
    });

    it("Should allow unstaking NFTs", async function () {
      await expect(nftStaking.connect(staker1).unstake([1]))
        .to.emit(nftStaking, "Unstaked")
        .withArgs(staker1.address, [1]);

      const stakedTokens = await nftStaking.stakedTokens(staker1.address);
      expect(stakedTokens).to.deep.equal([2]);

      expect(await nftContract.ownerOf(1)).to.equal(staker1.address);
    });

    it("Should revert if not the owner of the staked NFT", async function () {
      await expect(nftStaking.connect(staker2).unstake([1])).to.be.revertedWith("Not your token");
    });
  });

  describe("Rewards", function () {
    beforeEach(async function () {
      await nftStaking.connect(staker1).stake([1, 2]);
      await nftStaking.connect(staker2).stake([3]);
    });

    it("Should calculate pending rewards correctly", async function () {
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      const pendingRewards1 = await nftStaking.pendingRewards(staker1.address);
      const pendingRewards2 = await nftStaking.pendingRewards(staker2.address);

      // 2 NFTs * 10 seconds * 1 reward per second per NFT = 20 rewards
      expect(pendingRewards1).to.equal(20n * 10n ** 18n);
      // 1 NFT * 10 seconds * 1 reward per second per NFT = 10 rewards
      expect(pendingRewards2).to.equal(10n * 10n ** 18n);
    });

    it("Should allow claiming rewards", async function () {
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      // Approve reward token transfer
      await rewardToken.approve(await nftStaking.getAddress(), ethers.MaxUint256);

      await expect(nftStaking.connect(staker1).claimRewards())
        .to.emit(nftStaking, "RewardClaimed")
        .withArgs(staker1.address, 20n * 10n ** 18n);

      const pendingRewards = await nftStaking.pendingRewards(staker1.address);
      expect(pendingRewards).to.equal(0);
    });

    it("Should revert if no rewards to claim", async function () {
      await expect(nftStaking.connect(staker1).claimRewards()).to.be.revertedWith("No rewards");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to set reward rate", async function () {
      const newRate = ethers.parseEther("2");
      await expect(nftStaking.connect(owner).setRewardRate(newRate))
        .to.emit(nftStaking, "RewardRateUpdated")
        .withArgs(newRate);

      expect(await nftStaking.rewardRate()).to.equal(newRate);
    });

    it("Should revert if non-owner tries to set reward rate", async function () {
      const newRate = ethers.parseEther("2");
      await expect(nftStaking.connect(staker1).setRewardRate(newRate)).to.be.revertedWith("Not owner");
    });
  });

  describe("Views", function () {
    beforeEach(async function () {
      await nftStaking.connect(staker1).stake([1, 2]);
    });

    it("Should return correct staked tokens", async function () {
      const stakedTokens = await nftStaking.stakedTokens(staker1.address);
      expect(stakedTokens).to.deep.equal([1, 2]);
    });

    it("Should return correct pending rewards", async function () {
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      const pendingRewards = await nftStaking.pendingRewards(staker1.address);
      // 2 NFTs * 10 seconds * 1 reward per second per NFT = 20 rewards
      expect(pendingRewards).to.equal(20n * 10n ** 18n);
    });
  });
});