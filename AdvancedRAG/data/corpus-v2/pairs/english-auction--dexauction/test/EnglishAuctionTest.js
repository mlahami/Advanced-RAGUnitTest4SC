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
