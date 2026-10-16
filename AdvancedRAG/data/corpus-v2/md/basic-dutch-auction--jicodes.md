# basic-dutch-auction--jicodes

- domain: auctions (dutch-auction)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/jicodes/dutch-auction-dapp @ ee33502e3e76a6f73bd460c2173cdc47c225b620
- license: MIT
- targets: BasicDutchAuction.sol
- validation: 7 passing tests, 0 failing; statement coverage BasicDutchAuction.sol 100.0 %

## Contract: BasicDutchAuction.sol (primary target)

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

// Uncomment this line to use console.log
// import "hardhat/console.sol";

contract BasicDutchAuction {
    address payable public seller;
    uint256 public reservePrice;
    uint256 public numBlocksAuctionOpen;
    uint256 public offerPriceDecrement;
    uint256 public initialPrice;
    uint256 public startBlock;
    bool public isEnded;
    address public winner;

    modifier isOpenning() {
        require(!isEnded, "Auction has ended");
        _; 
    }

    constructor(
        uint256 _reservePrice,
        uint256 _numBlocksAuctionOpen,
        uint256 _offerPriceDecrement
    ) {
        seller = payable(msg.sender);
        reservePrice = _reservePrice;
        numBlocksAuctionOpen = _numBlocksAuctionOpen;
        offerPriceDecrement = _offerPriceDecrement;
        initialPrice = reservePrice + numBlocksAuctionOpen * offerPriceDecrement;
        startBlock = block.number;
        isEnded = false;
    }

    function bid() public payable isOpenning returns (address) {
        require(block.number < startBlock + numBlocksAuctionOpen, "Auction expired");
        require(msg.value >= reservePrice, "Bid should be no less than the reserve price");
        require(msg.value >= currentPrice(), "Bid should be no less than the current price");
                
        winner = msg.sender;
        finalize(currentPrice());
        return winner;
    }

    function currentPrice() public view returns (uint256) {
        uint256 elapsedBlocks = block.number - startBlock;
        return initialPrice - elapsedBlocks * offerPriceDecrement;
    }

    function finalize(uint256 finalAuctionPrice) internal {
        isEnded = true;
        
        seller.transfer(finalAuctionPrice);

    }
}
```

## Tests: BasicDutchAuction.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("BasicDutchAuction", function () {

  async function deployDutchAuctionFixture () {

    const reservePrice = ethers.parseEther("1"); // 1 ETH
    const numBlocksAuctionOpen = 1_000; // auction open for 1000 blocks
    const offerPriceDecrement = ethers.parseEther("0.001"); // decrese 0.001 ETH per block

    const startBlock = await ethers.provider.getBlockNumber();
    const [seller, bidder1, bidder2] = await ethers.getSigners();
    const BasicDutchAuctionFactory = await ethers.getContractFactory("BasicDutchAuction");
    const basicDutchAuction = await BasicDutchAuctionFactory.deploy(reservePrice, numBlocksAuctionOpen, offerPriceDecrement);

    return { basicDutchAuction, reservePrice, numBlocksAuctionOpen, offerPriceDecrement, startBlock, seller, bidder1, bidder2};
  };

  describe("Deployment", function () {
    it("Auction should be properly initialized", async function () {
      const { basicDutchAuction, reservePrice, numBlocksAuctionOpen, offerPriceDecrement } = await loadFixture(deployDutchAuctionFixture);
      expect(await basicDutchAuction.reservePrice()).to.equal(reservePrice);
      expect(await basicDutchAuction.numBlocksAuctionOpen()).to.equal(numBlocksAuctionOpen);
      expect(await basicDutchAuction.offerPriceDecrement()).to.equal(offerPriceDecrement);
    });
  });

  describe("Bidding", function () {
    it("Auction should end after the specified number of open blocks have passed.", async function () {
      const { basicDutchAuction, numBlocksAuctionOpen, bidder1 } = await loadFixture(deployDutchAuctionFixture);
      // Advance the blocks to the end of auction
      for(let i = 0; i <= numBlocksAuctionOpen; i++) {
        await ethers.provider.send("evm_mine", []);
      }
      const bidAmount = ethers.parseEther("2");
      await expect(basicDutchAuction.connect(bidder1).bid({ value: bidAmount })).to.be.revertedWith("Auction expired");
    });

    it("Bid should be equal to or greater than the reserve price", async function () {
      const { basicDutchAuction, bidder1, reservePrice } = await loadFixture(deployDutchAuctionFixture);
      const bidAmount = reservePrice - ethers.parseEther("0.1");
      await expect(basicDutchAuction.connect(bidder1).bid({ value: bidAmount })).to.be.revertedWith("Bid should be no less than the reserve price");
    });

    it("Bid should be equal to or greater than the current price", async function () {
      const { basicDutchAuction, bidder1 } = await loadFixture(deployDutchAuctionFixture);
      const currentPrice = await basicDutchAuction.currentPrice();
      const bidAmount = currentPrice - ethers.parseEther("0.1");
      await expect(basicDutchAuction.connect(bidder1).bid({ value: bidAmount })).to.be.revertedWith("Bid should be no less than the current price");
    });

    it("Successful bid should make bidder the winner and end the auction", async function () {
      const { basicDutchAuction, bidder1 } = await loadFixture(deployDutchAuctionFixture);
      const bidAmount = ethers.parseEther("2");
      await basicDutchAuction.connect(bidder1).bid({ value: bidAmount });
      expect(await basicDutchAuction.winner()).to.equal(bidder1.address);
      expect(await basicDutchAuction.isEnded()).to.be.true;
    });

    it("Auction should not accept bids after a successful bid", async function () {
      const { basicDutchAuction, bidder1, bidder2 } = await loadFixture(deployDutchAuctionFixture);
      const bidAmount = ethers.parseEther("2");
      await basicDutchAuction.connect(bidder1).bid({ value: bidAmount });
      await expect(basicDutchAuction.connect(bidder2).bid({ value: bidAmount })).to.be.revertedWith("Auction has ended");
    });
  });
  describe("Finalize", function () {
    describe("Transfer Payment", function() {
      it("The seller should receive the funds from the winning bid", async function () {
        const { basicDutchAuction, seller, bidder1 } = await loadFixture(deployDutchAuctionFixture);

        const initialBalanceSeller = await ethers.provider.getBalance(seller.address);

        const bidAmount = ethers.parseEther("2");
        await basicDutchAuction.connect(bidder1).bid({ value: bidAmount });
        const finalAuctionPrice = await basicDutchAuction.currentPrice();

        const finalBalanceSeller = await ethers.provider.getBalance(seller.address);

         // Since bidder1 is the winner, the auction's price at the bid time should have been transferred to the seller
        expect(finalBalanceSeller).to.greaterThanOrEqual(initialBalanceSeller + finalAuctionPrice);
      });
    });
  });
});
```
