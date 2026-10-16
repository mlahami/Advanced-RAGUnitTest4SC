# cynthia-token--cynthiasystems

- domain: fungible-tokens (fungible-token)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/cynthiasystems/CynthiaToken @ 0f5e7572cea7599da027b909999d78c0c96a9dd7
- license: MIT
- targets: CynthiaToken.sol
- validation: 18 passing tests, 0 failing; statement coverage CynthiaToken.sol 100.0 %

## Contract: CynthiaToken.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CynthiaToken
 * @dev Implementation of the Cynthia token ($CYNTHIA) with a fixed supply model.
 *
 * This contract creates an ERC20 token with a predetermined, immutable supply.
 * Once deployed, the total number of tokens remains constant, promoting
 * scarcity and potentially long-term value appreciation.
 *
 * Tokenomics:
 * - Fixed Total Supply: 100 million $CYNTHIA tokens
 * - No Minting: After initial minting, no new tokens can be created
 * - No Burning: The contract does not implement token burning, maintaining the fixed supply
 *
 * Benefits of this simplified, fixed-supply approach:
 * 1. Predictability: Users and investors can rely on a constant token supply.
 * 2. Scarcity: A capped supply can drive value through limited availability.
 * 3. Simplicity: Easy to understand tokenomics with no complex inflation or deflation mechanisms.
 * 4. Security: Reduced attack surface due to minimal functionality.
 * 5. Gas Efficiency: Simple operations lead to lower gas costs for transfers.
 * 6. Transparency: The monetary policy is clear and immutable.
 * 7. Fairness: All tokens are minted at deployment, ensuring a fair initial distribution.
 *
 * Use Cases:
 * This token is designed for straightforward value transfer and storage within the
 * Cynthia Systems ecosystem, particularly suited for stable, long-term token economics.
 */

