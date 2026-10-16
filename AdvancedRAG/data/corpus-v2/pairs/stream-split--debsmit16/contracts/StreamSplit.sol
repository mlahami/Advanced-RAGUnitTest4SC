// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title StreamSplit
 * @dev Real-time salary streaming contract for Celo blockchain
 * @notice Allows employers to stream salaries to workers on a per-second basis
 */
contract StreamSplit {
    
    /// @dev Structure to store payment stream data
    struct Stream {
        address employer;          // Address of the employer paying
        address worker;            // Address of the worker receiving payment
        uint256 ratePerSecond;     // Payment rate in wei per second
        uint256 startTime;         // Timestamp when stream started
        uint256 lastWithdrawal;    // Timestamp of last withdrawal
        uint256 deposit;           // Total amount deposited by employer
        uint256 withdrawn;         // Total amount already withdrawn by worker
        bool active;               // Whether stream is currently active
    }
    
    /// @dev Mapping from stream ID to Stream struct
    mapping(uint256 => Stream) public streams;
    
    /// @dev Counter for generating unique stream IDs
    uint256 public nextStreamId;
    
    /// @dev Events
    event StreamCreated(
        uint256 indexed streamId,
        address indexed employer,
        address indexed worker,
        uint256 ratePerSecond,
        uint256 deposit
    );
    
    event Withdrawn(
        uint256 indexed streamId,
        address indexed worker,
        uint256 amount,
        uint256 timestamp
    );
    
    event StreamPaused(uint256 indexed streamId, uint256 timestamp);
    event StreamResumed(uint256 indexed streamId, uint256 timestamp);
    event StreamStopped(uint256 indexed streamId, uint256 remainingBalance);
    event DepositAdded(uint256 indexed streamId, uint256 amount);
    
    /**
     * @dev Create a new payment stream
     * @param worker Address of the worker to receive payments
     * @param ratePerSecond Payment rate in wei per second
     * @return streamId The ID of the created stream
     */
    function createStream(
        address worker,
        uint256 ratePerSecond
    ) external payable returns (uint256) {
        require(worker != address(0), "Invalid worker address");
        require(worker != msg.sender, "Cannot stream to yourself");
        require(ratePerSecond > 0, "Rate must be positive");
        require(msg.value > 0, "Must deposit funds");
        
        uint256 streamId = nextStreamId++;
        
        streams[streamId] = Stream({
            employer: msg.sender,
            worker: worker,
            ratePerSecond: ratePerSecond,
            startTime: block.timestamp,
            lastWithdrawal: block.timestamp,
            deposit: msg.value,
            withdrawn: 0,
            active: true
        });
        
        emit StreamCreated(streamId, msg.sender, worker, ratePerSecond, msg.value);
        
        return streamId;
    }
    
    /**
     * @dev Calculate the amount earned by worker up to current time
     * @param streamId The ID of the stream
     * @return earned Amount earned in wei
     */
    function calculateEarned(uint256 streamId) public view returns (uint256) {
        Stream memory stream = streams[streamId];
        
        if (!stream.active) {
            return 0;
        }
        
        // Calculate time worked since last withdrawal
        uint256 timeWorked = block.timestamp - stream.lastWithdrawal;
        
        // Calculate earned amount
        uint256 earned = timeWorked * stream.ratePerSecond;
        
        // Ensure we don't exceed remaining balance
        uint256 remaining = stream.deposit - stream.withdrawn;
        if (earned > remaining) {
            earned = remaining;
        }
        
        return earned;
    }
    
    /**
     * @dev Worker withdraws their earned amount
     * @param streamId The ID of the stream
     */
    function withdraw(uint256 streamId) external {
        Stream storage stream = streams[streamId];
        
        require(msg.sender == stream.worker, "Only worker can withdraw");
        require(stream.active, "Stream not active");
        
        uint256 earned = calculateEarned(streamId);
        require(earned > 0, "Nothing to withdraw");
        
        // Update stream state
        stream.withdrawn += earned;
        stream.lastWithdrawal = block.timestamp;
        
        // Transfer funds to worker
        (bool success, ) = payable(stream.worker).call{value: earned}("");
        require(success, "Transfer failed");
        
        emit Withdrawn(streamId, stream.worker, earned, block.timestamp);
    }
    
    /**
     * @dev Employer pauses the stream
     * @param streamId The ID of the stream
     */
    function pauseStream(uint256 streamId) external {
        Stream storage stream = streams[streamId];
        
        require(msg.sender == stream.employer, "Only employer can pause");
        require(stream.active, "Stream already paused");
        
        stream.active = false;
        
        emit StreamPaused(streamId, block.timestamp);
    }
    
    /**
     * @dev Employer resumes a paused stream
     * @param streamId The ID of the stream
     */
    function resumeStream(uint256 streamId) external {
        Stream storage stream = streams[streamId];
        
        require(msg.sender == stream.employer, "Only employer can resume");
        require(!stream.active, "Stream already active");
        
        // Reset last withdrawal time to current time to avoid paying for paused period
        stream.lastWithdrawal = block.timestamp;
        stream.active = true;
        
        emit StreamResumed(streamId, block.timestamp);
    }
    
    /**
     * @dev Employer stops stream and withdraws remaining balance
     * @param streamId The ID of the stream
     */
    function stopStream(uint256 streamId) external {
        Stream storage stream = streams[streamId];
        
        require(msg.sender == stream.employer, "Only employer can stop");
        
        // Calculate and pay any earned amount first
        if (stream.active) {
            uint256 earned = calculateEarned(streamId);
            if (earned > 0) {
                stream.withdrawn += earned;
                (bool success, ) = payable(stream.worker).call{value: earned}("");
                require(success, "Transfer to worker failed");
                
                emit Withdrawn(streamId, stream.worker, earned, block.timestamp);
            }
        }
        
        // Calculate remaining balance
        uint256 remaining = stream.deposit - stream.withdrawn;
        
        // Mark stream as inactive
        stream.active = false;
        
        // Return remaining funds to employer
        if (remaining > 0) {
            (bool success, ) = payable(stream.employer).call{value: remaining}("");
            require(success, "Transfer to employer failed");
        }
        
        emit StreamStopped(streamId, remaining);
    }
    
    /**
     * @dev Employer adds more funds to existing stream
     * @param streamId The ID of the stream
     */
    function addDeposit(uint256 streamId) external payable {
        Stream storage stream = streams[streamId];
        
        require(msg.sender == stream.employer, "Only employer can add deposit");
        require(msg.value > 0, "Must deposit funds");
        
        stream.deposit += msg.value;
        
        emit DepositAdded(streamId, msg.value);
    }
    
    /**
     * @dev Get detailed information about a stream
     * @param streamId The ID of the stream
     * @return employer Address of employer
     * @return worker Address of worker
     * @return ratePerSecond Payment rate
     * @return deposit Total deposited
     * @return withdrawn Total withdrawn
     * @return earned Currently earned amount
     * @return remaining Remaining balance
     * @return active Stream status
     */
    function getStreamInfo(uint256 streamId) external view returns (
        address employer,
        address worker,
        uint256 ratePerSecond,
        uint256 deposit,
        uint256 withdrawn,
        uint256 earned,
        uint256 remaining,
        bool active
    ) {
        Stream memory stream = streams[streamId];
        uint256 currentEarned = calculateEarned(streamId);
        
        return (
            stream.employer,
            stream.worker,
            stream.ratePerSecond,
            stream.deposit,
            stream.withdrawn,
            currentEarned,
            stream.deposit - stream.withdrawn - currentEarned,
            stream.active
        );
    }
    
    /**
     * @dev Get total number of streams created
     * @return Total stream count
     */
    function getTotalStreams() external view returns (uint256) {
        return nextStreamId;
    }
}
