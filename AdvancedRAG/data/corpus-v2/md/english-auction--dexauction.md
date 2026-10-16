# english-auction--dexauction

- domain: auctions (auction)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/DexAuction/non-fractionalised-rwa-auction @ a359009a10713d7ee2fb7209f44f9f4fa584f7c0
- license: Apache-2.0
- targets: EnglishAuction.sol, SKLERC721.sol
- validation: 12 passing tests, 0 failing; statement coverage EnglishAuction.sol 95.45 %, SKLERC721.sol 100.0 %

## Contract: EnglishAuction.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

// Interface for interacting with an ERC721 RWA contract
interface IERC721 {
    function safeTransferFrom(address from, address to, uint256 tokenId)
        external;
    function transferFrom(address, address, uint256) external;
}

// Contract for conducting an English Auction for an RWA
contract EnglishAuction {

    // Events emitted during various stages of the auction
    event Start();
    event Bid(address indexed sender, uint256 amount);
    event Withdraw(address indexed bidder, uint256 amount);
    event End(address winner, uint256 amount);

    // RWA contract and token ID being auctioned
    IERC721 public rwa_contract;
    uint256 public rwaId;

    // Auction-related variables
    address payable public seller;
    uint256 public endAt;
    bool public started;
    bool public ended;
    uint256 public auctionDuration;

    // Bid-related variables
    address public highestBidder;
    uint256 public highestBid;
    mapping(address => uint256) public bids;

    constructor(address _rwa_contract, uint256 _rwaId, uint256 _startingBid, uint256 _auctionDuration) {
        rwa_contract = IERC721(_rwa_contract);
        rwaId = _rwaId;

        seller = payable(msg.sender);   // Set the seller as the deployer of the contract
        highestBid = _startingBid;
        auctionDuration = _auctionDuration;
    }

    // Function to start the auction
    function start() external {
        require(!started, "started"); // Ensure the auction hasn't started yet
        require(msg.sender == seller, "not seller"); // Only the seller can start the auction

        rwa_contract.transferFrom(msg.sender, address(this), rwaId);  // Transfer the RWA to the auction contract
        started = true;
        endAt = block.timestamp + auctionDuration; // Set the auction end time

        emit Start();
    }

    // Function to place a bid
    function bid() external payable {
        require(started, "not started");  // Ensure the auction has started
        require(block.timestamp < endAt, "ended"); // Ensure the auction hasn't ended
        require(msg.value > highestBid, "value < highest"); // Ensure the bid is higher than the current highest bid

        if (highestBidder != address(0)) {
            bids[highestBidder] += highestBid;
        }

        highestBidder = msg.sender;  // Set the new highest bidder
        highestBid = msg.value; // Set the new highest bid

        emit Bid(msg.sender, msg.value);
    }

    // Function to withdraw a previous bid
    function withdraw() external {
        uint256 bal = bids[msg.sender];
        require(bal > 0, "balance is zero");
        bids[msg.sender] = 0;
        payable(msg.sender).transfer(bal); // Transfer the balance to the callerc

        emit Withdraw(msg.sender, bal);
    }

    // Function to end the auction
    function end() external {
        require(started, "not started");  // Ensure the auction has started
        require(block.timestamp >= endAt, "not ended");  // Ensure the auction end time has passed
        require(!ended, "ended"); // Ensure the auction hasn't already ended
        require(msg.sender == seller, "Unauthorized: not seller"); // Only the seller can end the auction
        ended = true;
        if (highestBidder != address(0)) {
            rwa_contract.safeTransferFrom(address(this), highestBidder, rwaId); // Transfer the RWA to the highest bidder
            seller.transfer(highestBid); // Transfer the highest bid amount to the seller
        } else {
            rwa_contract.safeTransferFrom(address(this), seller, rwaId);  // Return the RWA to the seller if there are no bids
        }

        emit End(highestBidder, highestBid);
    }
}
```

## Contract: SKLERC721.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.22;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract SKLERC721 is ERC721, Ownable {
    constructor(address initialOwner)
        ERC721("MyToken", "MTK")
        Ownable(initialOwner)
    {}

    function safeMint(address to, uint256 tokenId) public onlyOwner {
        _safeMint(to, tokenId);
    }
}
```

