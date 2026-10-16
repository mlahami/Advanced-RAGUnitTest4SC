const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TimeFlowVault", function () {
  let timeFlowVault;
  let owner;
  let user1;
  let user2;
  let user3;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();
    
    const TimeFlowVault = await ethers.getContractFactory("TimeFlowVault");
    // Use a very low reward rate for testing (15 = 0.15% per second for testing)
    timeFlowVault = await TimeFlowVault.deploy("Test Vault", 15);
    await timeFlowVault.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should deploy successfully", async function () {
      expect(await timeFlowVault.getAddress()).to.be.properAddress;
      expect(await timeFlowVault.vaultName()).to.equal("Test Vault");
      expect(await timeFlowVault.rewardRate()).to.equal(15);
      expect(await timeFlowVault.vaultActive()).to.be.true;
      expect(await timeFlowVault.nextStreamId()).to.equal(0);
      expect(await timeFlowVault.STREAMING_FEE_BPS()).to.equal(10); // 0.1%
    });
  });

  describe("Streaming Features", function () {
    it("Should create a stream successfully and collect fees", async function () {
      const amount = ethers.parseEther("1"); // 1 ETH
      const duration = 3600; // 1 hour
      
      const tx = await timeFlowVault.connect(user1).createStream(user2.address, duration, { value: amount });
      await expect(tx).to.emit(timeFlowVault, "StreamCreated");
      await expect(tx).to.emit(timeFlowVault, "FeesCollected");
      
      const stream = await timeFlowVault.streams(0);
      expect(stream.sender).to.equal(user1.address);
      expect(stream.recipient).to.equal(user2.address);
      expect(stream.totalAmount).to.equal(amount - (amount * 10n / 10000n)); // Amount minus fee
      expect(stream.flowRate).to.equal((amount - (amount * 10n / 10000n)) / BigInt(duration));
      expect(stream.isActive).to.be.true;
      
      // Check fees were collected
      const feeInfo = await timeFlowVault.getFeeInfo();
      expect(feeInfo[1]).to.be.gt(0); // Total fees collected
    });

    it("Should allow recipient to withdraw from stream", async function () {
      const amount = ethers.parseEther("1");
      const duration = 3600;
      await timeFlowVault.connect(user1).createStream(user2.address, duration, { value: amount });
      
      // Fast forward 30 minutes
      await ethers.provider.send("evm_increaseTime", [1800]);
      await ethers.provider.send("evm_mine");
      
      const initialBalance = await ethers.provider.getBalance(user2.address);
      
      const tx = await timeFlowVault.connect(user2).withdrawFromStream(0);
      await expect(tx).to.emit(timeFlowVault, "Withdrawn");
      
      const finalBalance = await ethers.provider.getBalance(user2.address);
      expect(finalBalance).to.be.gt(initialBalance);
    });

    it("Should allow stream cancellation", async function () {
      const amount = ethers.parseEther("1");
      const duration = 3600;
      await timeFlowVault.connect(user1).createStream(user2.address, duration, { value: amount });
      
      const tx = await timeFlowVault.connect(user1).cancelStream(0);
      await expect(tx).to.emit(timeFlowVault, "StreamCancelled");
      
      const stream = await timeFlowVault.streams(0);
      expect(stream.isActive).to.be.false;
    });
  });

  describe("Vault Features", function () {
    it("Should allow staking", async function () {
      const stakeAmount = ethers.parseEther("100");
      
      const tx = await timeFlowVault.connect(user1).stake({ value: stakeAmount });
      await expect(tx).to.emit(timeFlowVault, "Staked");
      
      const stake = await timeFlowVault.getUserStake(user1.address);
      expect(stake.amount).to.equal(stakeAmount);
      expect(stake.isActive).to.be.true;
      
      const stats = await timeFlowVault.getVaultStats();
      expect(stats[0]).to.equal(stakeAmount); // totalStaked
    });

    it("Should allow unstaking", async function () {
      const stakeAmount = ethers.parseEther("100");
      await timeFlowVault.connect(user1).stake({ value: stakeAmount });
      
      const unstakeAmount = ethers.parseEther("50");
      const initialBalance = await ethers.provider.getBalance(user1.address);
      
      const tx = await timeFlowVault.connect(user1).unstake(unstakeAmount);
      await expect(tx).to.emit(timeFlowVault, "Unstaked");
      
      const finalBalance = await ethers.provider.getBalance(user1.address);
      expect(finalBalance).to.be.gt(initialBalance);
      
      const stake = await timeFlowVault.getUserStake(user1.address);
      expect(stake.amount).to.equal(stakeAmount - unstakeAmount);
    });

    it("Should calculate rewards correctly", async function () {
      const stakeAmount = ethers.parseEther("100");
      await timeFlowVault.connect(user1).stake({ value: stakeAmount });
      
      // Fast forward 1 day
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");
      
      const claimable = await timeFlowVault.getClaimableRewards(user1.address);
      expect(claimable).to.be.gt(0);
    });

    it("Should allow claiming rewards when fees are available", async function () {
      const stakeAmount = ethers.parseEther("100");
      await timeFlowVault.connect(user1).stake({ value: stakeAmount });
      
      // Create streams to generate fees for rewards
      const streamAmount = ethers.parseEther("10");
      const duration = 3600;
      
      // Create multiple streams to generate enough fees
      for (let i = 0; i < 5; i++) {
        await timeFlowVault.connect(user2).createStream(user3.address, duration, { value: streamAmount });
      }
      
      // Debug: Check balances
      console.log("Contract balance after streams:", ethers.formatEther(await ethers.provider.getBalance(await timeFlowVault.getAddress())));
      console.log("Total staked:", ethers.formatEther(await timeFlowVault.totalStaked()));
      console.log("Total rewards available:", ethers.formatEther(await timeFlowVault.totalRewardsAvailable()));
      console.log("Reward rate:", await timeFlowVault.rewardRate());
      
      // Fast forward 1 hour to generate smaller rewards
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine");
      
      // Debug: Check claimable rewards
      const claimable = await timeFlowVault.getClaimableRewards(user1.address);
      const realisticClaimable = await timeFlowVault.getRealisticClaimableRewards(user1.address);
      console.log("Theoretical claimable rewards:", ethers.formatEther(claimable));
      console.log("Realistic claimable rewards:", ethers.formatEther(realisticClaimable));
      
      const initialBalance = await ethers.provider.getBalance(user1.address);
      
      const tx = await timeFlowVault.connect(user1).claimRewards();
      await expect(tx).to.emit(timeFlowVault, "RewardsClaimed");
      
      const finalBalance = await ethers.provider.getBalance(user1.address);
      expect(finalBalance).to.be.gt(initialBalance);
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to update reward rate", async function () {
      const newRate = 2000; // 20% APY
      
      const tx = await timeFlowVault.connect(owner).updateRewardRate(newRate);
      await expect(tx).to.emit(timeFlowVault, "RewardRateUpdated");
      
      expect(await timeFlowVault.rewardRate()).to.equal(newRate);
    });

    it("Should allow owner to pause vault", async function () {
      const tx = await timeFlowVault.connect(owner).setVaultPaused(true);
      await expect(tx).to.emit(timeFlowVault, "VaultPaused");
      
      expect(await timeFlowVault.vaultActive()).to.be.false;
    });

    it("Should prevent non-owner from calling admin functions", async function () {
      await expect(
        timeFlowVault.connect(user1).updateRewardRate(2000)
      ).to.be.revertedWithCustomError(timeFlowVault, "OwnableUnauthorizedAccount");
      
      await expect(
        timeFlowVault.connect(user1).setVaultPaused(true)
      ).to.be.revertedWithCustomError(timeFlowVault, "OwnableUnauthorizedAccount");
    });

    it("Should allow owner to withdraw excess fees", async function () {
      // Create some streams to generate fees
      const streamAmount = ethers.parseEther("10");
      const duration = 3600;
      await timeFlowVault.connect(user1).createStream(user2.address, duration, { value: streamAmount });
      
      const initialBalance = await ethers.provider.getBalance(owner.address);
      const feeInfo = await timeFlowVault.getFeeInfo();
      const withdrawAmount = feeInfo[1] / 2n; // Withdraw half of collected fees
      
      const tx = await timeFlowVault.connect(owner).withdrawExcessFees(withdrawAmount);
      
      const finalBalance = await ethers.provider.getBalance(owner.address);
      expect(finalBalance).to.be.gt(initialBalance);
    });
  });

  describe("Integration Features", function () {
    it("Should handle both streaming and staking simultaneously", async function () {
      // Create a stream
      const streamAmount = ethers.parseEther("100");
      const duration = 3600;
      await timeFlowVault.connect(user1).createStream(user2.address, duration, { value: streamAmount });
      
      // Stake in vault
      const stakeAmount = ethers.parseEther("50");
      await timeFlowVault.connect(user3).stake({ value: stakeAmount });
      
      // Verify both exist
      const stream = await timeFlowVault.getStream(0);
      const stake = await timeFlowVault.getUserStake(user3.address);
      
      expect(stream.isActive).to.be.true;
      expect(stake.isActive).to.be.true;
      expect(await timeFlowVault.getTotalStreams()).to.equal(1);
      
      const stats = await timeFlowVault.getVaultStats();
      expect(stats[0]).to.equal(stakeAmount); // totalStaked
    });

    it("Should maintain separate state for streams and vault", async function () {
      // Create multiple streams
      await timeFlowVault.connect(user1).createStream(user2.address, 3600, { value: ethers.parseEther("100") });
      await timeFlowVault.connect(user2).createStream(user3.address, 7200, { value: ethers.parseEther("200") });
      
      // Stake in vault
      await timeFlowVault.connect(user1).stake({ value: ethers.parseEther("50") });
      
      // Verify counts
      expect(await timeFlowVault.getTotalStreams()).to.equal(2);
      
      const stats = await timeFlowVault.getVaultStats();
      expect(stats[0]).to.equal(ethers.parseEther("50")); // totalStaked
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero amounts correctly", async function () {
      await expect(
        timeFlowVault.connect(user1).stake({ value: 0 })
      ).to.be.revertedWith("TimeFlowVault: Amount must be positive");
      
      await expect(
        timeFlowVault.connect(user1).createStream(user2.address, 3600, { value: 0 })
      ).to.be.revertedWith("TimeFlowVault: Amount must be positive");
    });

    it("Should prevent double staking", async function () {
      await timeFlowVault.connect(user1).stake({ value: ethers.parseEther("100") });
      
      await expect(
        timeFlowVault.connect(user1).stake({ value: ethers.parseEther("50") })
      ).to.be.revertedWith("TimeFlowVault: Already staked");
    });

    it("Should handle vault pausing correctly", async function () {
      await timeFlowVault.connect(owner).setVaultPaused(true);
      
      await expect(
        timeFlowVault.connect(user1).stake({ value: ethers.parseEther("100") })
      ).to.be.revertedWith("TimeFlowVault: Vault is paused");
      
      // Streaming should still work when vault is paused
      const amount = ethers.parseEther("100");
      const duration = 3600;
      await timeFlowVault.connect(user1).createStream(user2.address, duration, { value: amount });
      
      const stream = await timeFlowVault.getStream(0);
      expect(stream.isActive).to.be.true;
    });
  });
});
