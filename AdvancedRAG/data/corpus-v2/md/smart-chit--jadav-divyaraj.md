# smart-chit--jadav-divyaraj

- domain: auctions (auction)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Jadav-Divyaraj/Chit-fund-Blockchain @ 07d246b198b28c3f089e4b7d9265d1e0c6dbe229
- license: MIT
- targets: SmartChit.sol
- validation: 27 passing tests, 0 failing; statement coverage SmartChit.sol 95.83 %

## Contract: SmartChit.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SmartChit — Blockchain-based Chit Fund
/// @notice A trustless chit fund where members join, pay monthly, and bid for the pot
/// @dev Deployed on Polygon Amoy Testnet at 0x96539E626DB6b5cE21F2E39F9BDa46d1bD9DbB54
contract SmartChit {
    address public owner;
    uint256 public monthlyAmount;
    uint8 public constant MAX_MEMBERS = 5;

    address[] public members;
    uint8 public memberCount;
    mapping(address => bool) public isMember;
    mapping(address => bool) public hasPaid;

    uint256 public totalPot;
    uint8 public currentMonth;

    bool public auctionActive;
    uint256 public auctionEndTime;
    uint256 public constant AUCTION_DURATION = 5 minutes;

    mapping(address => uint256) public bids;
    address[] public bidders;

    event Joined(address member);
    event Paid(address member, uint256 amount);
    event BidPlaced(address bidder, uint256 discount);
    event WinnerSelected(address winner, uint256 amount);
    event DividendPaid(address member, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(uint256 _monthlyAmount) {
        owner = msg.sender;
        monthlyAmount = _monthlyAmount;
    }

    /// @notice Join the chit fund (max 5 members)
    function join() external {
        require(!isMember[msg.sender], "Already a member");
        require(memberCount < MAX_MEMBERS, "Fund is full");

        isMember[msg.sender] = true;
        members.push(msg.sender);
        memberCount++;

        emit Joined(msg.sender);
    }

    /// @notice Pay monthly contribution (must send exactly monthlyAmount)
    function pay() external payable {
        require(isMember[msg.sender], "Not a member");
        require(!hasPaid[msg.sender], "Already paid this month");
        require(msg.value == monthlyAmount, "Incorrect amount");

        hasPaid[msg.sender] = true;
        totalPot += msg.value;

        emit Paid(msg.sender, msg.value);

        if (memberCount >= MAX_MEMBERS && allPaid()) {
            _startAuction();
        }
    }

    /// @notice Place a bid for discount on the pot
    /// @param discountAmount The discount (in wei) the bidder wants
    function placeBid(uint256 discountAmount) external {
        require(auctionActive, "Auction not active");
        require(isMember[msg.sender], "Not a member");
        require(discountAmount > 0 && discountAmount < totalPot, "Invalid bid");

        bids[msg.sender] = discountAmount;
        bidders.push(msg.sender);

        emit BidPlaced(msg.sender, discountAmount);
    }

    /// @notice End auction and distribute funds to lowest bidder
    function endAuction() external {
        require(auctionActive, "Auction not active");
        require(block.timestamp >= auctionEndTime, "Auction not ended");

        auctionActive = false;

        if (bidders.length == 0) {
            // No bids — carry pot to next month
            currentMonth++;
            totalPot = 0;
            _resetPayments();
            return;
        }

        // Find lowest bidder (highest discount = lowest net payment)
        address winner = bidders[0];
        uint256 lowestBid = bids[bidders[0]];

        for (uint256 i = 1; i < bidders.length; i++) {
            if (bids[bidders[i]] < lowestBid) {
                lowestBid = bids[bidders[i]];
                winner = bidders[i];
            }
        }

        uint256 payout = totalPot - lowestBid;

        emit WinnerSelected(winner, payout);

        // Transfer funds to winner
        (bool sent, ) = payable(winner).call{value: payout}("");
        require(sent, "Transfer failed");

        // Pay dividend to other members
        uint256 dividend = lowestBid / (memberCount - 1);
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i] != winner && hasPaid[members[i]]) {
                (bool paid, ) = payable(members[i]).call{value: dividend}("");
                if (paid) {
                    emit DividendPaid(members[i], dividend);
                }
            }
        }

        // Reset for next month
        currentMonth++;
        totalPot = 0;
        delete bidders;
        for (uint256 i = 0; i < members.length; i++) {
            delete bids[members[i]];
        }
        _resetPayments();
    }

    /// @notice Get all members
    function getMembers() external view returns (address[] memory) {
        return members;
    }

    /// @notice Get current bids (addresses and amounts)
    function getCurrentBids() external view returns (address[] memory, uint256[] memory) {
        address[] memory addrs = new address[](bidders.length);
        uint256[] memory amounts = new uint256[](bidders.length);

        for (uint256 i = 0; i < bidders.length; i++) {
            addrs[i] = bidders[i];
            amounts[i] = bids[bidders[i]];
        }

        return (addrs, amounts);
    }

    /// @notice Get contract balance
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ── Internal ──────────────────────────────────────────────

    function allPaid() private view returns (bool) {
        for (uint256 i = 0; i < members.length; i++) {
            if (!hasPaid[members[i]]) return false;
        }
        return true;
    }

    function _startAuction() private {
        auctionActive = true;
        auctionEndTime = block.timestamp + AUCTION_DURATION;
    }

    function _resetPayments() private {
        for (uint256 i = 0; i < members.length; i++) {
            hasPaid[members[i]] = false;
        }
    }

    /// @notice Accept ETH (fallback)
    receive() external payable {}
}
```

## Tests: SmartChit.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SmartChit", function () {
  let SmartChit, smartchit;
  let owner, member1, member2, member3, member4, member5, nonMember;
  const MONTHLY_AMOUNT = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, member1, member2, member3, member4, member5, nonMember] = await ethers.getSigners();
    SmartChit = await ethers.getContractFactory("SmartChit");
    smartchit = await SmartChit.deploy(MONTHLY_AMOUNT);
    await smartchit.waitForDeployment();
  });

  describe("Deployment", function () {
    it("sets owner correctly", async function () {
      expect(await smartchit.owner()).to.equal(owner.address);
    });

    it("sets monthly amount correctly", async function () {
      expect(await smartchit.monthlyAmount()).to.equal(MONTHLY_AMOUNT);
    });

    it("starts with 0 members", async function () {
      expect(await smartchit.memberCount()).to.equal(0);
    });

    it("starts with 0 total pot", async function () {
      expect(await smartchit.totalPot()).to.equal(0);
    });

    it("auction not active initially", async function () {
      expect(await smartchit.auctionActive()).to.equal(false);
    });
  });

  describe("Join", function () {
    it("allows new members to join", async function () {
      await smartchit.connect(member1).join();
      expect(await smartchit.memberCount()).to.equal(1);
      expect(await smartchit.isMember(member1.address)).to.equal(true);
    });

    it("emits Joined event", async function () {
      await expect(smartchit.connect(member1).join())
        .to.emit(smartchit, "Joined")
        .withArgs(member1.address);
    });

    it("prevents duplicate membership", async function () {
      await smartchit.connect(member1).join();
      await expect(smartchit.connect(member1).join()).to.be.revertedWith("Already a member");
    });

    it("prevents joining after 5 members", async function () {
      await smartchit.connect(member1).join();
      await smartchit.connect(member2).join();
      await smartchit.connect(member3).join();
      await smartchit.connect(member4).join();
      await smartchit.connect(member5).join();
      await expect(smartchit.connect(nonMember).join()).to.be.revertedWith("Fund is full");
    });
  });

  describe("Pay", function () {
    beforeEach(async function () {
      await smartchit.connect(member1).join();
      await smartchit.connect(member2).join();
    });

    it("allows member to pay", async function () {
      await smartchit.connect(member1).pay({ value: MONTHLY_AMOUNT });
      expect(await smartchit.hasPaid(member1.address)).to.equal(true);
      expect(await smartchit.totalPot()).to.equal(MONTHLY_AMOUNT);
    });

    it("emits Paid event", async function () {
      await expect(smartchit.connect(member1).pay({ value: MONTHLY_AMOUNT }))
        .to.emit(smartchit, "Paid")
        .withArgs(member1.address, MONTHLY_AMOUNT);
    });

    it("rejects non-member payment", async function () {
      await expect(smartchit.connect(nonMember).pay({ value: MONTHLY_AMOUNT }))
        .to.be.revertedWith("Not a member");
    });

    it("rejects wrong amount", async function () {
      const wrongAmount = ethers.parseEther("0.5");
      await expect(smartchit.connect(member1).pay({ value: wrongAmount }))
        .to.be.revertedWith("Incorrect amount");
    });

    it("rejects double payment", async function () {
      await smartchit.connect(member1).pay({ value: MONTHLY_AMOUNT });
      await expect(smartchit.connect(member1).pay({ value: MONTHLY_AMOUNT }))
        .to.be.revertedWith("Already paid this month");
    });
  });

  describe("Auction", function () {
    beforeEach(async function () {
      // All 5 members join and pay
      await smartchit.connect(member1).join();
      await smartchit.connect(member2).join();
      await smartchit.connect(member3).join();
      await smartchit.connect(member4).join();
      await smartchit.connect(member5).join();

      await smartchit.connect(member1).pay({ value: MONTHLY_AMOUNT });
      await smartchit.connect(member2).pay({ value: MONTHLY_AMOUNT });
      await smartchit.connect(member3).pay({ value: MONTHLY_AMOUNT });
      await smartchit.connect(member4).pay({ value: MONTHLY_AMOUNT });
      await smartchit.connect(member5).pay({ value: MONTHLY_AMOUNT });
    });

    it("starts auction when all pay", async function () {
      expect(await smartchit.auctionActive()).to.equal(true);
    });

    it("allows members to place bids", async function () {
      const bidAmount = ethers.parseEther("0.1");
      await smartchit.connect(member1).placeBid(bidAmount);
      expect(await smartchit.bids(member1.address)).to.equal(bidAmount);
    });

    it("emits BidPlaced event", async function () {
      const bidAmount = ethers.parseEther("0.1");
      await expect(smartchit.connect(member1).placeBid(bidAmount))
        .to.emit(smartchit, "BidPlaced")
        .withArgs(member1.address, bidAmount);
    });

    it("rejects bid from non-member", async function () {
      const bidAmount = ethers.parseEther("0.1");
      await expect(smartchit.connect(nonMember).placeBid(bidAmount))
        .to.be.revertedWith("Not a member");
    });

    it("rejects invalid bid amount (zero)", async function () {
      await expect(smartchit.connect(member1).placeBid(0))
        .to.be.revertedWith("Invalid bid");
    });

    it("rejects bid >= total pot", async function () {
      await expect(smartchit.connect(member1).placeBid(MONTHLY_AMOUNT * 5n))
        .to.be.revertedWith("Invalid bid");
    });

    it("getCurrentBids returns all bids", async function () {
      const bid1 = ethers.parseEther("0.1");
      const bid2 = ethers.parseEther("0.2");
      await smartchit.connect(member1).placeBid(bid1);
      await smartchit.connect(member2).placeBid(bid2);

      const [addrs, amounts] = await smartchit.getCurrentBids();
      expect(addrs.length).to.equal(2);
      expect(amounts[0]).to.equal(bid1);
      expect(amounts[1]).to.equal(bid2);
    });
  });

  describe("End Auction", function () {
    beforeEach(async function () {
      await smartchit.connect(member1).join();
      await smartchit.connect(member2).join();
      await smartchit.connect(member3).join();
      await smartchit.connect(member4).join();
      await smartchit.connect(member5).join();

      await smartchit.connect(member1).pay({ value: MONTHLY_AMOUNT });
      await smartchit.connect(member2).pay({ value: MONTHLY_AMOUNT });
      await smartchit.connect(member3).pay({ value: MONTHLY_AMOUNT });
      await smartchit.connect(member4).pay({ value: MONTHLY_AMOUNT });
      await smartchit.connect(member5).pay({ value: MONTHLY_AMOUNT });
    });

    it("cannot end auction before time", async function () {
      const bidAmount = ethers.parseEther("0.1");
      await smartchit.connect(member1).placeBid(bidAmount);
      await expect(smartchit.endAuction()).to.be.revertedWith("Auction not ended");
    });

    it("ends auction and pays winner", async function () {
      const bidAmount = ethers.parseEther("0.1");
      await smartchit.connect(member1).placeBid(bidAmount);

      // Fast forward 5 minutes
      await ethers.provider.send("evm_increaseTime", [300]);
      await ethers.provider.send("evm_mine");

      const balanceBefore = await ethers.provider.getBalance(member1.address);
      await smartchit.endAuction();
      const balanceAfter = await ethers.provider.getBalance(member1.address);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("resets for next month after auction", async function () {
      const bidAmount = ethers.parseEther("0.1");
      await smartchit.connect(member1).placeBid(bidAmount);

      await ethers.provider.send("evm_increaseTime", [300]);
      await ethers.provider.send("evm_mine");

      await smartchit.endAuction();

      expect(await smartchit.totalPot()).to.equal(0);
      expect(await smartchit.auctionActive()).to.equal(false);
      expect(await smartchit.currentMonth()).to.equal(1);
    });

    it("carries pot to next month if no bids", async function () {
      await ethers.provider.send("evm_increaseTime", [300]);
      await ethers.provider.send("evm_mine");

      await smartchit.endAuction();

      expect(await smartchit.totalPot()).to.equal(0);
      expect(await smartchit.currentMonth()).to.equal(1);
    });
  });

  describe("View Functions", function () {
    it("getMembers returns all members", async function () {
      await smartchit.connect(member1).join();
      await smartchit.connect(member2).join();

      const members = await smartchit.getMembers();
      expect(members.length).to.equal(2);
      expect(members[0]).to.equal(member1.address);
      expect(members[1]).to.equal(member2.address);
    });

    it("getBalance returns contract balance", async function () {
      await smartchit.connect(member1).join();
      await smartchit.connect(member1).pay({ value: MONTHLY_AMOUNT });

      expect(await smartchit.getBalance()).to.equal(MONTHLY_AMOUNT);
    });
  });
});
```
