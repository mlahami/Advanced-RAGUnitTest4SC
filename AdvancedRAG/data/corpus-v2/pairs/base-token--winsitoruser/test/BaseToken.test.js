const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BaseToken", function () {
  let token;
  let owner;
  let addr1;
  let addr2;
  
  const TOKEN_NAME = "Test Token";
  const TOKEN_SYMBOL = "TEST";
  const INITIAL_SUPPLY = 1000000;
  const DECIMALS = 18;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    
    const BaseToken = await ethers.getContractFactory("BaseToken");
    token = await BaseToken.deploy(TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY, DECIMALS);
    await token.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right token name and symbol", async function () {
      expect(await token.name()).to.equal(TOKEN_NAME);
      expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
    });

    it("Should set the right decimals", async function () {
      expect(await token.decimals()).to.equal(DECIMALS);
    });

    it("Should assign the total supply to the owner", async function () {
      const ownerBalance = await token.balanceOf(owner.address);
      const totalSupply = await token.totalSupply();
      expect(ownerBalance).to.equal(totalSupply);
      expect(ownerBalance).to.equal(ethers.parseUnits(INITIAL_SUPPLY.toString(), DECIMALS));
    });

    it("Should set the right owner", async function () {
      expect(await token.owner()).to.equal(owner.address);
    });
  });

  describe("Transactions", function () {
    it("Should transfer tokens between accounts", async function () {
      const transferAmount = ethers.parseUnits("50", DECIMALS);
      
      await token.transfer(addr1.address, transferAmount);
      expect(await token.balanceOf(addr1.address)).to.equal(transferAmount);

      await token.connect(addr1).transfer(addr2.address, transferAmount);
      expect(await token.balanceOf(addr2.address)).to.equal(transferAmount);
      expect(await token.balanceOf(addr1.address)).to.equal(0);
    });

    it("Should fail if sender doesn't have enough tokens", async function () {
      const initialOwnerBalance = await token.balanceOf(owner.address);
      
      await expect(
        token.connect(addr1).transfer(owner.address, ethers.parseUnits("1", DECIMALS))
      ).to.be.reverted;

      expect(await token.balanceOf(owner.address)).to.equal(initialOwnerBalance);
    });

    it("Should update balances after transfers", async function () {
      const initialOwnerBalance = await token.balanceOf(owner.address);
      const transferAmount = ethers.parseUnits("100", DECIMALS);

      await token.transfer(addr1.address, transferAmount);
      await token.transfer(addr2.address, transferAmount);

      const finalOwnerBalance = await token.balanceOf(owner.address);
      expect(finalOwnerBalance).to.equal(initialOwnerBalance - (transferAmount * 2n));

      expect(await token.balanceOf(addr1.address)).to.equal(transferAmount);
      expect(await token.balanceOf(addr2.address)).to.equal(transferAmount);
    });
  });

  describe("Minting", function () {
    it("Should allow owner to mint tokens", async function () {
      const mintAmount = ethers.parseUnits("1000", DECIMALS);
      const initialBalance = await token.balanceOf(addr1.address);

      await token.mint(addr1.address, mintAmount);
      
      expect(await token.balanceOf(addr1.address)).to.equal(initialBalance + mintAmount);
    });

    it("Should not allow non-owner to mint tokens", async function () {
      const mintAmount = ethers.parseUnits("1000", DECIMALS);
      
      await expect(
        token.connect(addr1).mint(addr2.address, mintAmount)
      ).to.be.reverted;
    });
  });

  describe("Burning", function () {
    it("Should allow token holders to burn their tokens", async function () {
      const transferAmount = ethers.parseUnits("1000", DECIMALS);
      const burnAmount = ethers.parseUnits("500", DECIMALS);

      await token.transfer(addr1.address, transferAmount);
      const initialTotalSupply = await token.totalSupply();

      await token.connect(addr1).burn(burnAmount);

      expect(await token.balanceOf(addr1.address)).to.equal(transferAmount - burnAmount);
      expect(await token.totalSupply()).to.equal(initialTotalSupply - burnAmount);
    });

    it("Should fail if user tries to burn more than they have", async function () {
      const transferAmount = ethers.parseUnits("100", DECIMALS);
      await token.transfer(addr1.address, transferAmount);

      await expect(
        token.connect(addr1).burn(ethers.parseUnits("200", DECIMALS))
      ).to.be.reverted;
    });
  });

  describe("Batch Transfer", function () {
    it("Should transfer tokens to multiple addresses", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [
        ethers.parseUnits("100", DECIMALS),
        ethers.parseUnits("200", DECIMALS)
      ];

      await token.batchTransfer(recipients, amounts);

      expect(await token.balanceOf(addr1.address)).to.equal(amounts[0]);
      expect(await token.balanceOf(addr2.address)).to.equal(amounts[1]);
    });

    it("Should fail if arrays length mismatch", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseUnits("100", DECIMALS)];

      await expect(
        token.batchTransfer(recipients, amounts)
      ).to.be.revertedWith("Arrays length mismatch");
    });

    it("Should fail if arrays are empty", async function () {
      await expect(
        token.batchTransfer([], [])
      ).to.be.revertedWith("Empty arrays");
    });
  });

  describe("ERC20Permit", function () {
    it("Should have correct domain separator", async function () {
      const domain = await token.DOMAIN_SEPARATOR();
      expect(domain).to.be.properHex(64); // 32 bytes = 64 hex chars (without 0x prefix)
    });
  });
});
