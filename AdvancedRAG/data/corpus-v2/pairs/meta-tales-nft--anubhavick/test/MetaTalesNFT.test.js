const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MetaTalesNFT", function () {
  let metaTalesNFT;
  let owner;
  let creator;
  let buyer;
  let royaltyRecipient;

  const NAME = "Meta-Tales Literary NFTs";
  const SYMBOL = "MTALES";
  const DEFAULT_ROYALTY_FRACTION = 250; // 2.5%
  const TOKEN_URI = "ipfs://QmTestTokenURI123";
  const CUSTOM_ROYALTY_FRACTION = 500; // 5%

  beforeEach(async function () {
    [owner, creator, buyer, royaltyRecipient] = await ethers.getSigners();

    const MetaTalesNFT = await ethers.getContractFactory("MetaTalesNFT");
    metaTalesNFT = await MetaTalesNFT.deploy(
      NAME,
      SYMBOL,
      royaltyRecipient.address,
      DEFAULT_ROYALTY_FRACTION,
      owner.address
    );
    await metaTalesNFT.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right name and symbol", async function () {
      expect(await metaTalesNFT.name()).to.equal(NAME);
      expect(await metaTalesNFT.symbol()).to.equal(SYMBOL);
    });

    it("Should set the right owner", async function () {
      expect(await metaTalesNFT.owner()).to.equal(owner.address);
    });

    it("Should set the default royalty info", async function () {
      const [recipient, fraction] = await metaTalesNFT.getDefaultRoyalty();
      expect(recipient).to.equal(royaltyRecipient.address);
      expect(fraction).to.equal(DEFAULT_ROYALTY_FRACTION);
    });
  });

  describe("Minting", function () {
    it("Should mint NFT with custom royalty", async function () {
      const tx = await metaTalesNFT.mintNFT(
        creator.address,
        TOKEN_URI,
        creator.address,
        CUSTOM_ROYALTY_FRACTION
      );

      await expect(tx)
        .to.emit(metaTalesNFT, "TokenMinted")
        .withArgs(1, creator.address, TOKEN_URI, creator.address, CUSTOM_ROYALTY_FRACTION)
        .and.to.emit(metaTalesNFT, "RoyaltySet")
        .withArgs(1, creator.address, CUSTOM_ROYALTY_FRACTION);

      expect(await metaTalesNFT.ownerOf(1)).to.equal(creator.address);
      expect(await metaTalesNFT.tokenURI(1)).to.equal(TOKEN_URI);
      expect(await metaTalesNFT.totalSupply()).to.equal(1);
    });

    it("Should mint NFT with default royalty", async function () {
      const tx = await metaTalesNFT.mintNFTWithDefaultRoyalty(
        creator.address,
        TOKEN_URI
      );

      await expect(tx)
        .to.emit(metaTalesNFT, "TokenMinted")
        .withArgs(1, creator.address, TOKEN_URI, royaltyRecipient.address, DEFAULT_ROYALTY_FRACTION);

      const [recipient, fraction] = await metaTalesNFT.getTokenRoyalty(1);
      expect(recipient).to.equal(royaltyRecipient.address);
      expect(fraction).to.equal(DEFAULT_ROYALTY_FRACTION);
    });

    it("Should reject minting with royalty too high", async function () {
      await expect(
        metaTalesNFT.mintNFT(
          creator.address,
          TOKEN_URI,
          creator.address,
          1001 // > 10%
        )
      ).to.be.revertedWith("Royalty too high");
    });

    it("Should reject minting with invalid royalty recipient", async function () {
      await expect(
        metaTalesNFT.mintNFT(
          creator.address,
          TOKEN_URI,
          ethers.ZeroAddress,
          CUSTOM_ROYALTY_FRACTION
        )
      ).to.be.revertedWith("Invalid royalty recipient");
    });
  });

  describe("Royalty Management", function () {
    beforeEach(async function () {
      await metaTalesNFT.mintNFT(
        creator.address,
        TOKEN_URI,
        creator.address,
        CUSTOM_ROYALTY_FRACTION
      );
    });

    it("Should allow token owner to set royalty", async function () {
      const newRoyaltyFraction = 300; // 3%
      
      await expect(
        metaTalesNFT.connect(creator).setTokenRoyalty(1, buyer.address, newRoyaltyFraction)
      )
        .to.emit(metaTalesNFT, "RoyaltySet")
        .withArgs(1, buyer.address, newRoyaltyFraction);

      const [recipient, fraction] = await metaTalesNFT.getTokenRoyalty(1);
      expect(recipient).to.equal(buyer.address);
      expect(fraction).to.equal(newRoyaltyFraction);
    });

    it("Should allow contract owner to set royalty", async function () {
      const newRoyaltyFraction = 400; // 4%
      
      await expect(
        metaTalesNFT.connect(owner).setTokenRoyalty(1, owner.address, newRoyaltyFraction)
      )
        .to.emit(metaTalesNFT, "RoyaltySet")
        .withArgs(1, owner.address, newRoyaltyFraction);
    });

    it("Should reject unauthorized royalty changes", async function () {
      await expect(
        metaTalesNFT.connect(buyer).setTokenRoyalty(1, buyer.address, 300)
      ).to.be.revertedWith("Caller is not owner or token owner");
    });

    it("Should update default royalty (owner only)", async function () {
      const newRoyaltyFraction = 200; // 2%
      
      await metaTalesNFT.setDefaultRoyalty(owner.address, newRoyaltyFraction);
      
      const [recipient, fraction] = await metaTalesNFT.getDefaultRoyalty();
      expect(recipient).to.equal(owner.address);
      expect(fraction).to.equal(newRoyaltyFraction);
    });

    it("Should reject unauthorized default royalty changes", async function () {
      await expect(
        metaTalesNFT.connect(creator).setDefaultRoyalty(creator.address, 200)
      ).to.be.revertedWithCustomError(metaTalesNFT, "OwnableUnauthorizedAccount");
    });
  });

  describe("EIP-2981 Royalty Info", function () {
    beforeEach(async function () {
      await metaTalesNFT.mintNFT(
        creator.address,
        TOKEN_URI,
        creator.address,
        CUSTOM_ROYALTY_FRACTION
      );
    });

    it("Should return correct royalty info for existing token", async function () {
      const salePrice = ethers.parseEther("1"); // 1 ETH
      const expectedRoyalty = salePrice * BigInt(CUSTOM_ROYALTY_FRACTION) / BigInt(10000);

      const [recipient, royaltyAmount] = await metaTalesNFT.royaltyInfo(1, salePrice);
      
      expect(recipient).to.equal(creator.address);
      expect(royaltyAmount).to.equal(expectedRoyalty);
    });

    it("Should return default royalty for non-existent token", async function () {
      const salePrice = ethers.parseEther("1");
      
      const [recipient, royaltyAmount] = await metaTalesNFT.royaltyInfo(999, salePrice);
      
      expect(recipient).to.equal(royaltyRecipient.address);
      expect(royaltyAmount).to.equal(0); // Non-existent token returns 0 amount
    });

    it("Should calculate royalty correctly for different sale prices", async function () {
      const testPrices = [
        ethers.parseEther("0.1"),
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        ethers.parseEther("100")
      ];

      for (const price of testPrices) {
        const [, royaltyAmount] = await metaTalesNFT.royaltyInfo(1, price);
        const expectedRoyalty = price * BigInt(CUSTOM_ROYALTY_FRACTION) / BigInt(10000);
        expect(royaltyAmount).to.equal(expectedRoyalty);
      }
    });
  });

  describe("Interface Support", function () {
    it("Should support ERC721 interface", async function () {
      expect(await metaTalesNFT.supportsInterface("0x80ac58cd")).to.be.true;
    });

    it("Should support ERC2981 interface", async function () {
      expect(await metaTalesNFT.supportsInterface("0x2a55205a")).to.be.true;
    });

    it("Should support ERC165 interface", async function () {
      expect(await metaTalesNFT.supportsInterface("0x01ffc9a7")).to.be.true;
    });
  });

  describe("Token Management", function () {
    beforeEach(async function () {
      await metaTalesNFT.mintNFT(
        creator.address,
        TOKEN_URI,
        creator.address,
        CUSTOM_ROYALTY_FRACTION
      );
    });

    it("Should allow token burning", async function () {
      await metaTalesNFT.connect(creator).burn(1);
      
      await expect(metaTalesNFT.ownerOf(1)).to.be.revertedWithCustomError(
        metaTalesNFT, "ERC721NonexistentToken"
      );
    });

    it("Should clean up royalty info on burn", async function () {
      await metaTalesNFT.connect(creator).burn(1);
      
      // Token doesn't exist, should return default royalty with 0 amount
      const [recipient, royaltyAmount] = await metaTalesNFT.royaltyInfo(1, ethers.parseEther("1"));
      expect(recipient).to.equal(royaltyRecipient.address);
      expect(royaltyAmount).to.equal(0);
    });

    it("Should track total supply correctly", async function () {
      expect(await metaTalesNFT.totalSupply()).to.equal(1);
      
      await metaTalesNFT.mintNFTWithDefaultRoyalty(buyer.address, "ipfs://test2");
      expect(await metaTalesNFT.totalSupply()).to.equal(2);
      
      await metaTalesNFT.connect(creator).burn(1);
      expect(await metaTalesNFT.totalSupply()).to.equal(2); // Total supply doesn't decrease on burn
    });
  });
});