/// @custom:security-contact cynthia@cynthiasystems.com
contract CynthiaToken is ERC20, Ownable {
    /**
     * @dev Sets the total supply of tokens.
     * The value is set to 100 million tokens, with 18 decimal places for division.
     * This ensures a large enough supply for wide distribution and precise transactions.
     */
    uint256 public constant TOTAL_SUPPLY = 100_000_000 * 10**18; // 100 million tokens with 18 decimals

    /**
     * @dev Creates `TOTAL_SUPPLY` tokens and assigns them to `initialOwner`.
     * This sets up the initial distribution of tokens.
     *
     * @param initialOwner The address that will receive the total initial supply.
     */
    constructor(address initialOwner)
        ERC20("CynthiaToken", "CYNTHIA")
        Ownable(initialOwner)
    {
        _mint(initialOwner, TOTAL_SUPPLY);
    }

    // Note: The absence of additional functions like mint() or burn() 
    // reinforces the fixed supply nature of this token.
}
```

## Tests: CynthiaToken.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CynthiaToken", function () {
  let CynthiaToken;
  let cynthiaToken;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    CynthiaToken = await ethers.getContractFactory("CynthiaToken");
    [owner, addr1, addr2] = await ethers.getSigners();
    cynthiaToken = await CynthiaToken.deploy(owner.address);
    await cynthiaToken.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should have the correct name and symbol", async function () {
        expect(await cynthiaToken.name()).to.equal("CynthiaToken");
        expect(await cynthiaToken.symbol()).to.equal("CYNTHIA");
      });

    it("Should have the correct total supply", async function () {
        const expectedSupply = ethers.parseEther("100000000"); // 100 million with 18 decimals
        expect(await cynthiaToken.TOTAL_SUPPLY()).to.equal(expectedSupply);
    });
    
    it("Should set the right owner", async function () {
      expect(await cynthiaToken.owner()).to.equal(owner.address);
    });

    it("Should assign the total supply of tokens to the owner", async function () {
      const ownerBalance = await cynthiaToken.balanceOf(owner.address);
      const totalSupply = await cynthiaToken.TOTAL_SUPPLY();
      expect(ownerBalance).to.equal(totalSupply);
    });
  });

  describe("Transactions", function () {
    it("Should allow for approved transfers", async function () {
        await cynthiaToken.approve(addr1.address, ethers.parseEther("1000"));
        await cynthiaToken.connect(addr1).transferFrom(owner.address, addr2.address, ethers.parseEther("1000"));
        expect(await cynthiaToken.balanceOf(addr2.address)).to.equal(ethers.parseEther("1000"));
    });

    it("Should emit Transfer event on transfer", async function () {
        await expect(cynthiaToken.transfer(addr1.address, ethers.parseEther("1000")))
          .to.emit(cynthiaToken, "Transfer")
          .withArgs(owner.address, addr1.address, ethers.parseEther("1000"));
    });
    
    it("Should transfer tokens between accounts", async function () {
      // Transfer 1000 tokens from owner to addr1
      await cynthiaToken.transfer(addr1.address, ethers.parseEther("1000"));
      expect(await cynthiaToken.balanceOf(addr1.address)).to.equal(ethers.parseEther("1000"));

      // Transfer 500 tokens from addr1 to addr2
      await cynthiaToken.connect(addr1).transfer(addr2.address, ethers.parseEther("500"));
      expect(await cynthiaToken.balanceOf(addr2.address)).to.equal(ethers.parseEther("500"));
    });

    it("Should fail if sender doesn't have enough tokens", async function () {
      const initialOwnerBalance = await cynthiaToken.balanceOf(owner.address);
      await expect(
        cynthiaToken.connect(addr1).transfer(owner.address, 1)
      ).to.be.revertedWithCustomError(cynthiaToken, "ERC20InsufficientBalance");
      expect(await cynthiaToken.balanceOf(owner.address)).to.equal(initialOwnerBalance);
    });
  });

  describe("Approval and TransferFrom", function () {
    it("Should approve and then transfer from another account", async function () {
      await cynthiaToken.approve(addr1.address, ethers.parseEther("100"));
      await cynthiaToken.connect(addr1).transferFrom(owner.address, addr2.address, ethers.parseEther("100"));
      expect(await cynthiaToken.balanceOf(addr2.address)).to.equal(ethers.parseEther("100"));
    });

    it("Should fail if trying to transfer more than approved amount", async function () {
      await cynthiaToken.approve(addr1.address, ethers.parseEther("99"));
      await expect(
        cynthiaToken.connect(addr1).transferFrom(owner.address, addr2.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(cynthiaToken, "ERC20InsufficientAllowance");
    });

    it("Should update allowance after transferFrom", async function () {
      await cynthiaToken.approve(addr1.address, ethers.parseEther("100"));
      await cynthiaToken.connect(addr1).transferFrom(owner.address, addr2.address, ethers.parseEther("50"));
      expect(await cynthiaToken.allowance(owner.address, addr1.address)).to.equal(ethers.parseEther("50"));
    });
  });

  describe("Ownership", function () {
    it("Should transfer ownership", async function () {
      await cynthiaToken.transferOwnership(addr1.address);
      expect(await cynthiaToken.owner()).to.equal(addr1.address);
    });

    it("Should not allow non-owners to transfer ownership", async function () {
      await expect(
        cynthiaToken.connect(addr1).transferOwnership(addr2.address)
      ).to.be.revertedWithCustomError(cynthiaToken, "OwnableUnauthorizedAccount");
    });

    it("Should allow new owner to transfer ownership", async function () {
      await cynthiaToken.transferOwnership(addr1.address);
      await cynthiaToken.connect(addr1).transferOwnership(addr2.address);
      expect(await cynthiaToken.owner()).to.equal(addr2.address);
    });
  });

  describe("Edge Cases", function () {
    it("Should allow transferring 0 tokens", async function () {
      await expect(cynthiaToken.transfer(addr1.address, 0))
        .to.emit(cynthiaToken, "Transfer")
        .withArgs(owner.address, addr1.address, 0);
      expect(await cynthiaToken.balanceOf(addr1.address)).to.equal(0);
    });

    it("Should fail when transferring to the zero address", async function () {
      await expect(
        cynthiaToken.transfer(ethers.ZeroAddress, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(cynthiaToken, "ERC20InvalidReceiver");
    });

    it("Should fail when transferring from the zero address", async function () {
      // This test is a bit tricky to set up directly, so we'll test it indirectly
      // by trying to transferFrom the zero address
      await expect(
        cynthiaToken.transferFrom(ethers.ZeroAddress, addr1.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(cynthiaToken, "ERC20InsufficientAllowance");
    });

    it("Should fail when approving the zero address", async function () {
      await expect(
        cynthiaToken.approve(ethers.ZeroAddress, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(cynthiaToken, "ERC20InvalidSpender");
    });
  });
});
```
