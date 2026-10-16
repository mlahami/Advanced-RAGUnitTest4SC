const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTicket", function () {
  let NFTicket;
  let nfticket;
  let owner;
  let minter;
  let buyer;
  let reseller;
  let royaltyRecipient;
  let addrs;

  const eventName = "Test Concert";
  const eventDescription = "A test concert event";
  const eventDate = Math.floor(Date.now() / 1000) + 86400; // Tomorrow
  const eventVenue = "Test Venue";
  const royaltyCap = 500; // 5%
  const maxPrice = ethers.parseEther("1.0"); // 1 ETH
  const originalPrice = ethers.parseEther("0.1"); // 0.1 ETH

  beforeEach(async function () {
    [owner, minter, buyer, reseller, royaltyRecipient, ...addrs] = await ethers.getSigners();

    NFTicket = await ethers.getContractFactory("NFTicket");
    nfticket = await NFTicket.deploy(
      eventName,
      eventDescription,
      eventDate,
      eventVenue,
      royaltyCap,
      maxPrice,
      royaltyRecipient.address
    );

    // Grant minter role
    const MINTER_ROLE = await nfticket.MINTER_ROLE();
    await nfticket.grantRole(MINTER_ROLE, minter.address);
  });

  describe("Deployment", function () {
    it("Should set the right event information", async function () {
      const eventInfo = await nfticket.getEventInfo();
      expect(eventInfo.name).to.equal(eventName);
      expect(eventInfo.description).to.equal(eventDescription);
      expect(eventInfo.date).to.equal(eventDate);
      expect(eventInfo.venue).to.equal(eventVenue);
    });

    it("Should set the right anti-scalping parameters", async function () {
      expect(await nfticket.royaltyCap()).to.equal(royaltyCap);
      expect(await nfticket.maxPrice()).to.equal(maxPrice);
      expect(await nfticket.royaltyRecipient()).to.equal(royaltyRecipient.address);
    });

    it("Should grant roles correctly", async function () {
      const DEFAULT_ADMIN_ROLE = await nfticket.DEFAULT_ADMIN_ROLE();
      const ADMIN_ROLE = await nfticket.ADMIN_ROLE();
      const MINTER_ROLE = await nfticket.MINTER_ROLE();

      expect(await nfticket.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
      expect(await nfticket.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
      expect(await nfticket.hasRole(MINTER_ROLE, owner.address)).to.be.true;
      expect(await nfticket.hasRole(MINTER_ROLE, minter.address)).to.be.true;
    });
  });

  describe("Minting", function () {
    it("Should mint a ticket successfully", async function () {
      const tokenURI = "https://example.com/token/1";
      
      const tokenId = 0; // First minted token will have ID 0
      await expect(nfticket.connect(minter).mintTicket(buyer.address, tokenURI, originalPrice))
        .to.emit(nfticket, "TicketMinted")
        .withArgs(tokenId, buyer.address, tokenURI);

      expect(await nfticket.ownerOf(tokenId)).to.equal(buyer.address);
      expect(await nfticket.tokenURI(tokenId)).to.equal(tokenURI);
      
      const ticketInfo = await nfticket.getTicketInfo(tokenId);
      expect(ticketInfo.owner).to.equal(buyer.address);
      expect(ticketInfo.uri).to.equal(tokenURI);
      expect(ticketInfo.used).to.be.false;
      expect(ticketInfo.origPrice).to.equal(originalPrice);
    });

    it("Should fail if non-minter tries to mint", async function () {
      const tokenURI = "https://example.com/token/1";
      
      await expect(nfticket.connect(buyer).mintTicket(buyer.address, tokenURI, originalPrice))
        .to.be.reverted;
    });
  });

  describe("Transfer with Price", function () {
    beforeEach(async function () {
      const tokenURI = "https://example.com/token/1";
      await nfticket.connect(minter).mintTicket(buyer.address, tokenURI, originalPrice);
      await nfticket.connect(buyer).approve(reseller.address, 0);
    });

    it("Should transfer with valid price and royalty", async function () {
      const salePrice = ethers.parseEther("0.5");
      const royaltyCapBigInt = BigInt(royaltyCap);
      const expectedRoyalty = (salePrice * royaltyCapBigInt) / 10000n;
      const expectedSellerAmount = salePrice - expectedRoyalty;

      const initialRoyaltyBalance = await ethers.provider.getBalance(royaltyRecipient.address);
      const initialBuyerBalance = await ethers.provider.getBalance(buyer.address);

      await expect(
        nfticket.connect(reseller).transferWithPrice(buyer.address, reseller.address, 0, salePrice, {
          value: salePrice
        })
      )
        .to.emit(nfticket, "TicketTransferred")
        .withArgs(0, buyer.address, reseller.address, salePrice, expectedRoyalty);

      expect(await nfticket.ownerOf(0)).to.equal(reseller.address);

      const finalRoyaltyBalance = await ethers.provider.getBalance(royaltyRecipient.address);
      const finalBuyerBalance = await ethers.provider.getBalance(buyer.address);

      expect(finalRoyaltyBalance - initialRoyaltyBalance).to.equal(expectedRoyalty);
      expect(finalBuyerBalance - initialBuyerBalance).to.equal(expectedSellerAmount);
    });

    it("Should fail if sale price exceeds max price", async function () {
      const excessivePrice = ethers.parseEther("2.0"); // Exceeds maxPrice of 1 ETH

      await expect(
        nfticket.connect(reseller).transferWithPrice(buyer.address, reseller.address, 0, excessivePrice, {
          value: excessivePrice
        })
      ).to.be.revertedWith("NFTicket: sale price exceeds maximum allowed price");
    });

    it("Should fail if insufficient payment", async function () {
      const salePrice = ethers.parseEther("0.5");
      const insufficientPayment = ethers.parseEther("0.3");

      await expect(
        nfticket.connect(reseller).transferWithPrice(buyer.address, reseller.address, 0, salePrice, {
          value: insufficientPayment
        })
      ).to.be.revertedWith("NFTicket: insufficient payment");
    });

    it("Should refund excess payment", async function () {
      const salePrice = ethers.parseEther("0.5");
      const excessPayment = ethers.parseEther("0.7");
      
      // Calculate expected spent amount
      const initialResellerBalance = await ethers.provider.getBalance(reseller.address);

      const tx = await nfticket.connect(reseller).transferWithPrice(buyer.address, reseller.address, 0, salePrice, {
        value: excessPayment
      });
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalResellerBalance = await ethers.provider.getBalance(reseller.address);
      const actualSpent = initialResellerBalance - finalResellerBalance;

      // Should have spent only salePrice + gas, not the excess
      expect(actualSpent).to.equal(salePrice + gasUsed);
    });

    it("Should allow free transfers (gifts)", async function () {
      await expect(
        nfticket.connect(reseller).transferWithPrice(buyer.address, reseller.address, 0, 0)
      ).to.not.be.reverted;

      expect(await nfticket.ownerOf(0)).to.equal(reseller.address);
    });
  });

  describe("Ticket Usage", function () {
    beforeEach(async function () {
      const tokenURI = "https://example.com/token/1";
      await nfticket.connect(minter).mintTicket(buyer.address, tokenURI, originalPrice);
    });

    it("Should mark ticket as used", async function () {
      await expect(nfticket.connect(buyer).useTicket(0))
        .to.emit(nfticket, "TicketUsed")
        .withArgs(0, buyer.address);

      expect(await nfticket.ticketUsed(0)).to.be.true;
    });

    it("Should fail if non-owner tries to use ticket", async function () {
      await expect(nfticket.connect(reseller).useTicket(0))
        .to.be.revertedWith("NFTicket: caller is not the owner");
    });

    it("Should fail if ticket is already used", async function () {
      await nfticket.connect(buyer).useTicket(0);
      
      await expect(nfticket.connect(buyer).useTicket(0))
        .to.be.revertedWith("NFTicket: ticket has already been used");
    });

    it("Should prevent transfer of used tickets", async function () {
      await nfticket.connect(buyer).useTicket(0);
      await nfticket.connect(buyer).approve(reseller.address, 0);

      await expect(
        nfticket.connect(reseller).transferWithPrice(buyer.address, reseller.address, 0, 0)
      ).to.be.revertedWith("NFTicket: ticket has already been used");
    });
  });

  describe("Restricted Transfers", function () {
    let tokenId;

    beforeEach(async function () {
      const tokenURI = "https://example.com/token/restricted";
      tokenId = 0;
      await nfticket.connect(minter).mintTicket(buyer.address, tokenURI, originalPrice);
    });

    it("Should fail if user tries to transfer via transferFrom (OpenSea bypass)", async function () {
      await nfticket.connect(buyer).approve(reseller.address, tokenId);
      
      await expect(
        nfticket.connect(reseller).transferFrom(buyer.address, reseller.address, tokenId)
      ).to.be.revertedWith("NFTicket: transfers restricted to approved marketplaces");
    });

    it("Should fail if user tries to transfer via safeTransferFrom", async function () {
      await nfticket.connect(buyer).approve(reseller.address, tokenId);
      
      await expect(
        nfticket.connect(reseller)["safeTransferFrom(address,address,uint256)"](buyer.address, reseller.address, tokenId)
      ).to.be.revertedWith("NFTicket: transfers restricted to approved marketplaces");
    });

    it("Should allow transfer if sender is an approved marketplace", async function () {
      // Approve reseller as a marketplace for testing
      await nfticket.setApprovedMarketplace(reseller.address, true);
      
      await nfticket.connect(buyer).approve(reseller.address, tokenId);
      
      await expect(
        nfticket.connect(reseller).transferFrom(buyer.address, reseller.address, tokenId)
      ).to.not.be.reverted;

      expect(await nfticket.ownerOf(tokenId)).to.equal(reseller.address);
    });

    it("Should still allow transferWithPrice (internal mechanism)", async function () {
      await nfticket.connect(buyer).approve(reseller.address, tokenId);
      const salePrice = ethers.parseEther("0.5");

      await expect(
        nfticket.connect(reseller).transferWithPrice(buyer.address, reseller.address, tokenId, salePrice, {
           value: salePrice 
        })
      ).to.not.be.reverted;

      expect(await nfticket.ownerOf(tokenId)).to.equal(reseller.address);
    });
  });

  describe("Admin Functions", function () {
    it("Should update royalty cap", async function () {
      const newRoyaltyCap = 1000; // 10%

      await expect(nfticket.setRoyaltyCap(newRoyaltyCap))
        .to.emit(nfticket, "RoyaltyCapUpdated")
        .withArgs(newRoyaltyCap);

      expect(await nfticket.royaltyCap()).to.equal(newRoyaltyCap);
    });

    it("Should fail to set royalty cap above 25%", async function () {
      const excessiveRoyaltyCap = 2600; // 26%

      await expect(nfticket.setRoyaltyCap(excessiveRoyaltyCap))
        .to.be.revertedWith("NFTicket: royalty cap cannot exceed 25%");
    });

    it("Should update max price", async function () {
      const newMaxPrice = ethers.parseEther("2.0");

      await expect(nfticket.setMaxPrice(newMaxPrice))
        .to.emit(nfticket, "MaxPriceUpdated")
        .withArgs(newMaxPrice);

      expect(await nfticket.maxPrice()).to.equal(newMaxPrice);
    });

    it("Should update royalty recipient", async function () {
      await expect(nfticket.setRoyaltyRecipient(addrs[0].address))
        .to.emit(nfticket, "RoyaltyRecipientUpdated")
        .withArgs(addrs[0].address);

      expect(await nfticket.royaltyRecipient()).to.equal(addrs[0].address);
    });

    it("Should fail to set zero address as royalty recipient", async function () {
      await expect(nfticket.setRoyaltyRecipient(ethers.ZeroAddress))
        .to.be.revertedWith("NFTicket: royalty recipient cannot be zero address");
    });

    it("Should fail if non-admin tries to update parameters", async function () {
      await expect(nfticket.connect(buyer).setRoyaltyCap(1000))
        .to.be.reverted;

      await expect(nfticket.connect(buyer).setMaxPrice(ethers.parseEther("2.0")))
        .to.be.reverted;

      await expect(nfticket.connect(buyer).setRoyaltyRecipient(addrs[0].address))
        .to.be.reverted;
        
      await expect(nfticket.connect(buyer).setApprovedMarketplace(addrs[0].address, true))
        .to.be.reverted;
    });

    it("Should update approved marketplaces", async function () {
        const marketplace = addrs[0].address;
        
        await expect(nfticket.setApprovedMarketplace(marketplace, true))
            .to.emit(nfticket, "MarketplaceApprovalUpdated")
            .withArgs(marketplace, true);
            
        expect(await nfticket.approvedMarketplaces(marketplace)).to.be.true;
    });
  });
});

