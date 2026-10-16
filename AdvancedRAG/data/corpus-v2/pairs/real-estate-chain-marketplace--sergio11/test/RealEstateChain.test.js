const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RealEstateChain and Marketplace", function () {
    
    async function deployFixture() {
        const [owner, seller, buyer, other] = await ethers.getSigners();
      
        const RealEstateChain = await ethers.getContractFactory("RealEstateChain");
        const realEstateChain = await RealEstateChain.deploy(owner);
      
        const Marketplace = await ethers.getContractFactory("RealEstateChainMarketplace");
        const marketplace = await Marketplace.deploy(owner, realEstateChain);
      
        return { owner, seller, buyer, other, realEstateChain, marketplace };
    }

    it("Should set the right owner", async function () {
        const { realEstateChain, owner, marketplace } = await deployFixture();
        expect(await realEstateChain.owner()).to.equal(owner.address);
        expect(await marketplace.owner()).to.equal(owner.address);
    });
    
    it("Should mint a property and assign it to the seller", async () => {
        const { realEstateChain, seller, owner } = await deployFixture();
        const tokenURI = "ipfs://example123";
    
        const tx = await realEstateChain.connect(owner).mintProperty(seller.address, tokenURI);
        await tx.wait();
    
        const balance = await realEstateChain.balanceOf(seller.address);
        const tokenId = 1;
    
        expect(await realEstateChain.ownerOf(tokenId)).to.equal(seller.address);
        expect(await realEstateChain.tokenURI(tokenId)).to.equal(tokenURI);
    });

    it("Should list a property on the marketplace", async () => {
        const { marketplace, realEstateChain, seller, owner } = await deployFixture();
        const tokenURI = "ipfs://example123";
        
        const tx = await realEstateChain.connect(owner).mintProperty(seller.address, tokenURI);
        await tx.wait();
        const tokenId = 1;
        
        const price = ethers.parseEther("1");

        await realEstateChain.connect(seller).approve(marketplace, tokenId);

        // Seller lists the property for sale
        await expect(marketplace.connect(seller).listProperty(tokenId, price))
            .to.emit(marketplace, 'PropertyListed')
            .withArgs(seller.address, tokenId, price);

        const listing = await marketplace.listings(tokenId);
        expect(listing.seller).to.equal(seller.address);
        expect(listing.price.toString()).to.equal(price.toString());
    });

    it("Should allow the buyer to purchase a property", async () => {
        const { marketplace, realEstateChain, seller, buyer, owner } = await deployFixture();
        const tokenURI = "ipfs://example123";
        
        const tx = await realEstateChain.connect(owner).mintProperty(seller.address, tokenURI);
        await tx.wait();
        const tokenId = 1;

        const price = ethers.parseEther("1");

        await realEstateChain.connect(seller).approve(marketplace, tokenId);
        await marketplace.connect(seller).listProperty(tokenId, price);

        // Buyer purchases the property
        await expect(marketplace.connect(buyer).buyProperty(tokenId, { value: price }))
            .to.emit(marketplace, 'PropertySold')
            .withArgs(buyer.address, tokenId, price);

        // Verify ownership has transferred
        expect(await realEstateChain.ownerOf(tokenId)).to.equal(buyer.address);
    });

    it("Should allow the seller to cancel the listing", async () => {
        const { marketplace, realEstateChain, seller, owner } = await deployFixture();
        const tokenURI = "ipfs://example123";
        
        const tx = await realEstateChain.connect(owner).mintProperty(seller.address, tokenURI);
        await tx.wait();
        const tokenId = 1;

        const price = ethers.parseEther("1");

        await realEstateChain.connect(seller).approve(marketplace, tokenId);
        await marketplace.connect(seller).listProperty(tokenId, price);

        // Seller cancels the listing
        await expect(marketplace.connect(seller).cancelListing(tokenId))
            .to.emit(marketplace, 'PropertyUnlisted')
            .withArgs(tokenId);

        const listing = await marketplace.listings(tokenId);
        expect(listing.seller).to.equal('0x0000000000000000000000000000000000000000');
        expect(listing.price.toString()).to.equal("0");
    });

    // Test for property transfer
    it("Should allow a property to be transferred", async () => {
        const { realEstateChain, seller, buyer, owner } = await deployFixture();
        const tokenURI = "ipfs://example123";
        
        const tx = await realEstateChain.connect(owner).mintProperty(seller.address, tokenURI);
        await tx.wait();
        const tokenId = 1;

        // Transfer property to buyer
        await expect(realEstateChain.connect(seller).transferFrom(seller.address, buyer.address, tokenId))
            .to.emit(realEstateChain, 'Transfer')
            .withArgs(seller.address, buyer.address, tokenId);

        expect(await realEstateChain.ownerOf(tokenId)).to.equal(buyer.address);
    });
});