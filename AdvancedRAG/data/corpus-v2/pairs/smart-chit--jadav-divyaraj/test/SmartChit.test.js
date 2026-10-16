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
