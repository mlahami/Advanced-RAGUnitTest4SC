const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTStaking", function () {
  let nftStaking, nftContract, rewardToken, owner, staker1, staker2;
  const rewardRate = ethers.parseEther("1"); // 1 reward token per second per NFT

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

    // Approve NFTStaking to transfer NFTs
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
      await expect(nftStaking.connect(staker1).stake([1n]))
        .to.emit(nftStaking, "Staked")
        .withArgs(staker1.address, [1n]);
    });

    it("Should revert if not owner of NFT", async function () {
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

    it("Should revert if not owner of staked NFT", async function () {
      await expect(nftStaking.connect(staker2).unstake([1n]))
        .to.be.revertedWith("Not your token");
    });
  });

  describe("Rewards", function () {
    beforeEach(async function () {
      await nftStaking.connect(staker1).stake([1n]);
      await ethers.provider.send("evm_increaseTime", [10]); // 10 seconds
      await ethers.provider.send("evm_mine");
    });

    it("Should calculate pending rewards correctly", async function () {
      const pendingRewards = await nftStaking.pendingRewards(staker1.address);
      expect(pendingRewards).to.equal(ethers.parseEther("10")); // 10 seconds * 1 reward per second per NFT
    });

    it("Should allow claiming rewards", async function () {
      const initialBalance = await rewardToken.balanceOf(staker1.address);
      await nftStaking.connect(staker1).claimRewards();
      const newBalance = await rewardToken.balanceOf(staker1.address);

      expect(newBalance - initialBalance).to.equal(ethers.parseEther("10"));
    });

    it("Should emit RewardClaimed event", async function () {
      await expect(nftStaking.connect(staker1).claimRewards())
        .to.emit(nftStaking, "RewardClaimed")
        .withArgs(staker1.address, ethers.parseEther("10"));
    });

    it("Should revert if no rewards to claim", async function () {
      await nftStaking.connect(staker1).claimRewards();
      await expect(nftStaking.connect(staker1).claimRewards())
        .to.be.revertedWith("No rewards");
    });

    it("Should update rewards when staking or unstaking", async function () {
      await ethers.provider.send("evm_increaseTime", [5]); // 5 more seconds
      await ethers.provider.send("evm_mine");

      await nftStaking.connect(staker1).stake([2n]);
      const pendingRewards = await nftStaking.pendingRewards(staker1.address);
      expect(pendingRewards).to.be.lessThan(ethers.parseEther("15")); // Less than 15 because some time passed before staking
    });
  });

  describe("Admin functions", function () {
    it("Should allow owner to set reward rate", async function () {
      const newRate = ethers.parseEther("2");
      await nftStaking.setRewardRate(newRate);
      expect(await nftStaking.rewardRate()).to.equal(newRate);
    });

    it("Should revert if non-owner tries to set reward rate", async function () {
      const newRate = ethers.parseEther("2");
      await expect(nftStaking.connect(staker1).setRewardRate(newRate))
        .to.be.revertedWith("Not owner");
    });
  });

  describe("View functions", function () {
    it("Should return correct staked tokens", async function () {
      await nftStaking.connect(staker1).stake([1n, 2n]);
      const stakedTokens = await nftStaking.stakedTokens(staker1.address);
      expect(stakedTokens.length).to.equal(2);
      expect(stakedTokens[0]).to.equal(1n);
      expect(stakedTokens[1]).to.equal(2n);
    });

    it("Should return zero pending rewards for non-stakers", async function () {
      const pendingRewards = await nftStaking.pendingRewards(staker2.address);
      expect(pendingRewards).to.equal(0n);
    });
  });
});