## Tests: EnglishAuctionTest.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EnglishAuction", function () {
  let sklERC721, auction, owner, bidder1, bidder2;

  beforeEach(async function () {
    [owner, bidder1, bidder2] = await ethers.getSigners();

    // Deploy the ERC721 contract and mint a token
    const SKLERC721 = await ethers.getContractFactory("SKLERC721");
    sklERC721 = await SKLERC721.deploy(owner.address);
    await sklERC721.waitForDeployment();
    await sklERC721.safeMint(owner.address, 1);

    // Deploy the English auction contract
    const EnglishAuction = await ethers.getContractFactory("EnglishAuction");
    auction = await EnglishAuction.deploy(await sklERC721.getAddress(), 1, ethers.parseEther("1"), 60 * 60 * 24 * 7); // 7 days
    await auction.waitForDeployment();
  });

  it("should start the auction", async function () {
    await sklERC721.connect(owner).approve(await auction.getAddress(), 1);
    await auction.connect(owner).start();

    expect(await auction.started()).to.be.true;
    expect(await sklERC721.ownerOf(1)).to.equal(await auction.getAddress());
  });

  it("should not allow non-owner to start the auction", async function () {
    await expect(auction.connect(bidder1).start()).to.be.revertedWith("not seller");
  });

  it("should not allow to start the auction twice", async function () {
    await sklERC721.connect(owner).approve(await auction.getAddress(), 1);
    await auction.connect(owner).start();

    await expect(auction.connect(owner).start()).to.be.revertedWith("started");
  });

  it("should allow a bid", async function () {
    await sklERC721.connect(owner).approve(await auction.getAddress(), 1);
    await auction.connect(owner).start();

    await auction.connect(bidder1).bid({ value: ethers.parseEther("2") });

    expect(await auction.highestBidder()).to.equal(bidder1.address);
    expect(await auction.highestBid()).to.equal(ethers.parseEther("2"));
  });

  it("should not allow a bid if the auction has not started", async function () {
    await expect(auction.connect(bidder1).bid({ value: ethers.parseEther("2") })).to.be.revertedWith("not started");
  });

  it("should not allow a bid lower than the highest bid", async function () {
    await sklERC721.connect(owner).approve(await auction.getAddress(), 1);
    await auction.connect(owner).start();

    await auction.connect(bidder1).bid({ value: ethers.parseEther("2") });
    await expect(auction.connect(bidder2).bid({ value: ethers.parseEther("1.5") })).to.be.revertedWith("value < highest");
  });

  it("should not allow a bid after the auction has ended", async function () {
    await sklERC721.connect(owner).approve(await auction.getAddress(), 1);
    await auction.connect(owner).start();

    // Fast forward time to end the auction
    await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // 7 days
    await ethers.provider.send("evm_mine", []);

    await expect(auction.connect(bidder1).bid({ value: ethers.parseEther("2") })).to.be.revertedWith("ended");
  });

  it("should allow withdraw of previous bids", async function () {
    await sklERC721.connect(owner).approve(await auction.getAddress(), 1);
    await auction.connect(owner).start();

    await auction.connect(bidder1).bid({ value: ethers.parseEther("2") });
    await auction.connect(bidder2).bid({ value: ethers.parseEther("3") });

    // Bidder1 should be able to withdraw their bid
    const initialBalance = await ethers.provider.getBalance(bidder1.address);
    const tx = await auction.connect(bidder1).withdraw();
    const receipt = await tx.wait();
    const gasUsed = BigInt(receipt.gasUsed) * BigInt(tx.gasPrice);
    const finalBalance = await ethers.provider.getBalance(bidder1.address);

    expect(finalBalance).to.equal(initialBalance + (ethers.parseEther("2")) - (gasUsed));
  });

  it("should not allow withdraw if no bid was made", async function () {
    await sklERC721.connect(owner).approve(await auction.getAddress(), 1);
    await auction.connect(owner).start();

    await expect(auction.connect(bidder1).withdraw()).to.be.revertedWith("balance is zero");
  });

  it("should end the auction and transfer the RWA to the highest bidder", async function () {
    await sklERC721.connect(owner).approve(await auction.getAddress(), 1);
    await auction.connect(owner).start();

    await auction.connect(bidder1).bid({ value: ethers.parseEther("2") });

    // Fast forward time to end the auction
    await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // 7 days
    await ethers.provider.send("evm_mine", []);

    await auction.connect(owner).end();

    expect(await sklERC721.ownerOf(1)).to.equal(bidder1.address);
    expect(await auction.ended()).to.be.true;
  });

  it("should not allow end if the auction is not yet ended", async function () {
    await sklERC721.connect(owner).approve(await auction.getAddress(), 1);
    await auction.connect(owner).start();

    await auction.connect(bidder1).bid({ value: ethers.parseEther("2") });

    await expect(auction.connect(owner).end()).to.be.revertedWith("not ended");
  });

  it("should not allow end by non-owner if the auction is ended", async function () {
    await sklERC721.connect(owner).approve(await auction.getAddress(), 1);
    await auction.connect(owner).start();

    await auction.connect(bidder1).bid({ value: ethers.parseEther("2") });

    // Fast forward time to end the auction
    await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // 7 days
    await ethers.provider.send("evm_mine", []);

    await expect(auction.connect(bidder1).end()).to.be.revertedWith("Unauthorized: not seller");
  });
});
```
