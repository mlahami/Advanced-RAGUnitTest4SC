# areca-auction--nitishpatil18

- domain: auctions (auction)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/nitishpatil18/areca-auction @ 5d3aa553f139a67a4483683a5af74d099218906e
- license: MIT
- targets: ArecaAuction.sol
- validation: 23 passing tests, 0 failing; statement coverage ArecaAuction.sol 100.0 %

## Contract: ArecaAuction.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ArecaAuction {
    struct Auction {
        address payable seller;
        uint256 basePrice;
        uint256 highestBid;
        address highestBidder;
        uint64  endTime;
        bool    closed;
        bool    cancelled;
        bool    exists;
    }

    // anti-snipe: bids in last ANTISNIPE_WINDOW seconds push endTime forward
    uint64 public constant ANTISNIPE_WINDOW = 30;
    uint64 public constant ANTISNIPE_EXTEND = 30;

    uint256 public nextId;
    mapping(uint256 => Auction) public auctions;
    mapping(address => uint256) public pendingReturns;

    event AuctionCreated  (uint256 indexed id, address indexed seller, uint256 basePrice, uint64 endTime);
    event BidPlaced       (uint256 indexed id, address indexed bidder, uint256 amount);
    event AuctionExtended (uint256 indexed id, uint64 newEndTime);
    event AuctionClosed   (uint256 indexed id, address indexed winner, uint256 amount);
    event AuctionCancelled(uint256 indexed id, address indexed seller);
    event Withdrawn       (address indexed who, uint256 amount);

    function createAuction(uint256 basePrice, uint64 endTime) external returns (uint256 id) {
        require(endTime > block.timestamp, "end in past");
        id = ++nextId;
        auctions[id] = Auction({
            seller: payable(msg.sender),
            basePrice: basePrice,
            highestBid: 0,
            highestBidder: address(0),
            endTime: endTime,
            closed: false,
            cancelled: false,
            exists: true
        });
        emit AuctionCreated(id, msg.sender, basePrice, endTime);
    }

    function placeBid(uint256 id) external payable {
        Auction storage a = auctions[id];
        require(a.exists, "no auction");
        require(!a.closed, "closed");
        require(!a.cancelled, "cancelled");
        require(block.timestamp < a.endTime, "ended");
        require(msg.sender != a.seller, "seller cannot bid");

        uint256 minRequired = a.highestBid == 0 ? a.basePrice : a.highestBid + 1;
        require(msg.value >= minRequired, "bid too low");

        if (a.highestBidder != address(0)) {
            pendingReturns[a.highestBidder] += a.highestBid;
        }
        a.highestBid = msg.value;
        a.highestBidder = msg.sender;

        emit BidPlaced(id, msg.sender, msg.value);

        // anti-snipe: if bid lands in last ANTISNIPE_WINDOW seconds, extend
        uint64 nowTs = uint64(block.timestamp);
        if (a.endTime - nowTs < ANTISNIPE_WINDOW) {
            a.endTime = nowTs + ANTISNIPE_EXTEND;
            emit AuctionExtended(id, a.endTime);
        }
    }

    function closeAuction(uint256 id) external {
        Auction storage a = auctions[id];
        require(a.exists, "no auction");
        require(!a.closed, "already closed");
        require(!a.cancelled, "cancelled");
        require(block.timestamp >= a.endTime, "not yet");
        a.closed = true;
        if (a.highestBidder != address(0)) {
            (bool ok, ) = a.seller.call{value: a.highestBid}("");
            require(ok, "seller transfer failed");
        }
        emit AuctionClosed(id, a.highestBidder, a.highestBid);
    }

    /// seller cancels an auction that has no bids yet. closed/already-cancelled
    /// auctions cannot be cancelled. all auctions with at least one bid must run
    /// to completion to protect bidders.
    function cancelAuction(uint256 id) external {
        Auction storage a = auctions[id];
        require(a.exists, "no auction");
        require(msg.sender == a.seller, "only seller");
        require(!a.closed, "already closed");
        require(!a.cancelled, "already cancelled");
        require(a.highestBidder == address(0), "has bids");
        a.cancelled = true;
        emit AuctionCancelled(id, msg.sender);
    }

    function withdraw() external {
        uint256 amount = pendingReturns[msg.sender];
        require(amount > 0, "nothing to withdraw");
        pendingReturns[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "withdraw failed");
        emit Withdrawn(msg.sender, amount);
    }

    function getAuction(uint256 id) external view returns (
        address seller,
        uint256 basePrice,
        uint256 highestBid,
        address highestBidder,
        uint64  endTime,
        bool    closed,
        bool    cancelled
    ) {
        Auction storage a = auctions[id];
        require(a.exists, "no auction");
        return (a.seller, a.basePrice, a.highestBid, a.highestBidder, a.endTime, a.closed, a.cancelled);
    }
}
```

## Tests: areca.test.js

```javascript
const { expect } = require("chai");
const hre = require("hardhat");

