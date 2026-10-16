# auction--rickyliu1117

- domain: auctions (auction)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/rickyliu1117/auction @ 8a8f846dabf5ec05e15c37f729ff7f92f34e22df
- license: Apache-2.0
- targets: Auction.sol
- validation: 14 passing tests, 0 failing; statement coverage Auction.sol 77.42 %

## Contract: Auction.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Auction {
    // Auction details
    address public immutable owner;
    uint public immutable startTime;
    uint public immutable endTime;
    uint public highestBid;
    address public highestBidder;
    bool public ended;
    bool public paused;
    
    // Mapping to store bids
    mapping(address => uint) public bids;
    
    // Reentrancy guard using uint256 for gas efficiency
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;
    
    // Events
    event BidPlaced(address indexed bidder, uint amount);
    event AuctionEnded(address indexed winner, uint amount);
    event WithdrawalSuccessful(address indexed recipient, uint amount);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event HighestBidderChanged(address indexed previousBidder, address indexed newBidder, uint amount);
    
    // Custom errors for gas optimization
    error OnlyOwner();
    error AuctionNotEnded();
    error AuctionHasEnded();
    error AuctionAlreadyEnded();
    error BidTooLow();
    error NoFundsToWithdraw();
    error TransferFailed();
    error ContractIsPaused();
    error ReentrancyGuard();
    
    // Modifiers
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }
    
    modifier auctionActive() {
        if (paused) revert ContractIsPaused();
        if (block.timestamp < startTime) revert("Auction not started");
        if (block.timestamp > endTime) revert("Auction has ended");
        if (ended) revert("Auction already ended");
        _;
    }
    
    modifier nonReentrant() {
        if (_status == _ENTERED) revert ReentrancyGuard();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
    
    // Constructor
    constructor(uint _biddingTime) {
        owner = msg.sender;
        startTime = block.timestamp;
        endTime = startTime + _biddingTime;
        _status = _NOT_ENTERED;
    }
    
    // Function to place a bid
    function placeBid() external payable auctionActive nonReentrant {
        if (msg.value <= highestBid) revert BidTooLow();
        
        address previousBidder = highestBidder;
        uint previousBid = highestBid;
        
        // Update state before external calls
        highestBid = msg.value;
        highestBidder = msg.sender;
        
        // Return the previous highest bidder's bid
        if (previousBidder != address(0)) {
            bids[previousBidder] += previousBid;
        }
        
        emit BidPlaced(msg.sender, msg.value);
        emit HighestBidderChanged(previousBidder, msg.sender, msg.value);
    }
    
    // Function to end the auction
    function endAuction() external onlyOwner nonReentrant {
        if (block.timestamp <= endTime) revert AuctionNotEnded();
        if (ended) revert AuctionAlreadyEnded();
        
        ended = true;
        emit AuctionEnded(highestBidder, highestBid);
        
        // Transfer the highest bid to the owner
        (bool success, ) = payable(owner).call{value: highestBid}("");
        if (!success) revert TransferFailed();
    }
    
    // Function for bidders to withdraw their bids
    function withdraw() external nonReentrant {
        uint amount = bids[msg.sender];
        if (amount == 0) revert NoFundsToWithdraw();
        
        // Update state before external call
        bids[msg.sender] = 0;
        
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit WithdrawalSuccessful(msg.sender, amount);
    }
    
    // Emergency pause function
    function pause() external onlyOwner {
        if (paused) revert ContractIsPaused();
        paused = true;
        emit Paused(msg.sender);
    }
    
    // Unpause function
    function unpause() external onlyOwner {
        if (!paused) revert ContractIsPaused();
        paused = false;
        emit Unpaused(msg.sender);
    }
    
    // Function to get auction status
    function getAuctionStatus() external view returns (
        uint _startTime,
        uint _endTime,
        uint _highestBid,
        address _highestBidder,
        bool _ended,
        bool _paused
    ) {
        return (startTime, endTime, highestBid, highestBidder, ended, paused);
    }
    
    // Function to get remaining time
    function getRemainingTime() external view returns (uint) {
        return block.timestamp >= endTime ? 0 : endTime - block.timestamp;
    }
}
```

## Tests: Auction.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Auction", function () {
    let auction;
    let owner;
    let bidder1;
    let bidder2;
    let bidder3;
    const BIDDING_TIME = 3600n; // 1 hour as BigInt

    beforeEach(async function () {
        // Get signers (accounts)
        [owner, bidder1, bidder2, bidder3] = await ethers.getSigners();

        // Deploy the contract
        const Auction = await ethers.getContractFactory("Auction");
        auction = await Auction.deploy(BIDDING_TIME);
        await auction.waitForDeployment();
    });

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            expect(await auction.owner()).to.equal(await owner.getAddress());
        });

        it("Should set the correct start and end times", async function () {
            const startTime = await auction.startTime();
            const endTime = await auction.endTime();
            expect(endTime).to.equal(startTime + BIDDING_TIME);
        });

        it("Should initialize with zero highest bid", async function () {
            expect(await auction.highestBid()).to.equal(0);
        });

        it("Should initialize with no highest bidder", async function () {
            expect(await auction.highestBidder()).to.equal(ethers.ZeroAddress);
        });
    });

    describe("Bidding", function () {
        it("Should allow placing a bid", async function () {
            await auction.connect(bidder1).placeBid({ value: ethers.parseEther("0.1") });
            expect(await auction.highestBid()).to.equal(ethers.parseEther("0.1"));
            expect(await auction.highestBidder()).to.equal(await bidder1.getAddress());
        });

        it("Should not allow bid lower than highest bid", async function () {
            await auction.connect(bidder1).placeBid({ value: ethers.parseEther("0.1") });
            await expect(auction.connect(bidder2).placeBid({ value: ethers.parseEther("0.05") }))
                .to.be.revertedWithCustomError(auction, "BidTooLow");
        });

        it("Should update highest bidder and allow previous bidder to withdraw", async function () {
            await auction.connect(bidder1).placeBid({ value: ethers.parseEther("0.1") });
            await auction.connect(bidder2).placeBid({ value: ethers.parseEther("0.2") });
            expect(await auction.highestBidder()).to.equal(await bidder2.getAddress());
            expect(await auction.bids(await bidder1.getAddress())).to.equal(ethers.parseEther("0.1"));
        });
    });

    describe("Auction End", function () {
        it("Should not allow ending auction before end time", async function () {
            await expect(auction.endAuction())
                .to.be.revertedWithCustomError(auction, "AuctionNotEnded");
        });

        it("Should allow ending auction after end time", async function () {
            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [Number(BIDDING_TIME) + 1]);
            await ethers.provider.send("evm_mine");
            
            await auction.endAuction();
            expect(await auction.ended()).to.be.true;
        });

        it("Should not allow ending auction twice", async function () {
            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [Number(BIDDING_TIME) + 1]);
            await ethers.provider.send("evm_mine");
            
            await auction.endAuction();
            await expect(auction.endAuction())
                .to.be.revertedWithCustomError(auction, "AuctionAlreadyEnded");
        });
    });

    describe("Withdrawals", function () {
        it("Should allow withdrawal of outbid amount", async function () {
            await auction.connect(bidder1).placeBid({ value: ethers.parseEther("0.1") });
            await auction.connect(bidder2).placeBid({ value: ethers.parseEther("0.2") });
            
            const initialBalance = await ethers.provider.getBalance(await bidder1.getAddress());
            const tx = await auction.connect(bidder1).withdraw();
            const receipt = await tx.wait();
            const gasCost = receipt.gasUsed * receipt.gasPrice;
            const finalBalance = await ethers.provider.getBalance(await bidder1.getAddress());
            expect(finalBalance > (initialBalance - gasCost)).to.be.true;
        });

        it("Should not allow withdrawal if no funds to withdraw", async function () {
            await expect(auction.connect(bidder1).withdraw())
                .to.be.revertedWithCustomError(auction, "NoFundsToWithdraw");
        });
    });

    describe("Auction Status", function () {
        it("Should return correct auction status", async function () {
            const status = await auction.getAuctionStatus();
            expect(status[0]).to.equal(await auction.startTime());
            expect(status[1]).to.equal(await auction.endTime());
            expect(status[2]).to.equal(await auction.highestBid());
            expect(status[3]).to.equal(await auction.highestBidder());
            expect(status[4]).to.equal(await auction.ended());
            expect(status[5]).to.equal(await auction.paused());
        });

        it("Should return correct remaining time", async function () {
            const remainingTime = await auction.getRemainingTime();
            expect(remainingTime).to.equal(BIDDING_TIME);
        });
    });
});
```
