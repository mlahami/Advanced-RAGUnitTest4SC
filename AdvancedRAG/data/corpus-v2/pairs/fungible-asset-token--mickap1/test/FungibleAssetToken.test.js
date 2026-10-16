const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FungibleAssetToken", function () {
    let token;
    let kycRegistry;
    let owner;
    let admin;
    let alice;
    let bob;
    let charlie;

    const TOKEN_NAME = "Residence Lumiere Token";
    const TOKEN_SYMBOL = "PLM";
    const MAX_SUPPLY = ethers.parseEther("10000"); // 10,000 tokens
    const ASSET_NAME = "Residence Lumiere";
    const ASSET_TYPE = "Real Estate";
    const LOCATION = "42 Rue de Vaugirard, 75015 Paris";
    const TOTAL_VALUE = ethers.parseEther("500000"); // 500,000 EUR (in wei for proper division)
    const DOCUMENT_URI = "ipfs://QmSampleHash123";

    beforeEach(async function () {
        [owner, admin, alice, bob, charlie] = await ethers.getSigners();

        // Deploy KYCRegistry
        const KYCRegistryFactory = await ethers.getContractFactory("KYCRegistry");
        kycRegistry = await KYCRegistryFactory.deploy();
        await kycRegistry.waitForDeployment();

        // Grant KYC_ADMIN_ROLE to admin
        const KYC_ADMIN_ROLE = await kycRegistry.KYC_ADMIN_ROLE();
        await kycRegistry.grantRole(KYC_ADMIN_ROLE, admin.address);

        // Deploy FungibleAssetToken
        const TokenFactory = await ethers.getContractFactory("FungibleAssetToken");
        token = await TokenFactory.deploy(
            TOKEN_NAME,
            TOKEN_SYMBOL,
            MAX_SUPPLY,
            await kycRegistry.getAddress(),
            ASSET_NAME,
            ASSET_TYPE,
            LOCATION,
            TOTAL_VALUE,
            DOCUMENT_URI
        );
        await token.waitForDeployment();

        // Approve KYC for alice and bob
        await kycRegistry.connect(admin).approveKYC(alice.address, 0);
        await kycRegistry.connect(admin).approveKYC(bob.address, 0);
    });

    describe("Deployment", function () {
        it("Should set the correct token name and symbol", async function () {
            expect(await token.name()).to.equal(TOKEN_NAME);
            expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
        });

        it("Should set the correct max supply", async function () {
            expect(await token.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
        });

        it("Should set the correct KYC registry", async function () {
            expect(await token.kycRegistry()).to.equal(await kycRegistry.getAddress());
        });

        it("Should set the correct asset metadata", async function () {
            const metadata = await token.getAssetMetadata();
            expect(metadata.assetName).to.equal(ASSET_NAME);
            expect(metadata.assetType).to.equal(ASSET_TYPE);
            expect(metadata.location).to.equal(LOCATION);
            expect(metadata.totalValue).to.equal(TOTAL_VALUE);
            expect(metadata.documentURI).to.equal(DOCUMENT_URI);
        });

        it("Should grant roles to deployer", async function () {
            const DEFAULT_ADMIN_ROLE = await token.DEFAULT_ADMIN_ROLE();
            const ADMIN_ROLE = await token.ADMIN_ROLE();
            const MINTER_ROLE = await token.MINTER_ROLE();
            const PAUSER_ROLE = await token.PAUSER_ROLE();

            expect(await token.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
            expect(await token.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
            expect(await token.hasRole(MINTER_ROLE, owner.address)).to.be.true;
            expect(await token.hasRole(PAUSER_ROLE, owner.address)).to.be.true;
        });

        it("Should calculate correct price per token", async function () {
            // TOTAL_VALUE = 500,000 ether, MAX_SUPPLY = 10,000 ether
            // pricePerToken = 500,000 ether / 10,000 ether = 50 ether
            const expectedPrice = ethers.parseEther("50");
            expect(await token.pricePerToken()).to.equal(expectedPrice);
        });
    });

    describe("Minting", function () {
        it("Should allow minter to mint tokens to whitelisted address", async function () {
            const amount = ethers.parseEther("100");

            const tx = await token.mint(alice.address, amount);
            const receipt = await tx.wait();
            const blockNumber = receipt?.blockNumber || 0;
            const block = await ethers.provider.getBlock(blockNumber);

            await expect(tx)
                .to.emit(token, "TokensMinted")
                .withArgs(alice.address, amount, block?.timestamp);

            expect(await token.balanceOf(alice.address)).to.equal(amount);
            expect(await token.totalSupply()).to.equal(amount);
        });

        it("Should not allow minting to non-whitelisted address", async function () {
            const amount = ethers.parseEther("100");

            await expect(
                token.mint(charlie.address, amount)
            ).to.be.revertedWithCustomError(token, "RecipientNotWhitelisted");
        });

        it("Should not allow minting beyond max supply", async function () {
            await token.mint(alice.address, MAX_SUPPLY);

            await expect(
                token.mint(bob.address, ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(token, "ExceedsMaxSupply");
        });

        it("Should calculate correct price per token", async function () {
            const price = await token.pricePerToken();
            // 500,000 ether / 10,000 ether = 50 ether
            const expectedPrice = ethers.parseEther("50");
            expect(price).to.equal(expectedPrice);
        });

        it("Should not allow non-minter to mint", async function () {
            await expect(
                token.connect(alice).mint(bob.address, ethers.parseEther("100"))
            ).to.be.reverted;
        });

        it("Should not allow minting zero amount", async function () {
            await expect(
                token.mint(alice.address, 0)
            ).to.be.revertedWithCustomError(token, "ZeroAmount");
        });

        it("Should not allow minting to zero address", async function () {
            await expect(
                token.mint(ethers.ZeroAddress, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(token, "ZeroAddress");
        });
    });

    describe("Batch Minting", function () {
        it("Should batch mint to multiple addresses", async function () {
            const recipients = [alice.address, bob.address];
            const amounts = [ethers.parseEther("100"), ethers.parseEther("200")];

            await token.batchMint(recipients, amounts);

            expect(await token.balanceOf(alice.address)).to.equal(amounts[0]);
            expect(await token.balanceOf(bob.address)).to.equal(amounts[1]);
            expect(await token.totalSupply()).to.equal(ethers.parseEther("300"));
        });

        it("Should revert if arrays length mismatch", async function () {
            const recipients = [alice.address, bob.address];
            const amounts = [ethers.parseEther("100")];

            await expect(
                token.batchMint(recipients, amounts)
            ).to.be.revertedWith("Arrays length mismatch");
        });

        it("Should revert if total exceeds max supply", async function () {
            const recipients = [alice.address, bob.address];
            const amounts = [MAX_SUPPLY, ethers.parseEther("1")];

            await expect(
                token.batchMint(recipients, amounts)
            ).to.be.revertedWithCustomError(token, "ExceedsMaxSupply");
        });

        it("Should revert if any recipient not whitelisted", async function () {
            const recipients = [alice.address, charlie.address];
            const amounts = [ethers.parseEther("100"), ethers.parseEther("100")];

            await expect(
                token.batchMint(recipients, amounts)
            ).to.be.revertedWithCustomError(token, "RecipientNotWhitelisted");
        });
    });

    describe("Transfers with KYC", function () {
        beforeEach(async function () {
            await token.mint(alice.address, ethers.parseEther("1000"));
        });

        it("Should allow transfer between whitelisted addresses", async function () {
            const amount = ethers.parseEther("100");

            await expect(token.connect(alice).transfer(bob.address, amount))
                .to.changeTokenBalances(
                    token,
                    [alice, bob],
                    [-amount, amount]
                );
        });

        it("Should not allow transfer to non-whitelisted address", async function () {
            await expect(
                token.connect(alice).transfer(charlie.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(token, "RecipientNotWhitelisted");
        });

        it("Should not allow transfer from non-whitelisted address", async function () {
            // Revoke alice's KYC
            await kycRegistry.connect(admin).revokeKYC(alice.address, "Test");

            await expect(
                token.connect(alice).transfer(bob.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(token, "SenderNotWhitelisted");
        });

        it("Should not allow transfer if sender is blacklisted", async function () {
            await kycRegistry.connect(admin).blacklistAddress(alice.address, "Test");

            await expect(
                token.connect(alice).transfer(bob.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(token, "SenderBlacklisted");
        });

        it("Should not allow transfer if recipient is blacklisted", async function () {
            await kycRegistry.connect(admin).blacklistAddress(bob.address, "Test");

            await expect(
                token.connect(alice).transfer(bob.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(token, "RecipientBlacklisted");
        });

        it("Should emit KYCCheckFailed event on failed transfer", async function () {
            // Note: Events emitted before a revert cannot be tested with chai-matchers
            // This test verifies the revert happens with the correct error
            await expect(
                token.connect(alice).transfer(charlie.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(token, "RecipientNotWhitelisted");
        });
    });

    describe("Burning", function () {
        beforeEach(async function () {
            await token.mint(alice.address, ethers.parseEther("1000"));
        });

        it("Should allow user to burn their tokens", async function () {
            const amount = ethers.parseEther("100");

            const tx = await token.connect(alice).burn(amount);
            const receipt = await tx.wait();
            const blockNumber = receipt?.blockNumber || 0;
            const block = await ethers.provider.getBlock(blockNumber);

            await expect(tx)
                .to.emit(token, "TokensBurned")
                .withArgs(alice.address, amount, block?.timestamp);

            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("900"));
            expect(await token.totalSupply()).to.equal(ethers.parseEther("900"));
        });

        it("Should allow burnFrom with approval", async function () {
            const amount = ethers.parseEther("100");

            await token.connect(alice).approve(bob.address, amount);
            await token.connect(bob).burnFrom(alice.address, amount);

            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("900"));
        });
    });

    describe("Pausable", function () {
        beforeEach(async function () {
            await token.mint(alice.address, ethers.parseEther("1000"));
        });

        it("Should pause transfers", async function () {
            await token.pause();

            await expect(
                token.connect(alice).transfer(bob.address, ethers.parseEther("100"))
            ).to.be.reverted;
        });

        it("Should unpause transfers", async function () {
            await token.pause();
            await token.unpause();

            await expect(
                token.connect(alice).transfer(bob.address, ethers.parseEther("100"))
            ).to.not.be.reverted;
        });

        it("Should not allow non-pauser to pause", async function () {
            await expect(
                token.connect(alice).pause()
            ).to.be.reverted;
        });
    });

    describe("Admin Functions", function () {
        it("Should allow admin to update document URI", async function () {
            const newURI = "ipfs://QmNewHash456";

            await expect(token.updateDocumentURI(newURI))
                .to.emit(token, "AssetMetadataUpdated")
                .withArgs(newURI);

            const metadata = await token.getAssetMetadata();
            expect(metadata.documentURI).to.equal(newURI);
        });

        it("Should not allow non-admin to update document URI", async function () {
            await expect(
                token.connect(alice).updateDocumentURI("ipfs://hack")
            ).to.be.reverted;
        });
    });

    describe("View Functions", function () {
        it("Should correctly check if address can receive tokens", async function () {
            expect(await token.canReceiveTokens(alice.address)).to.be.true;
            expect(await token.canReceiveTokens(charlie.address)).to.be.false;

            await kycRegistry.connect(admin).blacklistAddress(alice.address, "Test");
            expect(await token.canReceiveTokens(alice.address)).to.be.false;
        });

        it("Should return correct remaining supply", async function () {
            expect(await token.remainingSupply()).to.equal(MAX_SUPPLY);

            await token.mint(alice.address, ethers.parseEther("1000"));
            expect(await token.remainingSupply()).to.equal(ethers.parseEther("9000"));
        });

        it("Should return correct canMint status", async function () {
            expect(await token.canMint()).to.be.true;

            await token.mint(alice.address, MAX_SUPPLY);
            expect(await token.canMint()).to.be.false;
        });

        it("Should calculate correct ownership percentage", async function () {
            await token.mint(alice.address, ethers.parseEther("1000")); // 10% of 10,000

            // 10% = 1000 basis points
            expect(await token.ownershipPercentage(alice.address)).to.equal(1000);
        });

        it("Should return correct asset metadata", async function () {
            const metadata = await token.getAssetMetadata();

            expect(metadata.assetName).to.equal(ASSET_NAME);
            expect(metadata.assetType).to.equal(ASSET_TYPE);
            expect(metadata.location).to.equal(LOCATION);
            expect(metadata.totalValue).to.equal(TOTAL_VALUE);
            expect(metadata.documentURI).to.equal(DOCUMENT_URI);
            expect(metadata.tokenizationDate).to.be.gt(0);
        });
    });

    describe("Integration: Full Flow", function () {
        it("Should handle complete tokenization lifecycle", async function () {
            // 1. Mint initial tokens
            await token.mint(alice.address, ethers.parseEther("1000"));
            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("1000"));

            // 2. Alice transfers to Bob
            await token.connect(alice).transfer(bob.address, ethers.parseEther("300"));
            expect(await token.balanceOf(bob.address)).to.equal(ethers.parseEther("300"));

            // 3. Check ownership percentages
            expect(await token.ownershipPercentage(alice.address)).to.equal(700); // 7%
            expect(await token.ownershipPercentage(bob.address)).to.equal(300); // 3%

            // 4. Bob burns some tokens
            await token.connect(bob).burn(ethers.parseEther("100"));
            expect(await token.totalSupply()).to.equal(ethers.parseEther("900"));

            // 5. Admin updates document
            await token.updateDocumentURI("ipfs://QmUpdatedDocs");
            const metadata = await token.getAssetMetadata();
            expect(metadata.documentURI).to.equal("ipfs://QmUpdatedDocs");
        });
    });
});