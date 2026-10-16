const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RealEstateTransaction Contract", function () {
    it("Should allow users to register with a specific role", async function () {
        const [owner, seller, buyer] = await ethers.getSigners();
      
        const RealEstateTransaction = await ethers.getContractFactory("RealEstateTransaction");
        const contract = await RealEstateTransaction.deploy();
      
        // Seller registers
        await contract.connect(seller).register(1); // Role.Seller
        const sellerInfo = await contract.participants(seller.address);
        expect(sellerInfo.role).to.equal(1);
      
        // Buyer registers
        await contract.connect(buyer).register(0); // Role.Buyer
        const buyerInfo = await contract.participants(buyer.address);
        expect(buyerInfo.role).to.equal(0);
    });

    it("Should allow a seller to list a property", async function () {
        const [owner, seller] = await ethers.getSigners();
      
        const RealEstateTransaction = await ethers.getContractFactory("RealEstateTransaction");
        const contract = await RealEstateTransaction.deploy();
      
        // Seller registers
        await contract.connect(seller).register(1); // Role.Seller
      
        // Seller lists a property
        await contract.connect(seller).listProperty("123 Main St", ethers.parseEther("100"));
        const property = await contract.properties(1);
      
        expect(property.description).to.equal("123 Main St");
        expect(property.price).to.equal(ethers.parseEther("100"));
        expect(property.owner).to.equal(seller.address);
        expect(property.isListed).to.be.true;
    });

    it("Should allow a buyer to make an offer on a listed property", async function () {
        const [owner, seller, buyer] = await ethers.getSigners();
      
        const RealEstateTransaction = await ethers.getContractFactory("RealEstateTransaction");
        const contract = await RealEstateTransaction.deploy();
      
        // Participants register
        await contract.connect(seller).register(1); // Role.Seller
        await contract.connect(buyer).register(0); // Role.Buyer
      
        // Seller lists a property
        await contract.connect(seller).listProperty("456 Elm St", ethers.parseEther("150"));
      
        // Buyer makes an offer
        await contract.connect(buyer).makeOffer(1, { value: ethers.parseEther("150") });
        const offer = await contract.offers(1, 0);
      
        expect(offer.buyer).to.equal(buyer.address);
        expect(offer.offerPrice).to.equal(ethers.parseEther("150"));
        expect(offer.isAccepted).to.be.false;
        expect(offer.escrowInitiated).to.be.false;
    });

    it("Should allow a seller to accept an offer", async function () {
        const [owner, seller, buyer] = await ethers.getSigners();
      
        const RealEstateTransaction = await ethers.getContractFactory("RealEstateTransaction");
        const contract = await RealEstateTransaction.deploy();
      
        // Participants register
        await contract.connect(seller).register(1); // Role.Seller
        await contract.connect(buyer).register(0); // Role.Buyer
      
        // Seller lists a property
        await contract.connect(seller).listProperty("789 Oak Ave", ethers.parseEther("200"));
      
        // Buyer makes an offer
        await contract.connect(buyer).makeOffer(1, { value: ethers.parseEther("200") });
      
        // Seller accepts the offer
        await contract.connect(seller).acceptOffer(1, 0);
        const offer = await contract.offers(1, 0);
      
        expect(offer.isAccepted).to.be.true;
    });

    it("Should allow the buyer to initiate escrow after offer acceptance", async function () {
        const [owner, seller, buyer] = await ethers.getSigners();
      
        const RealEstateTransaction = await ethers.getContractFactory("RealEstateTransaction");
        const contract = await RealEstateTransaction.deploy();
      
        // Participants register
        await contract.connect(seller).register(1); // Role.Seller
        await contract.connect(buyer).register(0); // Role.Buyer
      
        // Seller lists a property
        await contract.connect(seller).listProperty("101 Pine Rd", ethers.parseEther("250"));
      
        // Buyer makes an offer
        await contract.connect(buyer).makeOffer(1, { value: ethers.parseEther("250") });
      
        // Seller accepts the offer
        await contract.connect(seller).acceptOffer(1, 0);
      
        // Buyer initiates escrow
        await contract.connect(buyer).initiateEscrow(1, 0);
        const offer = await contract.offers(1, 0);
        const escrow = await contract.escrows(1);
      
        expect(offer.escrowInitiated).to.be.true;
        expect(escrow.amount).to.equal(ethers.parseEther("250"));
        expect(escrow.buyer).to.equal(buyer.address);
        expect(escrow.seller).to.equal(seller.address);
    });

    it("Should allow funds to be released from escrow, transferring ownership and funds", async function () {
        const [owner, seller, buyer] = await ethers.getSigners();
      
        const RealEstateTransaction = await ethers.getContractFactory("RealEstateTransaction");
        const contract = await RealEstateTransaction.deploy();
      
        // Participants register
        await contract.connect(seller).register(1); // Role.Seller
        await contract.connect(buyer).register(0); // Role.Buyer
      
        // Seller lists a property
        await contract.connect(seller).listProperty("202 Maple St", ethers.parseEther("300"));
      
        // Buyer makes an offer
        await contract.connect(buyer).makeOffer(1, { value: ethers.parseEther("300") });
      
        // Seller accepts the offer
        await contract.connect(seller).acceptOffer(1, 0);
      
        // Buyer initiates escrow
        await contract.connect(buyer).initiateEscrow(1, 0);
      
        // Check initial balances
        const sellerInitialBalance = await ethers.provider.getBalance(seller.address);
        const buyerInitialBalance = await ethers.provider.getBalance(buyer.address);
      
        // Release funds
        await contract.connect(buyer).releaseFunds(1);
      
        // Verify escrow is updated
        const escrow = await contract.escrows(1);
        expect(escrow.fundsReleased).to.be.true;
      
        // Verify property ownership transferred
        const property = await contract.properties(1);
        expect(property.owner).to.equal(buyer.address);
        expect(property.isListed).to.be.false;
      
        // Verify seller received funds
        const sellerFinalBalance = await ethers.provider.getBalance(seller.address);
        expect(sellerFinalBalance).to.equal(sellerInitialBalance+ethers.parseEther("300"));
    });
    
      
      
  });
  