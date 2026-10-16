const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * SimpleToken Test Suite
 * 
 * This test file demonstrates:
 * - Setting up test fixtures
 * - Testing contract deployment
 * - Testing token transfers
 * - Testing access control
 */
describe("SimpleToken", function () {
    
    // Test fixtures - reusable deployment setup
    async function deployTokenFixture() {
        // Get signers (test accounts)
        const [owner, addr1, addr2] = await ethers.getSigners();
        
        // Deploy contract
        const initialSupply = ethers.parseEther("1000000"); // 1 million tokens
        const SimpleToken = await ethers.getContractFactory("SimpleToken");
        const token = await SimpleToken.deploy("My Token", "MTK", initialSupply);
        
        return { token, owner, addr1, addr2, initialSupply };
    }

    describe("Deployment", function () {
        it("Should set the right name and symbol", async function () {
            const { token } = await deployTokenFixture();
            
            expect(await token.name()).to.equal("My Token");
            expect(await token.symbol()).to.equal("MTK");
        });

        it("Should assign the initial supply to the owner", async function () {
            const { token, owner, initialSupply } = await deployTokenFixture();
            
            const ownerBalance = await token.balanceOf(owner.address);
            expect(ownerBalance).to.equal(initialSupply);
        });

        it("Should set the deployer as owner", async function () {
            const { token, owner } = await deployTokenFixture();
            
            expect(await token.owner()).to.equal(owner.address);
        });
    });

    describe("Transfers", function () {
        it("Should transfer tokens between accounts", async function () {
            const { token, owner, addr1 } = await deployTokenFixture();
            
            const transferAmount = ethers.parseEther("100");
            
            // Transfer from owner to addr1
            await token.transfer(addr1.address, transferAmount);
            expect(await token.balanceOf(addr1.address)).to.equal(transferAmount);
        });

        it("Should emit Transfer event", async function () {
            const { token, owner, addr1 } = await deployTokenFixture();
            
            const transferAmount = ethers.parseEther("100");
            
            await expect(token.transfer(addr1.address, transferAmount))
                .to.emit(token, "Transfer")
                .withArgs(owner.address, addr1.address, transferAmount);
        });

        it("Should fail if sender doesn't have enough tokens", async function () {
            const { token, owner, addr1 } = await deployTokenFixture();
            
            // Try to transfer more than balance
            const transferAmount = ethers.parseEther("1");
            await expect(
                token.connect(addr1).transfer(owner.address, transferAmount)
            ).to.be.reverted;
        });
    });

    describe("Minting", function () {
        it("Should allow owner to mint new tokens", async function () {
            const { token, owner, addr1 } = await deployTokenFixture();
            
            const mintAmount = ethers.parseEther("500");
            await token.mint(addr1.address, mintAmount);
            
            expect(await token.balanceOf(addr1.address)).to.equal(mintAmount);
        });

        it("Should not allow non-owner to mint", async function () {
            const { token, addr1, addr2 } = await deployTokenFixture();
            
            const mintAmount = ethers.parseEther("500");
            await expect(
                token.connect(addr1).mint(addr2.address, mintAmount)
            ).to.be.reverted;
        });
    });
});
