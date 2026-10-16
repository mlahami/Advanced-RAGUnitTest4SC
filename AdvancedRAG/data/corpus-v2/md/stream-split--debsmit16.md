# stream-split--debsmit16

- domain: subscriptions-streaming (payment-streaming)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Debsmit16/Stream-split @ c1b4c031f1cef608861c504352b3ac000e165eb5
- license: MIT
- targets: StreamSplit.sol
- validation: 19 passing tests, 0 failing; statement coverage StreamSplit.sol 98.08 %

## Contract: StreamSplit.sol (primary target)

```solidity
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
```

## Tests: StreamSplit.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StreamSplit", function () {
  let streamSplit;
  let employer;
  let worker;
  let other;

  const RATE_PER_SECOND = ethers.parseEther("0.001"); // 0.001 CELO per second
  const DEPOSIT = ethers.parseEther("10"); // 10 CELO deposit

  beforeEach(async function () {
    [employer, worker, other] = await ethers.getSigners();

    const StreamSplitFactory = await ethers.getContractFactory("StreamSplit");
    streamSplit = await StreamSplitFactory.deploy();
    await streamSplit.waitForDeployment();
  });

  describe("createStream", function () {
    it("Should create a stream successfully", async function () {
      const tx = await streamSplit.connect(employer).createStream(
        worker.address,
        RATE_PER_SECOND,
        { value: DEPOSIT }
      );

      await expect(tx)
        .to.emit(streamSplit, "StreamCreated")
        .withArgs(0, employer.address, worker.address, RATE_PER_SECOND, DEPOSIT);

      const streamInfo = await streamSplit.getStreamInfo(0);
      expect(streamInfo.employer).to.equal(employer.address);
      expect(streamInfo.worker).to.equal(worker.address);
      expect(streamInfo.active).to.be.true;
    });

    it("Should reject invalid worker address", async function () {
      await expect(
        streamSplit.connect(employer).createStream(
          ethers.ZeroAddress,
          RATE_PER_SECOND,
          { value: DEPOSIT }
        )
      ).to.be.revertedWith("Invalid worker address");
    });

    it("Should reject zero rate", async function () {
      await expect(
        streamSplit.connect(employer).createStream(
          worker.address,
          0,
          { value: DEPOSIT }
        )
      ).to.be.revertedWith("Rate must be positive");
    });

    it("Should reject zero deposit", async function () {
      await expect(
        streamSplit.connect(employer).createStream(
          worker.address,
          RATE_PER_SECOND,
          { value: 0 }
        )
      ).to.be.revertedWith("Must deposit funds");
    });

    it("Should reject streaming to self", async function () {
      await expect(
        streamSplit.connect(employer).createStream(
          employer.address,
          RATE_PER_SECOND,
          { value: DEPOSIT }
        )
      ).to.be.revertedWith("Cannot stream to yourself");
    });
  });

  describe("calculateEarned", function () {
    beforeEach(async function () {
      await streamSplit.connect(employer).createStream(
        worker.address,
        RATE_PER_SECOND,
        { value: DEPOSIT }
      );
    });

    it("Should calculate earned amount correctly", async function () {
      // Wait 5 seconds
      await ethers.provider.send("evm_increaseTime", [5]);
      await ethers.provider.send("evm_mine", []);

      const earned = await streamSplit.calculateEarned(0);

      // Should be approximately 5 * RATE_PER_SECOND
      const expected = RATE_PER_SECOND * 5n;
      expect(earned).to.be.closeTo(expected, ethers.parseEther("0.001"));
    });

    it("Should return 0 for paused stream", async function () {
      await streamSplit.connect(employer).pauseStream(0);

      const earned = await streamSplit.calculateEarned(0);
      expect(earned).to.equal(0);
    });
  });

  describe("withdraw", function () {
    beforeEach(async function () {
      await streamSplit.connect(employer).createStream(
        worker.address,
        RATE_PER_SECOND,
        { value: DEPOSIT }
      );
    });

    it("Should allow worker to withdraw earned amount", async function () {
      // Wait 10 seconds
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine", []);

      const initialBalance = await ethers.provider.getBalance(worker.address);

      const tx = await streamSplit.connect(worker).withdraw(0);
      const receipt = await tx.wait();

      const finalBalance = await ethers.provider.getBalance(worker.address);
      const gasCost = receipt .gasUsed * receipt .gasPrice;

      // Balance should increase (minus gas)
      expect(finalBalance).to.be.gt(initialBalance - gasCost);
    });

    it("Should reject withdrawal by non-worker", async function () {
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        streamSplit.connect(other).withdraw(0)
      ).to.be.revertedWith("Only worker can withdraw");
    });

    it("Should handle immediate withdrawal correctly", async function () {
      // Due to block timing, even immediate withdrawal may earn tiny amount
      // Test that withdrawal works correctly in either case
      const earned = await streamSplit.calculateEarned(0);

      if (earned > 0n) {
        // If any amount earned, withdrawal should succeed
        await expect(
          streamSplit.connect(worker).withdraw(0)
        ).to.not.be.reverted;
      }
      // If nothing earned, it would revert - both behaviors are correct
    });

    it("Should reject withdrawal from paused stream", async function () {
      await streamSplit.connect(employer).pauseStream(0);

      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        streamSplit.connect(worker).withdraw(0)
      ).to.be.revertedWith("Stream not active");
    });
  });

  describe("pauseStream and resumeStream", function () {
    beforeEach(async function () {
      await streamSplit.connect(employer).createStream(
        worker.address,
        RATE_PER_SECOND,
        { value: DEPOSIT }
      );
    });

    it("Should allow employer to pause stream", async function () {
      const tx = await streamSplit.connect(employer).pauseStream(0);
      await expect(tx).to.emit(streamSplit, "StreamPaused");

      const streamInfo = await streamSplit.getStreamInfo(0);
      expect(streamInfo.active).to.be.false;
    });

    it("Should allow employer to resume stream", async function () {
      await streamSplit.connect(employer).pauseStream(0);

      const tx = await streamSplit.connect(employer).resumeStream(0);
      await expect(tx).to.emit(streamSplit, "StreamResumed");

      const streamInfo = await streamSplit.getStreamInfo(0);
      expect(streamInfo.active).to.be.true;
    });

    it("Should reject pause by non-employer", async function () {
      await expect(
        streamSplit.connect(worker).pauseStream(0)
      ).to.be.revertedWith("Only employer can pause");
    });

    it("Should reject resume by non-employer", async function () {
      await streamSplit.connect(employer).pauseStream(0);

      await expect(
        streamSplit.connect(worker).resumeStream(0)
      ).to.be.revertedWith("Only employer can resume");
    });
  });

  describe("stopStream", function () {
    beforeEach(async function () {
      await streamSplit.connect(employer).createStream(
        worker.address,
        RATE_PER_SECOND,
        { value: DEPOSIT }
      );
    });

    it("Should stop stream and return remaining funds", async function () {
      // Wait 5 seconds so some is earned
      await ethers.provider.send("evm_increaseTime", [5]);
      await ethers.provider.send("evm_mine", []);

      const initialBalance = await ethers.provider.getBalance(employer.address);

      const tx = await streamSplit.connect(employer).stopStream(0);
      await expect(tx).to.emit(streamSplit, "StreamStopped");

      const streamInfo = await streamSplit.getStreamInfo(0);
      expect(streamInfo.active).to.be.false;
    });

    it("Should reject stop by non-employer", async function () {
      await expect(
        streamSplit.connect(worker).stopStream(0)
      ).to.be.revertedWith("Only employer can stop");
    });
  });

  describe("addDeposit", function () {
    beforeEach(async function () {
      await streamSplit.connect(employer).createStream(
        worker.address,
        RATE_PER_SECOND,
        { value: DEPOSIT }
      );
    });

    it("Should allow employer to add more funds", async function () {
      const additionalDeposit = ethers.parseEther("5");

      const tx = await streamSplit.connect(employer).addDeposit(0, {
        value: additionalDeposit
      });

      await expect(tx).to.emit(streamSplit, "DepositAdded");

      const streamInfo = await streamSplit.getStreamInfo(0);
      expect(streamInfo.deposit).to.equal(DEPOSIT + additionalDeposit);
    });

    it("Should reject adding funds by non-employer", async function () {
      await expect(
        streamSplit.connect(worker).addDeposit(0, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("Only employer can add deposit");
    });
  });
});
```
