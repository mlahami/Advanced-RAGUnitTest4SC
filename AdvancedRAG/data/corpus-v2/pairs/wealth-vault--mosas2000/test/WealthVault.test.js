const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("WealthVault - W-Yield", function () {
    let vault, usdc, owner, user1, user2;
    
    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();
        
        // Deploy MockUSDC
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdc = await MockUSDC.deploy();
        
        // Deploy WealthVault
        const WealthVault = await ethers.getContractFactory("WealthVault");
        vault = await WealthVault.deploy(usdc.target);
    });
    
    describe("Deployment", function () {
        it("Should set correct name and symbol", async function () {
            expect(await vault.name()).to.equal("W-Yield USDC");
            expect(await vault.symbol()).to.equal("wUSDC");
        });
        
        it("Should set correct USDC address", async function () {
            expect(await vault.usdc()).to.equal(usdc.target);
        });
        
        it("Should set owner as fee recipient", async function () {
            expect(await vault.feeRecipient()).to.equal(owner.address);
        });
    });
    
    describe("Deposit", function () {
        it("Should deposit USDC and mint shares", async function () {
            const amount = ethers.parseUnits("100", 6);
            
            await usdc.mint(user1.address, amount);
            await usdc.connect(user1).approve(vault.target, amount);
            
            await vault.connect(user1).deposit(amount);
            expect(await vault.balanceOf(user1.address)).to.equal(amount);
        });
        
        it("Should revert if below minimum", async function () {
            const small = ethers.parseUnits("0.5", 6);
            await usdc.mint(user1.address, small);
            await usdc.connect(user1).approve(vault.target, small);
            
            await expect(
                vault.connect(user1).deposit(small)
            ).to.be.revertedWith("Below minimum");
        });
        
        it("Should emit Deposit event", async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(user1.address, amount);
            await usdc.connect(user1).approve(vault.target, amount);
            
            await expect(vault.connect(user1).deposit(amount))
                .to.emit(vault, "Deposit")
                .withArgs(user1.address, amount, amount);
        });
    });
    
    describe("Withdraw", function () {
        beforeEach(async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(user1.address, amount);
            await usdc.connect(user1).approve(vault.target, amount);
            await vault.connect(user1).deposit(amount);
        });
        
        it("Should withdraw USDC and burn shares", async function () {
            const shares = await vault.balanceOf(user1.address);
            
            await expect(vault.connect(user1).withdraw(shares))
                .to.emit(vault, "Withdraw");
            
            expect(await vault.balanceOf(user1.address)).to.equal(0);
        });
        
        it("Should revert if insufficient balance", async function () {
            const tooMany = ethers.parseUnits("200", 6);
            
            await expect(
                vault.connect(user1).withdraw(tooMany)
            ).to.be.revertedWith("Insufficient balance");
        });
        
        it("Should revert on zero shares", async function () {
            await expect(
                vault.connect(user1).withdraw(0)
            ).to.be.revertedWith("Zero shares");
        });
    });
    
    describe("Admin Functions", function () {
        it("Should update performance fee", async function () {
            await vault.setPerformanceFee(300);
            expect(await vault.performanceFee()).to.equal(300);
        });
        
        it("Should revert fee above max", async function () {
            await expect(
                vault.setPerformanceFee(1500)
            ).to.be.revertedWith("Fee too high");
        });
        
        it("Should update fee recipient", async function () {
            await vault.setFeeRecipient(user1.address);
            expect(await vault.feeRecipient()).to.equal(user1.address);
        });
        
        it("Should prevent non-owner admin calls", async function () {
            await expect(
                vault.connect(user1).setPerformanceFee(300)
            ).to.be.reverted;
        });
        
        it("Should emit FeeUpdated event", async function () {
            await expect(vault.setPerformanceFee(300))
                .to.emit(vault, "FeeUpdated")
                .withArgs(300);
        });
        
        it("Should emit FeeRecipientUpdated event", async function () {
            await expect(vault.setFeeRecipient(user1.address))
                .to.emit(vault, "FeeRecipientUpdated")
                .withArgs(user1.address);
        });
    });
    
    describe("View Functions", function () {
        it("Should return correct totalAssets", async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(user1.address, amount);
            await usdc.connect(user1).approve(vault.target, amount);
            await vault.connect(user1).deposit(amount);
            
            expect(await vault.totalAssets()).to.equal(amount);
        });
        
        it("Should convert assets to shares correctly", async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(user1.address, amount);
            await usdc.connect(user1).approve(vault.target, amount);
            await vault.connect(user1).deposit(amount);
            
            expect(await vault.convertToShares(amount)).to.equal(amount);
        });
        
        it("Should convert shares to assets correctly", async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(user1.address, amount);
            await usdc.connect(user1).approve(vault.target, amount);
            await vault.connect(user1).deposit(amount);
            
            const shares = await vault.balanceOf(user1.address);
            expect(await vault.convertToAssets(shares)).to.equal(amount);
        });
    });
});
