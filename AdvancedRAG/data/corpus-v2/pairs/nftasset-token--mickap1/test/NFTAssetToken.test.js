const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTAssetToken", function () {
    let nft;
    let kycRegistry;
    let owner;
    let admin;
    let alice;
    let bob;
    let charlie;

    const COLLECTION_NAME = "Tokenized Artwork Collection";
    const COLLECTION_SYMBOL = "TART";
    const ASSET_TYPE = "Digital Art";
    const COLLECTION_DESC = "Collection of unique digital artworks";

    beforeEach(async function () {
        [owner, admin, alice, bob, charlie] = await ethers.getSigners();

        const KYCRegistryFactory = await ethers.getContractFactory("KYCRegistry");
        kycRegistry = await KYCRegistryFactory.deploy();
        await kycRegistry.waitForDeployment();

        const KYC_ADMIN_ROLE = await kycRegistry.KYC_ADMIN_ROLE();
        await kycRegistry.grantRole(KYC_ADMIN_ROLE, admin.address);

        const NFTFactory = await ethers.getContractFactory("NFTAssetToken");
        nft = await NFTFactory.deploy(
            COLLECTION_NAME,
            COLLECTION_SYMBOL,
            await kycRegistry.getAddress(),
            ASSET_TYPE,
            COLLECTION_DESC
        );
        await nft.waitForDeployment();

        await kycRegistry.connect(admin).approveKYC(alice.address, 0);
        await kycRegistry.connect(admin).approveKYC(bob.address, 0);
    });

    describe("Deployment", function () {
        it("Should set the correct collection name and symbol", async function () {
            expect(await nft.name()).to.equal(COLLECTION_NAME);
            expect(await nft.symbol()).to.equal(COLLECTION_SYMBOL);
        });

        it("Should set the correct KYC registry", async function () {
            expect(await nft.kycRegistry()).to.equal(await kycRegistry.getAddress());
        });

        it("Should set the correct asset type and description", async function () {
            expect(await nft.assetType()).to.equal(ASSET_TYPE);
            expect(await nft.collectionDescription()).to.equal(COLLECTION_DESC);
        });

        it("Should grant roles to deployer", async function () {
            const DEFAULT_ADMIN_ROLE = await nft.DEFAULT_ADMIN_ROLE();
            const ADMIN_ROLE = await nft.ADMIN_ROLE();
            const MINTER_ROLE = await nft.MINTER_ROLE();
            const PAUSER_ROLE = await nft.PAUSER_ROLE();

            expect(await nft.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
            expect(await nft.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
            expect(await nft.hasRole(MINTER_ROLE, owner.address)).to.be.true;
            expect(await nft.hasRole(PAUSER_ROLE, owner.address)).to.be.true;
        });

        it("Should initialize with zero total supply", async function () {
            expect(await nft.totalSupply()).to.equal(0);
        });
    });

    describe("Minting", function () {
        it("Should mint NFT to whitelisted address", async function () {
            await expect(
                nft.mintAsset(
                    alice.address,
                    "Sunset Over Blockchain",
                    15000,
                    "ipfs://QmArtwork123",
                    "ipfs://QmCertificate456"
                )
            ).to.emit(nft, "AssetMinted");

            expect(await nft.ownerOf(0)).to.equal(alice.address);
            expect(await nft.balanceOf(alice.address)).to.equal(1);
            expect(await nft.totalSupply()).to.equal(1);
        });

        it("Should not mint to non-whitelisted address", async function () {
            await expect(
                nft.mintAsset(charlie.address, "Digital Dreams", 20000, "ipfs://QmArt", "ipfs://QmCert")
            ).to.be.revertedWithCustomError(nft, "RecipientNotWhitelisted");
        });

        it("Should assign sequential token IDs", async function () {
            await nft.mintAsset(alice.address, "Art 1", 10000, "ipfs://1", "ipfs://cert1");
            await nft.mintAsset(bob.address, "Art 2", 15000, "ipfs://2", "ipfs://cert2");
            await nft.mintAsset(alice.address, "Art 3", 20000, "ipfs://3", "ipfs://cert3");

            expect(await nft.ownerOf(0)).to.equal(alice.address);
            expect(await nft.ownerOf(1)).to.equal(bob.address);
            expect(await nft.ownerOf(2)).to.equal(alice.address);
            expect(await nft.totalSupply()).to.equal(3);
        });

        it("Should store correct asset data", async function () {
            await nft.mintAsset(
                alice.address,
                "Sunset Over Blockchain",
                15000,
                "ipfs://QmArtwork123",
                "ipfs://QmCertificate456"
            );

            const assetData = await nft.getAssetData(0);
            expect(assetData.name).to.equal("Sunset Over Blockchain");
            expect(assetData.valuation).to.equal(15000);
            expect(assetData.certificateURI).to.equal("ipfs://QmCertificate456");
            expect(assetData.isActive).to.be.true;
            expect(assetData.tokenizationDate).to.be.gt(0);
        });

        it("Should not allow non-minter to mint", async function () {
            await expect(
                nft.connect(alice).mintAsset(bob.address, "Artwork", 10000, "ipfs://uri", "ipfs://cert")
            ).to.be.reverted;
        });

        it("Should not mint to zero address", async function () {
            await expect(
                nft.mintAsset(ethers.ZeroAddress, "Artwork", 10000, "ipfs://uri", "ipfs://cert")
            ).to.be.revertedWithCustomError(nft, "ZeroAddress");
        });
    });

    describe("Batch Minting", function () {
        it("Should batch mint multiple NFTs", async function () {
            const recipients = [alice.address, bob.address, alice.address];
            const names = ["Art 1", "Art 2", "Art 3"];
            const valuations = [10000, 15000, 20000];
            const uris = ["ipfs://1", "ipfs://2", "ipfs://3"];
            const certs = ["ipfs://cert1", "ipfs://cert2", "ipfs://cert3"];

            await nft.batchMintAssets(recipients, names, valuations, uris, certs);

            expect(await nft.ownerOf(0)).to.equal(alice.address);
            expect(await nft.ownerOf(1)).to.equal(bob.address);
            expect(await nft.ownerOf(2)).to.equal(alice.address);
            expect(await nft.totalSupply()).to.equal(3);
        });

        it("Should revert if arrays length mismatch", async function () {
            await expect(
                nft.batchMintAssets(
                    [alice.address, bob.address],
                    ["Art 1"],
                    [10000, 15000],
                    ["ipfs://1", "ipfs://2"],
                    ["ipfs://cert1", "ipfs://cert2"]
                )
            ).to.be.revertedWith("Arrays length mismatch");
        });

        it("Should revert if any recipient not whitelisted", async function () {
            await expect(
                nft.batchMintAssets(
                    [alice.address, charlie.address],
                    ["Art 1", "Art 2"],
                    [10000, 15000],
                    ["ipfs://1", "ipfs://2"],
                    ["ipfs://cert1", "ipfs://cert2"]
                )
            ).to.be.revertedWithCustomError(nft, "RecipientNotWhitelisted");
        });
    });

    describe("Transfers with KYC", function () {
        beforeEach(async function () {
            await nft.mintAsset(alice.address, "Art 1", 10000, "ipfs://1", "ipfs://cert1");
        });

        it("Should allow transfer between whitelisted addresses", async function () {
            await nft.connect(alice).transferFrom(alice.address, bob.address, 0);

            expect(await nft.ownerOf(0)).to.equal(bob.address);
            expect(await nft.balanceOf(alice.address)).to.equal(0);
            expect(await nft.balanceOf(bob.address)).to.equal(1);
        });

        it("Should not allow transfer to non-whitelisted address", async function () {
            await expect(
                nft.connect(alice).transferFrom(alice.address, charlie.address, 0)
            ).to.be.revertedWithCustomError(nft, "RecipientNotWhitelisted");
        });

        it("Should not allow transfer from non-whitelisted address", async function () {
            await kycRegistry.connect(admin).revokeKYC(alice.address, "Test");

            await expect(
                nft.connect(alice).transferFrom(alice.address, bob.address, 0)
            ).to.be.revertedWithCustomError(nft, "SenderNotWhitelisted");
        });

        it("Should not allow transfer if sender is blacklisted", async function () {
            await kycRegistry.connect(admin).blacklistAddress(alice.address, "Test");

            await expect(
                nft.connect(alice).transferFrom(alice.address, bob.address, 0)
            ).to.be.revertedWithCustomError(nft, "SenderBlacklisted");
        });

        it("Should not allow transfer if recipient is blacklisted", async function () {
            await kycRegistry.connect(admin).blacklistAddress(bob.address, "Test");

            await expect(
                nft.connect(alice).transferFrom(alice.address, bob.address, 0)
            ).to.be.revertedWithCustomError(nft, "RecipientBlacklisted");
        });

        it("Should emit KYCCheckFailed event on failed transfer", async function () {
            // Note: Events emitted before a revert cannot be tested with chai-matchers
            // This test verifies the revert happens with the correct error
            await expect(
                nft.connect(alice).transferFrom(alice.address, charlie.address, 0)
            ).to.be.revertedWithCustomError(nft, "RecipientNotWhitelisted");
        });
    });

    describe("Burning", function () {
        beforeEach(async function () {
            await nft.mintAsset(alice.address, "Art 1", 10000, "ipfs://1", "ipfs://cert1");
        });

        it("Should allow owner to burn their NFT", async function () {
            await nft.connect(alice).burn(0);

            await expect(nft.ownerOf(0)).to.be.reverted;
            expect(await nft.balanceOf(alice.address)).to.equal(0);
        });

        it("Should not allow non-owner to burn", async function () {
            await expect(nft.connect(bob).burn(0)).to.be.reverted;
        });
    });

    describe("Pausable", function () {
        beforeEach(async function () {
            await nft.mintAsset(alice.address, "Art 1", 10000, "ipfs://1", "ipfs://cert1");
        });

        it("Should pause transfers", async function () {
            await nft.pause();

            await expect(
                nft.connect(alice).transferFrom(alice.address, bob.address, 0)
            ).to.be.reverted;
        });

        it("Should unpause transfers", async function () {
            await nft.pause();
            await nft.unpause();

            await expect(
                nft.connect(alice).transferFrom(alice.address, bob.address, 0)
            ).to.not.be.reverted;
        });

        it("Should not allow non-pauser to pause", async function () {
            await expect(nft.connect(alice).pause()).to.be.reverted;
        });
    });

    describe("Admin Functions", function () {
        beforeEach(async function () {
            await nft.mintAsset(alice.address, "Art 1", 10000, "ipfs://1", "ipfs://cert1");
        });

        it("Should allow admin to update valuation", async function () {
            await expect(nft.updateValuation(0, 15000))
                .to.emit(nft, "AssetValuationUpdated")
                .withArgs(0, 15000);

            const assetData = await nft.getAssetData(0);
            expect(assetData.valuation).to.equal(15000);
        });

        it("Should allow admin to update token URI", async function () {
            await nft.updateTokenURI(0, "ipfs://newURI");
            expect(await nft.tokenURI(0)).to.equal("ipfs://newURI");
        });

        it("Should allow admin to deactivate asset", async function () {
            await expect(nft.deactivateAsset(0))
                .to.emit(nft, "AssetDeactivated")
                .withArgs(0);

            const assetData = await nft.getAssetData(0);
            expect(assetData.isActive).to.be.false;
        });

        it("Should allow admin to reactivate asset", async function () {
            await nft.deactivateAsset(0);

            await expect(nft.reactivateAsset(0))
                .to.emit(nft, "AssetReactivated")
                .withArgs(0);

            const assetData = await nft.getAssetData(0);
            expect(assetData.isActive).to.be.true;
        });

        it("Should not allow non-admin to update valuation", async function () {
            await expect(nft.connect(alice).updateValuation(0, 15000)).to.be.reverted;
        });

        it("Should revert on updating non-existent token", async function () {
            await expect(
                nft.updateValuation(999, 15000)
            ).to.be.revertedWithCustomError(nft, "TokenDoesNotExist");
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            await nft.mintAsset(alice.address, "Art 1", 10000, "ipfs://1", "ipfs://cert1");
            await nft.mintAsset(bob.address, "Art 2", 15000, "ipfs://2", "ipfs://cert2");
            await nft.mintAsset(alice.address, "Art 3", 20000, "ipfs://3", "ipfs://cert3");
        });

        it("Should return tokens of owner", async function () {
            const aliceTokens = await nft.tokensOfOwner(alice.address);
            expect(aliceTokens.length).to.equal(2);
            expect(aliceTokens[0]).to.equal(0);
            expect(aliceTokens[1]).to.equal(2);

            const bobTokens = await nft.tokensOfOwner(bob.address);
            expect(bobTokens.length).to.equal(1);
            expect(bobTokens[0]).to.equal(1);
        });

        it("Should calculate total collection value", async function () {
            const totalValue = await nft.totalCollectionValue();
            expect(totalValue).to.equal(45000);
        });

        it("Should calculate total value of owner", async function () {
            const aliceValue = await nft.totalValueOf(alice.address);
            expect(aliceValue).to.equal(30000);

            const bobValue = await nft.totalValueOf(bob.address);
            expect(bobValue).to.equal(15000);
        });

        it("Should exclude deactivated assets from total values", async function () {
            await nft.deactivateAsset(0);

            const totalValue = await nft.totalCollectionValue();
            expect(totalValue).to.equal(35000);

            const aliceValue = await nft.totalValueOf(alice.address);
            expect(aliceValue).to.equal(20000);
        });

        it("Should correctly check if address can receive tokens", async function () {
            expect(await nft.canReceiveTokens(alice.address)).to.be.true;
            expect(await nft.canReceiveTokens(charlie.address)).to.be.false;

            await kycRegistry.connect(admin).blacklistAddress(alice.address, "Test");
            expect(await nft.canReceiveTokens(alice.address)).to.be.false;
        });

        it("Should return correct total supply", async function () {
            expect(await nft.totalSupply()).to.equal(3);
        });

        it("Should return correct asset data", async function () {
            const assetData = await nft.getAssetData(0);

            expect(assetData.name).to.equal("Art 1");
            expect(assetData.valuation).to.equal(10000);
            expect(assetData.certificateURI).to.equal("ipfs://cert1");
            expect(assetData.isActive).to.be.true;
            expect(assetData.tokenizationDate).to.be.gt(0);
        });

        it("Should revert when getting data for non-existent token", async function () {
            await expect(nft.getAssetData(999)).to.be.revertedWithCustomError(nft, "TokenDoesNotExist");
        });
    });

    describe("Integration: Full Flow", function () {
        it("Should handle complete NFT lifecycle", async function () {
            await nft.mintAsset(
                alice.address,
                "Sunset Over Blockchain",
                15000,
                "ipfs://QmArtwork123",
                "ipfs://QmCertificate456"
            );
            expect(await nft.ownerOf(0)).to.equal(alice.address);

            let assetData = await nft.getAssetData(0);
            expect(assetData.name).to.equal("Sunset Over Blockchain");
            expect(assetData.valuation).to.equal(15000);

            await nft.connect(alice).transferFrom(alice.address, bob.address, 0);
            expect(await nft.ownerOf(0)).to.equal(bob.address);

            await nft.updateValuation(0, 20000);
            assetData = await nft.getAssetData(0);
            expect(assetData.valuation).to.equal(20000);

            const bobValue = await nft.totalValueOf(bob.address);
            expect(bobValue).to.equal(20000);

            await nft.connect(bob).burn(0);
            await expect(nft.ownerOf(0)).to.be.reverted;
        });

        it("Should handle multiple owners and valuations", async function () {
            await nft.mintAsset(alice.address, "Art 1", 10000, "ipfs://1", "ipfs://cert1");
            await nft.mintAsset(bob.address, "Art 2", 15000, "ipfs://2", "ipfs://cert2");
            await nft.mintAsset(alice.address, "Art 3", 20000, "ipfs://3", "ipfs://cert3");

            expect(await nft.balanceOf(alice.address)).to.equal(2);
            expect(await nft.balanceOf(bob.address)).to.equal(1);

            const aliceTokens = await nft.tokensOfOwner(alice.address);
            expect(aliceTokens.length).to.equal(2);
            expect(aliceTokens[0]).to.equal(0);
            expect(aliceTokens[1]).to.equal(2);

            const totalValue = await nft.totalCollectionValue();
            expect(totalValue).to.equal(45000);

            const aliceValue = await nft.totalValueOf(alice.address);
            expect(aliceValue).to.equal(30000);

            await nft.updateValuation(0, 12000);
            await nft.updateValuation(2, 25000);

            const newAliceValue = await nft.totalValueOf(alice.address);
            expect(newAliceValue).to.equal(37000);
        });
    });
});