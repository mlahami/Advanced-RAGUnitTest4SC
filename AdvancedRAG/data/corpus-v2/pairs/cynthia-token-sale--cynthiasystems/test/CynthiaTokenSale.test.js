const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CynthiaTokenSale", function () {
  let CynthiaToken, cynthiaToken, CynthiaTokenSale, cynthiaTokenSale, AttackContract;
  let owner, addr1, addr2, addrs;

  beforeEach(async function () {
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

    CynthiaToken = await ethers.getContractFactory("CynthiaToken");
    cynthiaToken = await CynthiaToken.deploy(owner.address);

    CynthiaTokenSale = await ethers.getContractFactory("CynthiaTokenSale");
    cynthiaTokenSale = await CynthiaTokenSale.deploy(await cynthiaToken.getAddress());

    await cynthiaToken.transfer(await cynthiaTokenSale.getAddress(), ethers.parseEther("500000"));

    AttackContract = await ethers.getContractFactory("AttackContract");
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await cynthiaTokenSale.owner()).to.equal(owner.address);
    });

    it("Should set the correct token address", async function () {
      const tokenAddress = await cynthiaToken.getAddress();
      expect(await cynthiaTokenSale.cynthiaToken()).to.equal(tokenAddress);
    });

    it("Should have the correct token balance", async function () {
      expect(await cynthiaTokenSale.getContractTokenBalance()).to.equal(ethers.parseEther("500000"));
    });
  });

  describe("buyTokens", function () {
    it("Should allow purchase of tokens", async function () {
      const purchaseAmount = ethers.parseEther("1"); // 1 ETH
      const expectedTokens = ethers.parseEther("1"); // 1 CYNTHIA token
  
      await expect(() => cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount }))
        .to.changeEtherBalances([addr1, cynthiaTokenSale], [-purchaseAmount, purchaseAmount]);
  
      expect(await cynthiaToken.balanceOf(addr1.address)).to.equal(expectedTokens);
    });
  
    it("Should allow fractional token purchases", async function () {
      const purchaseAmount = ethers.parseEther("0.5"); // 0.5 ETH
      const expectedTokens = ethers.parseEther("0.5"); // 0.5 CYNTHIA token
  
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount });
      expect(await cynthiaToken.balanceOf(addr1.address)).to.equal(expectedTokens);
    });
  
    it("Should emit TokensPurchased event", async function () {
      const purchaseAmount = ethers.parseEther("1");
      const expectedTokens = ethers.parseEther("1");
  
      await expect(cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount }))
        .to.emit(cynthiaTokenSale, "TokensPurchased")
        .withArgs(addr1.address, expectedTokens);
    });
  
    it("Should revert if payment is insufficient", async function () {
      const purchaseAmount = ethers.parseEther("0"); // 0 ETH
  
      await expect(cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount }))
        .to.be.revertedWith("Insufficient payment");
    });
  
    it("Should revert if contract doesn't have enough tokens", async function () {
      // Deploy a new sale contract with a very small balance
      const smallBalance = ethers.parseEther("0.1"); // 0.1 CYNTHIA
      const newSaleContract = await CynthiaTokenSale.deploy(await cynthiaToken.getAddress());
      await cynthiaToken.transfer(await newSaleContract.getAddress(), smallBalance);
    
      const purchaseAmount = ethers.parseEther("1"); // Try to buy 1 CYNTHIA
    
      await expect(newSaleContract.connect(addr1).buyTokens({ value: purchaseAmount }))
        .to.be.revertedWith("Not enough tokens in contract");
    });
    
    it("Should handle multiple purchases correctly", async function () {
      const purchaseAmount = ethers.parseEther("0.5");
      const expectedTokens = ethers.parseEther("1"); // 0.5 + 0.5 = 1 CYNTHIA
    
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount });
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount });
    
      const balance = await cynthiaToken.balanceOf(addr1.address);
      expect(balance).to.equal(expectedTokens);
    });
  });

  describe("withdrawEther", function () {
    it("Should allow the owner to withdraw all ETH", async function () {
      // First, let's buy some tokens to ensure there's ETH in the contract
      const purchaseAmount = ethers.parseEther("1");
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount });
  
      const initialOwnerBalance = await ethers.provider.getBalance(owner.address);
      const contractBalance = await ethers.provider.getBalance(await cynthiaTokenSale.getAddress());
  
      const tx = await cynthiaTokenSale.connect(owner).withdrawEther();
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
  
      const finalOwnerBalance = await ethers.provider.getBalance(owner.address);
      const finalContractBalance = await ethers.provider.getBalance(await cynthiaTokenSale.getAddress());
  
      expect(finalOwnerBalance).to.equal(initialOwnerBalance + contractBalance - gasCost);
      expect(finalContractBalance).to.equal(0);
    });
  
    it("Should emit EtherWithdrawn event", async function () {
      const purchaseAmount = ethers.parseEther("1");
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount });
  
      await expect(cynthiaTokenSale.connect(owner).withdrawEther())
        .to.emit(cynthiaTokenSale, "EtherWithdrawn")
        .withArgs(owner.address, purchaseAmount);
    });
  
    it("Should revert if called by non-owner", async function () {
      await expect(cynthiaTokenSale.connect(addr1).withdrawEther())
        .to.be.revertedWithCustomError(cynthiaTokenSale, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });
  
    it("Should not revert if contract balance is zero", async function () {
      // Ensure contract has zero balance
      const contractBalance = await ethers.provider.getBalance(await cynthiaTokenSale.getAddress());
      if (contractBalance > 0) {
        await cynthiaTokenSale.connect(owner).withdrawEther();
      }
  
      // Attempt to withdraw again
      await expect(cynthiaTokenSale.connect(owner).withdrawEther()).to.not.be.reverted;
    });
  
    it("Should update contract balance to zero after withdrawal", async function () {
      const purchaseAmount = ethers.parseEther("1");
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount });
  
      await cynthiaTokenSale.connect(owner).withdrawEther();
  
      const finalContractBalance = await ethers.provider.getBalance(await cynthiaTokenSale.getAddress());
      expect(finalContractBalance).to.equal(0);
    });
  });

  describe("getContractTokenBalance", function () {
    it("Should return the correct initial balance", async function () {
      const expectedBalance = ethers.parseEther("500000");
      const balance = await cynthiaTokenSale.getContractTokenBalance();
      expect(balance).to.equal(expectedBalance);
    });
  
    it("Should update after token purchase", async function () {
      const initialBalance = await cynthiaTokenSale.getContractTokenBalance();
      const purchaseAmount = ethers.parseEther("1");
      
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount });
      
      const finalBalance = await cynthiaTokenSale.getContractTokenBalance();
      expect(finalBalance).to.equal(initialBalance - purchaseAmount);
    });
  
    it("Should be callable by non-owner", async function () {
      await expect(cynthiaTokenSale.connect(addr1).getContractTokenBalance()).to.not.be.reverted;
    });
  
    it("Should return correct balance after multiple transactions", async function () {
      const initialBalance = await cynthiaTokenSale.getContractTokenBalance();
      const purchaseAmount1 = ethers.parseEther("1");
      const purchaseAmount2 = ethers.parseEther("2");
  
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount1 });
      await cynthiaTokenSale.connect(addr2).buyTokens({ value: purchaseAmount2 });
  
      const finalBalance = await cynthiaTokenSale.getContractTokenBalance();
      expect(finalBalance).to.equal(initialBalance - purchaseAmount1 - purchaseAmount2);
    });
  
    it("Should not be affected by contract's ETH balance", async function () {
      const initialTokenBalance = await cynthiaTokenSale.getContractTokenBalance();
      const purchaseAmount = ethers.parseEther("1");
  
      // Buy tokens to increase the contract's ETH balance
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount });
  
      const finalTokenBalance = await cynthiaTokenSale.getContractTokenBalance();
      expect(finalTokenBalance).to.equal(initialTokenBalance - purchaseAmount);
    });
  });

  describe("Reentrancy Protection", function () {
    let attackContract;
  
    beforeEach(async function () {
      // Deploy the attack contract
      const AttackContract = await ethers.getContractFactory("AttackContract");
      attackContract = await AttackContract.deploy(await cynthiaTokenSale.getAddress());
    });
  
    it("Should prevent reentrancy attacks", async function () {
      const initialAttackerBalance = await cynthiaToken.balanceOf(await attackContract.getAddress());
      const initialContractBalance = await cynthiaTokenSale.getContractTokenBalance();
      const attackValue = ethers.parseEther("1");
  
      await attackContract.attack({ value: attackValue });
  
      const finalAttackerBalance = await cynthiaToken.balanceOf(await attackContract.getAddress());
      const finalContractBalance = await cynthiaTokenSale.getContractTokenBalance();
  
      // The attacker should receive tokens for one transaction only
      expect(finalAttackerBalance).to.equal(initialAttackerBalance + attackValue);
  
      // The contract balance should only decrease by the amount of one transaction
      expect(finalContractBalance).to.equal(initialContractBalance - attackValue);
    });
  
    it("Should emit TokensPurchased event only once per attack attempt", async function () {
      const attackValue = ethers.parseEther("1");
  
      await expect(attackContract.attack({ value: attackValue }))
        .to.emit(cynthiaTokenSale, "TokensPurchased")
        .withArgs(await attackContract.getAddress(), attackValue);
  
      // Check that the event is emitted only once
      const receipt = await ethers.provider.getTransactionReceipt((await attackContract.attack({ value: attackValue })).hash);
      const events = await cynthiaTokenSale.queryFilter(cynthiaTokenSale.filters.TokensPurchased(), receipt.blockNumber, receipt.blockNumber);
      expect(events.length).to.equal(1);
    });
  
    it("Should not deplete more tokens than expected in an attack", async function () {
      const initialSaleBalance = await cynthiaTokenSale.getContractTokenBalance();
      const attackValue = ethers.parseEther("5"); // Trying to buy 5 tokens
      const expectedPurchase = ethers.parseEther("1"); // But should only get 1 token per transaction
    
      await attackContract.attack({ value: attackValue });
    
      const finalSaleBalance = await cynthiaTokenSale.getContractTokenBalance();
      expect(initialSaleBalance - finalSaleBalance).to.equal(expectedPurchase);
    
      // Verify the attacker's token balance
      const attackerBalance = await cynthiaToken.balanceOf(await attackContract.getAddress());
      expect(attackerBalance).to.equal(expectedPurchase);
    });
  });
});

