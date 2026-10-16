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
