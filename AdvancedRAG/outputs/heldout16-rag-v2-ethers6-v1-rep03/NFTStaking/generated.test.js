const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTStaking", function () {
  let nftStaking, nftContract, rewardToken;
  let owner, staker1, staker2;
  const rewardRate = ethers.parseEther("1"); // 1 reward token per second per NFT

  beforeEach(async function () {
    [owner, staker1, staker2] = await ethers.getSigners();

    // Deploy benchmark fixtures
    const BenchmarkERC721 = await ethers.getContractFactory("BenchmarkERC721");
    nftContract = await BenchmarkERC721.deploy("TestNFT", "TNFT");
    await nftContract.waitForDeployment();

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
      await nftStaking.connect(staker1).stake([1, 2]);

      const stakedTokens = await nftStaking.stakedTokens(staker1.address);
      expect(stakedTokens.length).to.equal(2);
      expect(stakedTokens[0]).to.equal(1);
      expect(stakedTokens[1]).to.equal(2);

      expect(await nftContract.ownerOf(1)).to.equal(await nftStaking.getAddress());
      expect(await nftContract.ownerOf(2)).to.equal(await nftStaking.getAddress());
    });

    it("Should emit Staked event", async function () {
      await expect(nftStaking.connect(staker1).stake([1]))
        .to.emit(nftStaking, "Staked")
        .withArgs(staker1.address, [1]);
    });

    it("Should revert if not the owner of the NFT", async function () {
      await expect(nftStaking.connect(staker1).stake([3]))
        .to.be.revertedWith("Not owner");
    });

    it("Should revert if NFT is already staked", async function () {
      await nftStaking.connect(staker1).stake([1]);
      await expect(nftStaking.connect(staker1).stake([1]))
        .to.be.revertedWith("Already staked");
    });
  });

  describe("Unstaking", function () {
    beforeEach(async function () {
      await nftStaking.connect(staker1).stake([1, 2]);
    });

    it("Should allow unstaking NFTs", async function () {
      await nftStaking.connect(staker1).unstake([1]);

      const stakedTokens = await nftStaking.stakedTokens(staker1.address);
      expect(stakedTokens.length).to.equal(1);
      expect(stakedTokens[0]).to.equal(2);

      expect(await nftContract.ownerOf(1)).to.equal(staker1.address);
      expect(await nftContract.ownerOf(2)).to.equal(await nftStaking.getAddress());
    });

    it("Should emit Unstaked event", async function () {
      await expect(nftStaking.connect(staker1).unstake([1]))
        .to.emit(nftStaking, "Unstaked")
        .withArgs(staker1.address, [1]);
    });

    it("Should revert if not the owner of the staked NFT", async function () {
      await expect(nftStaking.connect(staker2).unstake([1]))
        .to.be.revertedWith("Not your token");
    });
  });

  describe("Rewards", function () {
    beforeEach(async function () {
      await nftStaking.connect(staker1).stake([1, 2]);
      await nftStaking.connect(staker2).stake([3]);
    });

    it("Should calculate pending rewards correctly", async function () {
      // Fast forward time by 10 seconds
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      // Staker1 should have rewards for 2 NFTs × 10 seconds = 20 reward tokens
      const pendingRewards1 = await nftStaking.pendingRewards(staker1.address);
      expect(pendingRewards1).to.equal(ethers.parseEther("20"));

      // Staker2 should have rewards for 1 NFT × 10 seconds = 10 reward tokens
      const pendingRewards2 = await nftStaking.pendingRewards(staker2.address);
      expect(pendingRewards2).to.equal(ethers.parseEther("10"));
    });

    it("Should allow claiming rewards", async function () {
      // Fast forward time by 10 seconds
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      // Claim rewards
      await nftStaking.connect(staker1).claimRewards();

      // Verify reward token balance
      const balance = await rewardToken.balanceOf(staker1.address);
      expect(balance).to.equal(ethers.parseEther("20"));

      // Verify accrued rewards reset to 0
      const pendingRewards = await nftStaking.pendingRewards(staker1.address);
      expect(pendingRewards).to.equal(0);
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

  describe("Admin Functions", function () {
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

  describe("Edge Cases", function () {
    it("Should handle multiple stake/unstake operations", async function () {
      // Stake NFTs
      await nftStaking.connect(staker1).stake([1, 2]);

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [5]);
      await ethers.provider.send("evm_mine");

      // Unstake one NFT
      await nftStaking.connect(staker1).unstake([1]);

      // Fast forward more time
      await ethers.provider.send("evm_increaseTime", [5]);
      await ethers.provider.send("evm_mine");

      // Stake another NFT
      await nftStaking.connect(staker1).stake([3]);

      // Fast forward more time
      await ethers.provider.send("evm_increaseTime", [5]);
      await ethers.provider.send("evm_mine");

      // Calculate expected rewards:
      // First 5 seconds: 2 NFTs → 10 reward tokens
      // Next 5 seconds: 1 NFT → 5 reward tokens
      // Last 5 seconds: 2 NFTs → 10 reward tokens
      // Total: 25 reward tokens
      const pendingRewards = await nftStaking.pendingRewards(staker1.address);
      expect(pendingRewards).to.equal(ethers.parseEther("25"));
    });

    it("Should handle zero reward rate", async function () {
      await nftStaking.connect(owner).setRewardRate(0);
      await nftStaking.connect(staker1).stake([1]);

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      const pendingRewards = await nftStaking.pendingRewards(staker1.address);
      expect(pendingRewards).to.equal(0);
    });
  });
});