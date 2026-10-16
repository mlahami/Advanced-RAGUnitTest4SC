# time-flow-vault--ogazboiz

- domain: vesting-timelock (timelock)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/ogazboiz/TimeFlowVault @ 8eb6b760a3e169a42b2259807fc926ed816387a1
- license: MIT
- targets: TimeFlowVault.sol
- validation: 17 passing tests, 0 failing; statement coverage TimeFlowVault.sol 95.12 %

## Contract: TimeFlowVault.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TimeFlowVault
 * @dev Hybrid protocol combining real-time money streaming with realistic DeFi vault functionality
 * 
 * KEY FEATURES:
 * 1. Streaming fees generate revenue for rewards
 * 2. Rewards only paid when contract has sufficient funds
 * 3. No infinite money printing
 * 4. Sustainable reward system
 */
contract TimeFlowVault is ReentrancyGuard, Ownable {
    // ============ STREAMING FEATURES ============
    
    struct Stream {
        address sender;
        address recipient;
        uint256 totalAmount;
        uint256 flowRate; // amount per second
        uint256 startTime;
        uint256 stopTime;
        uint256 amountWithdrawn;
        bool isActive;
    }

    mapping(uint256 => Stream) public streams;
    uint256 public nextStreamId;
    
    // Streaming fee (0.1% = 10 basis points)
    uint256 public constant STREAMING_FEE_BPS = 10; // 0.1%
    uint256 public totalFeesCollected;

    // ============ VAULT FEATURES ============
    
    string public vaultName;
    uint256 public totalStaked;
    uint256 public totalRewardsAvailable; // Only what we can actually pay
    uint256 public lastUpdateTime;
    uint256 public rewardRate; // basis points per second
    bool public vaultActive;

    struct Stake {
        uint256 amount;
        uint256 startTime;
        uint256 lastClaimTime;
        uint256 accumulatedRewards;
        bool isActive;
    }

    mapping(address => Stake) public stakes;
    mapping(address => uint256) public userRewards;

    // ============ EVENTS ============
    
    // Streaming events
    event StreamCreated(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient,
        uint256 totalAmount,
        uint256 flowRate,
        uint256 startTime,
        uint256 stopTime,
        uint256 feeCollected
    );

    event Withdrawn(
        uint256 indexed streamId,
        address indexed recipient,
        uint256 amount
    );

    event StreamCancelled(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient,
        uint256 senderBalance,
        uint256 recipientBalance
    );

    // Vault events
    event VaultCreated(string vaultName, uint256 initialRewardRate);
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount);
    event VaultPaused(bool paused);
    event RewardRateUpdated(uint256 newRate);
    event FeesCollected(uint256 amount);

    // ============ MODIFIERS ============
    
    modifier onlyVaultActive() {
        require(vaultActive, "TimeFlowVault: Vault is paused");
        _;
    }

    modifier validAmount(uint256 amount) {
        require(amount > 0, "TimeFlowVault: Amount must be positive");
        _;
    }

    // ============ CONSTRUCTOR ============
    
    constructor(string memory _vaultName, uint256 _initialRewardRate) Ownable(msg.sender) {
        vaultName = _vaultName;
        rewardRate = _initialRewardRate;
        vaultActive = true;
        lastUpdateTime = block.timestamp;
        
        emit VaultCreated(_vaultName, _initialRewardRate);
    }

    // ============ STREAMING FUNCTIONS ============
    
    /**
     * @dev Create a new money stream with fee collection
     * @param recipient Address receiving the stream
     * @param duration Duration of the stream in seconds
     */
    function createStream(address recipient, uint256 duration) external payable {
        require(recipient != address(0), "TimeFlowVault: Invalid recipient");
        require(recipient != msg.sender, "TimeFlowVault: Cannot stream to self");
        require(duration > 0, "TimeFlowVault: Duration must be positive");
        require(msg.value > 0, "TimeFlowVault: Amount must be positive");

        // Calculate and collect streaming fee
        uint256 fee = (msg.value * STREAMING_FEE_BPS) / 10000;
        uint256 streamAmount = msg.value - fee;
        
        // Fee goes to rewards pool
        totalFeesCollected += fee;
        totalRewardsAvailable += fee;
        
        uint256 streamId = nextStreamId++;
        uint256 flowRate = streamAmount / duration;

        streams[streamId] = Stream({
            sender: msg.sender,
            recipient: recipient,
            totalAmount: streamAmount,
            flowRate: flowRate,
            startTime: block.timestamp,
            stopTime: block.timestamp + duration,
            amountWithdrawn: 0,
            isActive: true
        });

        emit StreamCreated(
            streamId,
            msg.sender,
            recipient,
            streamAmount,
            flowRate,
            block.timestamp,
            block.timestamp + duration,
            fee
        );
        
        emit FeesCollected(fee);
    }

    /**
     * @dev Withdraw funds from a stream
     * @param streamId ID of the stream to withdraw from
     */
    function withdrawFromStream(uint256 streamId) external nonReentrant {
        Stream storage stream = streams[streamId];
        require(stream.isActive, "TimeFlowVault: Stream is not active");
        require(msg.sender == stream.recipient, "TimeFlowVault: Only recipient can withdraw");

        uint256 claimable = getClaimableBalance(streamId);
        require(claimable > 0, "TimeFlowVault: Nothing to withdraw");

        stream.amountWithdrawn += claimable;
        
        // If stream is finished and all funds withdrawn, mark as inactive
        if (block.timestamp >= stream.stopTime && 
            stream.amountWithdrawn >= stream.totalAmount) {
            stream.isActive = false;
        }

        (bool success, ) = msg.sender.call{value: claimable}("");
        require(success, "TimeFlowVault: Transfer failed");

        emit Withdrawn(streamId, msg.sender, claimable);
    }

    /**
     * @dev Cancel a stream and refund remaining funds
     * @param streamId ID of the stream to cancel
     */
    function cancelStream(uint256 streamId) external nonReentrant {
        Stream storage stream = streams[streamId];
        require(stream.isActive, "TimeFlowVault: Stream is not active");
        require(
            msg.sender == stream.sender || msg.sender == stream.recipient,
            "TimeFlowVault: Only sender or recipient can cancel"
        );

        uint256 recipientBalance = getClaimableBalance(streamId);
        uint256 senderBalance = stream.totalAmount - stream.amountWithdrawn - recipientBalance;

        stream.isActive = false;

        // Refund recipient
        if (recipientBalance > 0) {
            (bool success, ) = stream.recipient.call{value: recipientBalance}("");
            require(success, "TimeFlowVault: Recipient refund failed");
        }

        // Refund sender
        if (senderBalance > 0) {
            (bool success, ) = stream.sender.call{value: senderBalance}("");
            require(success, "TimeFlowVault: Sender refund failed");
        }

        emit StreamCancelled(
            streamId,
            stream.sender,
            stream.recipient,
            senderBalance,
            recipientBalance
        );
    }

    /**
     * @dev Get the claimable balance for a stream
     * @param streamId ID of the stream
     * @return Claimable amount in wei
     */
    function getClaimableBalance(uint256 streamId) public view returns (uint256) {
        Stream storage stream = streams[streamId];
        if (!stream.isActive) return 0;

        uint256 currentTime = block.timestamp;
        uint256 cappedNow = currentTime > stream.stopTime ? stream.stopTime : currentTime;
        uint256 elapsed = cappedNow - stream.startTime;
        
        uint256 streamedSoFar = elapsed * stream.flowRate;
        uint256 claimable = streamedSoFar > stream.amountWithdrawn ? 
            streamedSoFar - stream.amountWithdrawn : 0;

        return claimable;
    }

    // ============ VAULT FUNCTIONS ============
    
    /**
     * @dev Stake ETH into the vault
     */
    function stake() external payable onlyVaultActive validAmount(msg.value) nonReentrant {
        require(!stakes[msg.sender].isActive, "TimeFlowVault: Already staked");
        
        stakes[msg.sender] = Stake({
            amount: msg.value,
            startTime: block.timestamp,
            lastClaimTime: block.timestamp,
            accumulatedRewards: 0,
            isActive: true
        });
        
        totalStaked += msg.value;
        emit Staked(msg.sender, msg.value);
    }

    /**
     * @dev Unstake ETH from the vault
     * @param amount Amount to unstake
     */
    function unstake(uint256 amount) external onlyVaultActive validAmount(amount) nonReentrant {
        Stake storage userStake = stakes[msg.sender];
        require(userStake.isActive, "TimeFlowVault: No active stake");
        require(amount <= userStake.amount, "TimeFlowVault: Insufficient staked amount");
        
        userStake.amount -= amount;
        totalStaked -= amount;
        
        if (userStake.amount == 0) {
            userStake.isActive = false;
        }
        
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "TimeFlowVault: Transfer failed");
        
        emit Unstaked(msg.sender, amount);
    }

    /**
     * @dev Claim accumulated rewards (REALISTIC: only what we can afford)
     */
    function claimRewards() external onlyVaultActive nonReentrant {
        require(stakes[msg.sender].isActive, "TimeFlowVault: No active stake");
        
        // Calculate new rewards since last claim
        uint256 timeElapsed = block.timestamp - stakes[msg.sender].lastClaimTime;
        uint256 newRewards = (stakes[msg.sender].amount * rewardRate * timeElapsed) / 10000;
        uint256 totalClaimable = userRewards[msg.sender] + newRewards;
        
        require(totalClaimable > 0, "TimeFlowVault: No rewards to claim");
        
        // CRITICAL: Only pay what we can afford
        uint256 actualPayout = totalClaimable > totalRewardsAvailable ? 
            totalRewardsAvailable : totalClaimable;
        
        require(actualPayout > 0, "TimeFlowVault: No rewards available to claim");
        
        // Update user's last claim time and reset accumulated rewards
        stakes[msg.sender].lastClaimTime = block.timestamp;
        userRewards[msg.sender] = 0;
        
        // Reduce available rewards
        totalRewardsAvailable -= actualPayout;
        
        // Transfer actual available rewards to user
        (bool success, ) = msg.sender.call{value: actualPayout}("");
        require(success, "TimeFlowVault: Transfer failed");
        
        emit RewardsClaimed(msg.sender, actualPayout);
    }

    /**
     * @dev Get claimable rewards for a user
     * @param user Address of the user
     * @return Claimable rewards amount
     */
    function getClaimableRewards(address user) external view returns (uint256) {
        if (!stakes[user].isActive) return userRewards[user];
        
        uint256 timeElapsed = block.timestamp - stakes[user].lastClaimTime;
        uint256 newRewards = (stakes[user].amount * rewardRate * timeElapsed) / 10000;
        
        return userRewards[user] + newRewards;
    }

    /**
     * @dev Get REALISTIC claimable rewards (capped by available funds)
     * @param user Address of the user
     * @return Actually claimable rewards amount
     */
    function getRealisticClaimableRewards(address user) external view returns (uint256) {
        uint256 theoretical = this.getClaimableRewards(user);
        return theoretical > totalRewardsAvailable ? totalRewardsAvailable : theoretical;
    }

    // ============ VIEW FUNCTIONS ============
    
    /**
     * @dev Get stream information
     * @param streamId ID of the stream
     * @return Stream details
     */
    function getStream(uint256 streamId) external view returns (Stream memory) {
        return streams[streamId];
    }

    /**
     * @dev Get total streams count
     * @return Total number of streams created
     */
    function getTotalStreams() external view returns (uint256) {
        return nextStreamId;
    }

    /**
     * @dev Get user stake information
     * @param user Address of the user
     * @return Stake details
     */
    function getUserStake(address user) external view returns (Stake memory) {
        return stakes[user];
    }

    /**
     * @dev Get vault statistics
     * @return Total staked, total rewards available, reward rate
     */
    function getVaultStats() external view returns (uint256, uint256, uint256) {
        return (totalStaked, totalRewardsAvailable, rewardRate);
    }

    /**
     * @dev Get streaming fee information
     * @return Fee basis points, total fees collected
     */
    function getFeeInfo() external view returns (uint256, uint256) {
        return (STREAMING_FEE_BPS, totalFeesCollected);
    }

    // ============ ADMIN FUNCTIONS ============
    
    /**
     * @dev Update reward rate
     * @param newRate New reward rate in basis points per second
     */
    function updateRewardRate(uint256 newRate) external onlyOwner {
        rewardRate = newRate;
        emit RewardRateUpdated(newRate);
    }

    /**
     * @dev Pause/unpause vault
     * @param paused Whether to pause the vault
     */
    function setVaultPaused(bool paused) external onlyOwner {
        vaultActive = !paused;
        emit VaultPaused(paused);
    }

    /**
     * @dev Update vault parameters
     * @param _vaultName New vault name
     */
    function updateVaultParams(string memory _vaultName) external onlyOwner {
        vaultName = _vaultName;
    }

    /**
     * @dev Emergency pause function
     */
    function emergencyPause() external onlyOwner {
        vaultActive = false;
        emit VaultPaused(true);
    }

    /**
     * @dev Withdraw excess fees (owner only, for protocol maintenance)
     * @param amount Amount to withdraw
     */
    function withdrawExcessFees(uint256 amount) external onlyOwner {
        require(amount <= totalFeesCollected, "TimeFlowVault: Amount exceeds collected fees");
        require(amount <= address(this).balance - totalStaked, "TimeFlowVault: Insufficient balance");
        
        totalFeesCollected -= amount;
        totalRewardsAvailable = totalRewardsAvailable > amount ? 
            totalRewardsAvailable - amount : 0;
        
        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "TimeFlowVault: Transfer failed");
    }

    // ============ INTERNAL FUNCTIONS ============
    
    /**
     * @dev Get vault information
     * @return name Vault name
     * @return staked Total staked amount
     * @return rewards Total rewards available
     * @return rate Current reward rate
     * @return active Whether vault is active
     */
    function getVaultInfo() external view returns (
        string memory name,
        uint256 staked,
        uint256 rewards,
        uint256 rate,
        bool active
    ) {
        return (vaultName, totalStaked, totalRewardsAvailable, rewardRate, vaultActive);
    }
}
```

## Tests: TimeFlowVault.js

```javascript
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
```
