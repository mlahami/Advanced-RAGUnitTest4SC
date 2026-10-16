# orion-token--girishktas

- domain: fungible-tokens (erc20-token)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Girishktas/OrionDAO @ c5bd134c8311981e4372083e368cf16160e3a3ce
- license: MIT
- targets: OrionToken.sol
- validation: 13 passing tests, 0 failing; statement coverage OrionToken.sol 100.0 %

## Contract: OrionToken.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title OrionToken
 * @dev ERC20 token used for voting in OrionDAO
 * @notice ORION token with minting and burning capabilities
 */
contract OrionToken is ERC20, ERC20Burnable, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10**18; // 1 billion tokens
    uint256 public constant INITIAL_SUPPLY = 100_000_000 * 10**18; // 100 million initial

    constructor() ERC20("Orion DAO Token", "ORION") Ownable(msg.sender) {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    /**
     * @dev Mints new tokens (only owner)
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "OrionToken: max supply exceeded");
        _mint(to, amount);
    }

    /**
     * @dev Distributes tokens to multiple addresses
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts to distribute
     */
    function batchTransfer(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        require(recipients.length == amounts.length, "OrionToken: array length mismatch");
        
        for (uint256 i = 0; i < recipients.length; i++) {
            transfer(recipients[i], amounts[i]);
        }
    }
}
```

## Tests: OrionToken.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OrionToken", function () {
  let orionToken;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const OrionToken = await ethers.getContractFactory("OrionToken");
    orionToken = await OrionToken.deploy();
    await orionToken.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should have correct name and symbol", async function () {
      expect(await orionToken.name()).to.equal("Orion DAO Token");
      expect(await orionToken.symbol()).to.equal("ORION");
    });

    it("Should mint initial supply to owner", async function () {
      const initialSupply = ethers.parseEther("100000000"); // 100M
      expect(await orionToken.balanceOf(owner.address)).to.equal(initialSupply);
    });

    it("Should have correct total supply", async function () {
      const initialSupply = ethers.parseEther("100000000");
      expect(await orionToken.totalSupply()).to.equal(initialSupply);
    });

    it("Should set correct max supply", async function () {
      expect(await orionToken.MAX_SUPPLY()).to.equal(ethers.parseEther("1000000000"));
    });
  });

  describe("Minting", function () {
    it("Should allow owner to mint", async function () {
      const mintAmount = ethers.parseEther("1000");
      await orionToken.mint(addr1.address, mintAmount);
      expect(await orionToken.balanceOf(addr1.address)).to.equal(mintAmount);
    });

    it("Should not exceed max supply", async function () {
      const excessAmount = ethers.parseEther("1000000000"); // Would exceed max
      await expect(
        orionToken.mint(addr1.address, excessAmount)
      ).to.be.revertedWith("OrionToken: max supply exceeded");
    });

    it("Should not allow non-owner to mint", async function () {
      await expect(
        orionToken.connect(addr1).mint(addr2.address, ethers.parseEther("1000"))
      ).to.be.reverted;
    });
  });

  describe("Transfers", function () {
    beforeEach(async function () {
      await orionToken.transfer(addr1.address, ethers.parseEther("1000"));
    });

    it("Should transfer tokens", async function () {
      await orionToken.connect(addr1).transfer(addr2.address, ethers.parseEther("100"));
      expect(await orionToken.balanceOf(addr2.address)).to.equal(ethers.parseEther("100"));
    });

    it("Should fail with insufficient balance", async function () {
      await expect(
        orionToken.connect(addr1).transfer(addr2.address, ethers.parseEther("2000"))
      ).to.be.reverted;
    });
  });

  describe("Batch Transfer", function () {
    it("Should batch transfer to multiple addresses", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("100"), ethers.parseEther("200")];

      await orionToken.batchTransfer(recipients, amounts);

      expect(await orionToken.balanceOf(addr1.address)).to.equal(ethers.parseEther("100"));
      expect(await orionToken.balanceOf(addr2.address)).to.equal(ethers.parseEther("200"));
    });

    it("Should fail with array length mismatch", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("100")];

      await expect(
        orionToken.batchTransfer(recipients, amounts)
      ).to.be.revertedWith("OrionToken: array length mismatch");
    });
  });

  describe("Burning", function () {
    beforeEach(async function () {
      await orionToken.transfer(addr1.address, ethers.parseEther("1000"));
    });

    it("Should allow burning own tokens", async function () {
      const burnAmount = ethers.parseEther("100");
      const balanceBefore = await orionToken.balanceOf(addr1.address);

      await orionToken.connect(addr1).burn(burnAmount);

      const balanceAfter = await orionToken.balanceOf(addr1.address);
      expect(balanceBefore - balanceAfter).to.equal(burnAmount);
    });

    it("Should decrease total supply on burn", async function () {
      const burnAmount = ethers.parseEther("100");
      const supplyBefore = await orionToken.totalSupply();

      await orionToken.connect(addr1).burn(burnAmount);

      const supplyAfter = await orionToken.totalSupply();
      expect(supplyBefore - supplyAfter).to.equal(burnAmount);
    });
  });
});
```