const { ethers } = hre;

describe('ArecaAuction', () => {
  let contract, seller, bidder1, bidder2;

  beforeEach(async () => {
    [seller, bidder1, bidder2] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('ArecaAuction', seller);
    contract = await Factory.deploy();
    await contract.waitForDeployment();
  });

  async function createAuction(durationSeconds = 60, basePrice = ethers.parseEther('1')) {
    const block = await ethers.provider.getBlock('latest');
    const endTime = block.timestamp + durationSeconds;
    const tx = await contract.connect(seller).createAuction(basePrice, endTime);
    await tx.wait();
    return { id: 1n, endTime, basePrice };
  }

  it('creates an auction', async () => {
    const { id, basePrice } = await createAuction();
    const a = await contract.getAuction(id);
    expect(a.seller).to.equal(seller.address);
    expect(a.basePrice).to.equal(basePrice);
    expect(a.highestBid).to.equal(0n);
    expect(a.closed).to.equal(false);
  });

  it('rejects bids below base price', async () => {
    const { id, basePrice } = await createAuction();
    await expect(
      contract.connect(bidder1).placeBid(id, { value: basePrice - 1n })
    ).to.be.revertedWith('bid too low');
  });

  it('accepts a valid bid', async () => {
    const { id, basePrice } = await createAuction();
    await expect(
      contract.connect(bidder1).placeBid(id, { value: basePrice })
    ).to.emit(contract, 'BidPlaced').withArgs(id, bidder1.address, basePrice);

    const a = await contract.getAuction(id);
    expect(a.highestBid).to.equal(basePrice);
    expect(a.highestBidder).to.equal(bidder1.address);
  });

  it('rejects a bid not higher than current', async () => {
    const { id, basePrice } = await createAuction();
    await contract.connect(bidder1).placeBid(id, { value: basePrice });
    await expect(
      contract.connect(bidder2).placeBid(id, { value: basePrice })
    ).to.be.revertedWith('bid too low');
  });

  it('refunds previous high bidder via pendingReturns', async () => {
    const { id, basePrice } = await createAuction();
    await contract.connect(bidder1).placeBid(id, { value: basePrice });

    const newBid = basePrice + ethers.parseEther('0.5');
    await contract.connect(bidder2).placeBid(id, { value: newBid });

    expect(await contract.pendingReturns(bidder1.address)).to.equal(basePrice);
  });

  it('lets a refunded bidder withdraw', async () => {
    const { id, basePrice } = await createAuction();
    await contract.connect(bidder1).placeBid(id, { value: basePrice });
    await contract.connect(bidder2).placeBid(id, { value: basePrice + ethers.parseEther('0.5') });

    const before = await ethers.provider.getBalance(bidder1.address);
    const tx = await contract.connect(bidder1).withdraw();
    const receipt = await tx.wait();
    const gas = receipt.gasUsed * receipt.gasPrice;
    const after = await ethers.provider.getBalance(bidder1.address);

    expect(after + gas - before).to.equal(basePrice);
    expect(await contract.pendingReturns(bidder1.address)).to.equal(0n);
  });

  it('rejects bids from the seller', async () => {
    const { id, basePrice } = await createAuction();
    await expect(
      contract.connect(seller).placeBid(id, { value: basePrice })
    ).to.be.revertedWith('seller cannot bid');
  });

  it('rejects close before end time', async () => {
    const { id } = await createAuction(3600);
    await expect(
      contract.connect(seller).closeAuction(id)
    ).to.be.revertedWith('not yet');
  });

  it('closes after end time and pays seller', async () => {
    const { id, basePrice } = await createAuction(60);
    await contract.connect(bidder1).placeBid(id, { value: basePrice });

    await ethers.provider.send('evm_increaseTime', [61]);
    await ethers.provider.send('evm_mine', []);

    const before = await ethers.provider.getBalance(seller.address);
    const tx = await contract.connect(bidder1).closeAuction(id);
    await tx.wait();
    const after = await ethers.provider.getBalance(seller.address);

    expect(after - before).to.equal(basePrice);

    const a = await contract.getAuction(id);
    expect(a.closed).to.equal(true);
  });

  it('rejects bids on a closed auction', async () => {
    const { id, basePrice } = await createAuction(60);
    await contract.connect(bidder1).placeBid(id, { value: basePrice });

    await ethers.provider.send('evm_increaseTime', [61]);
    await ethers.provider.send('evm_mine', []);
    await contract.connect(seller).closeAuction(id);

    await expect(
      contract.connect(bidder2).placeBid(id, { value: basePrice + 1n })
    ).to.be.revertedWith('closed');
  });
  // ---- anti-snipe -------------------------------------------------------

  it('does NOT extend endTime when bid is placed well before the window', async () => {
    const { id, basePrice, endTime } = await createAuction(300);
    await contract.connect(bidder1).placeBid(id, { value: basePrice });
    const a = await contract.getAuction(id);
    expect(a.endTime).to.equal(BigInt(endTime));
  });

  it('extends endTime when a bid lands in the anti-snipe window', async () => {
    const { id, basePrice } = await createAuction(60);
    await ethers.provider.send('evm_increaseTime', [45]);
    await ethers.provider.send('evm_mine', []);

    await contract.connect(bidder1).placeBid(id, { value: basePrice });

    const a = await contract.getAuction(id);
    const block = await ethers.provider.getBlock('latest');
    expect(a.endTime).to.be.closeTo(BigInt(block.timestamp + 30), 2n);
  });

  it('emits AuctionExtended when anti-snipe fires', async () => {
    const { id, basePrice } = await createAuction(60);
    await ethers.provider.send('evm_increaseTime', [45]);
    await ethers.provider.send('evm_mine', []);

    await expect(
      contract.connect(bidder1).placeBid(id, { value: basePrice })
    ).to.emit(contract, 'AuctionExtended');
  });

  it('does NOT emit AuctionExtended on a normal bid', async () => {
    const { id, basePrice } = await createAuction(300);
    await expect(
      contract.connect(bidder1).placeBid(id, { value: basePrice })
    ).to.not.emit(contract, 'AuctionExtended');
  });

  it('keeps extending on consecutive last-second bids', async () => {
    const { id, basePrice } = await createAuction(60);
    await ethers.provider.send('evm_increaseTime', [45]);
    await ethers.provider.send('evm_mine', []);

    await contract.connect(bidder1).placeBid(id, { value: basePrice });
    const after1 = (await contract.getAuction(id)).endTime;

    await ethers.provider.send('evm_increaseTime', [20]);
    await ethers.provider.send('evm_mine', []);

    await contract.connect(bidder2).placeBid(id, { value: basePrice + ethers.parseEther('0.1') });
    const after2 = (await contract.getAuction(id)).endTime;

    expect(after2).to.be.greaterThan(after1);
  });

  // ---- cancel ------------------------------------------------------------

  it('lets the seller cancel an auction with no bids', async () => {
    const { id } = await createAuction();
    await expect(
      contract.connect(seller).cancelAuction(id)
    ).to.emit(contract, 'AuctionCancelled').withArgs(id, seller.address);

    const a = await contract.getAuction(id);
    expect(a.cancelled).to.equal(true);
  });

  it('rejects cancel from non-seller', async () => {
    const { id } = await createAuction();
    await expect(
      contract.connect(bidder1).cancelAuction(id)
    ).to.be.revertedWith('only seller');
  });

  it('rejects cancel if any bid was placed', async () => {
    const { id, basePrice } = await createAuction();
    await contract.connect(bidder1).placeBid(id, { value: basePrice });
    await expect(
      contract.connect(seller).cancelAuction(id)
    ).to.be.revertedWith('has bids');
  });

  it('rejects double-cancel', async () => {
    const { id } = await createAuction();
    await contract.connect(seller).cancelAuction(id);
    await expect(
      contract.connect(seller).cancelAuction(id)
    ).to.be.revertedWith('already cancelled');
  });

  it('rejects bids on a cancelled auction', async () => {
    const { id, basePrice } = await createAuction();
    await contract.connect(seller).cancelAuction(id);
    await expect(
      contract.connect(bidder1).placeBid(id, { value: basePrice })
    ).to.be.revertedWith('cancelled');
  });

  it('rejects close on a cancelled auction', async () => {
    const { id } = await createAuction(60);
    await contract.connect(seller).cancelAuction(id);

    await ethers.provider.send('evm_increaseTime', [61]);
    await ethers.provider.send('evm_mine', []);

    await expect(
      contract.connect(seller).closeAuction(id)
    ).to.be.revertedWith('cancelled');
  });

  // ---- events + shape ----------------------------------------------------

  it('emits AuctionCreated with correct args', async () => {
    const block = await ethers.provider.getBlock('latest');
    const endTime = block.timestamp + 120;
    const basePrice = ethers.parseEther('2');

    await expect(
      contract.connect(seller).createAuction(basePrice, endTime)
    ).to.emit(contract, 'AuctionCreated').withArgs(1n, seller.address, basePrice, endTime);
  });

  it('getAuction returns the cancelled field', async () => {
    const { id } = await createAuction();
    const a = await contract.getAuction(id);
    expect(a.cancelled).to.equal(false);

    await contract.connect(seller).cancelAuction(id);
    const a2 = await contract.getAuction(id);
    expect(a2.cancelled).to.equal(true);
  });
});
```
