const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTStaking", function () {
  let nftStaking, nftContract, rewardToken;
  let owner, staker1, staker2;
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
    await nftContract.mint(staker1.address, 1n);
    await nftContract.mint(staker1.address, 2n);
    await nftContract.mint(staker2.address, 3n);

    // Approve NFTStaking contract to transfer NFTs
    await nftContract.connect(staker1).approve(await nftStaking.getAddress(), 1n);
    await nftContract.connect(staker1).approve(await nftStaking.getAddress(), 2n);
    await nftContract.connect(staker2).approve(await nftStaking.getAddress(), 3n);

    // Mint reward tokens to NFTStaking contract
    await rewardToken.mint(await nftStaking.getAddress(), ethers.parseEther("1000"));
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await nftStaking.owner()).to.equal(owner.address);
    });

    it("Should set the correct NFT contract address", async function () {
      expect(await nftStaking.nftContract()).to.equal(await nftContract.getAddress());
    });

    it("Should set the correct reward token address", async function () {
      expect(await nftStaking.rewardToken()).to.equal(await rewardToken.getAddress());
    });

    it("Should set the correct reward rate", async function () {
      expect(await nftStaking.rewardRate()).to.equal(rewardRate);
    });
  });

  describe("Staking", function () {
    it("Should allow staking NFTs", async function () {
      await nftStaking.connect(staker1).stake([1n, 2n]);

      const stakedTokens = await nftStaking.stakedTokens(staker1.address);
      expect(stakedTokens.length).to.equal(2);
      expect(stakedTokens[0]).to.equal(1n);
      expect(stakedTokens[1]).to.equal(2n);

      expect(await nftContract.ownerOf(1n)).to.equal(await nftStaking.getAddress());
      expect(await nftContract.ownerOf(2n)).to.equal(await nftStaking.getAddress());
    });

    it("Should emit Staked event", async function () {
      await expect(nftStaking.connect(staker1).stake([1n, 2n]))
        .to.emit(nftStaking, "Staked")
        .withArgs(staker1.address, [1n, 2n]);
    });

    it("Should revert if not the owner of the NFT", async function () {
      await expect(nftStaking.connect(staker1).stake([3n]))
        .to.be.revertedWith("Not owner");
    });

    it("Should revert if NFT is already staked", async function () {
      await nftStaking.connect(staker1).stake([1n]);
      await expect(nftStaking.connect(staker1).stake([1n]))
        .to.be.revertedWith("Already staked");
    });
  });

  describe("Unstaking", function () {
    beforeEach(async function () {
      await nftStaking.connect(staker1).stake([1n, 2n]);
    });

    it("Should allow unstaking NFTs", async function () {
      await nftStaking.connect(staker1).unstake([1n]);

      const stakedTokens = await nftStaking.stakedTokens(staker1.address);
      expect(stakedTokens.length).to.equal(1);
      expect(stakedTokens[0]).to.equal(2n);

      expect(await nftContract.ownerOf(1n)).to.equal(staker1.address);
      expect(await nftContract.ownerOf(2n)).to.equal(await nftStaking.getAddress());
    });

    it("Should emit Unstaked event", async function () {
      await expect(nftStaking.connect(staker1).unstake([1n]))
        .to.emit(nftStaking, "Unstaked")
        .withArgs(staker1.address, [1n]);
    });

    it("Should revert if not the owner of the staked NFT", async function () {
      await expect(nftStaking.connect(staker2).unstake([1n]))
        .to.be.revertedWith("Not your token");
    });
  });

  describe("Rewards", function () {
    beforeEach(async function () {
      await nftStaking.connect(staker1).stake([1n, 2n]);
      await nftStaking.connect(staker2).stake([3n]);
    });

    it("Should calculate pending rewards correctly", async function () {
      // Fast forward time by 10 seconds
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      // Staker1 should have 2 NFTs staked for 10 seconds: 2 * 10 * 1 = 20 reward tokens
      const pendingRewards1 = await nftStaking.pendingRewards(staker1.address);
      expect(pendingRewards1).to.equal(ethers.parseEther("20"));

      // Staker2 should have 1 NFT staked for 10 seconds: 1 * 10 * 1 = 10 reward tokens
      const pendingRewards2 = await nftStaking.pendingRewards(staker2.address);
      expect(pendingRewards2).to.equal(ethers.parseEther("10"));
    });

    it("Should allow claiming rewards", async function () {
      // Fast forward time by 10 seconds
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      const initialBalance = await rewardToken.balanceOf(staker1.address);
      await nftStaking.connect(staker1).claimRewards();

      const finalBalance = await rewardToken.balanceOf(staker1.address);
      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("20"));
    });

    it("Should emit RewardClaimed event", async function () {
      // Fast forward time by 10 seconds
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      await expect(nftStaking.connect(staker1).claimRewards())
        .to.emit(nftStaking, "RewardClaimed")
        .withArgs(staker1.address, ethers.parseEther("20"));
    });

    it("Should revert if no rewards to claim", async function () {
      await expect(nftStaking.connect(staker1).claimRewards())
        .to.be.revertedWith("No rewards");
    });
  });

  describe("Admin", function () {
    it("Should allow owner to set reward rate", async function () {
      const newRate = ethers.parseEther("2");
      await nftStaking.connect(owner).setRewardRate(newRate);
      expect(await nftStaking.rewardRate()).to.equal(newRate);
    });

    it("Should revert if non-owner tries to set reward rate", async function () {
      const newRate = ethers.parseEther("2");
      await expect(nftStaking.connect(staker1).setRewardRate(newRate))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Views", function () {
    beforeEach(async function () {
      await nftStaking.connect(staker1).stake([1n, 2n]);
    });

    it("Should return correct staked tokens", async function () {
      const stakedTokens = await nftStaking.stakedTokens(staker1.address);
      expect(stakedTokens.length).to.equal(2);
      expect(stakedTokens[0]).to.equal(1n);
      expect(stakedTokens[1]).to.equal(2n);
    });

    it("Should return correct pending rewards", async function () {
      // Fast forward time by 10 seconds
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      const pendingRewards = await nftStaking.pendingRewards(staker1.address);
      expect(pendingRewards).to.equal(ethers.parseEther("20"));
    });
  });
});