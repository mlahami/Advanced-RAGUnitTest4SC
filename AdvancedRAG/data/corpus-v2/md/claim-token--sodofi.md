# claim-token--sodofi

- domain: airdrop-merkle (airdrop)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/sodofi/celo-token-claim @ b14c34d03cfdedbff668b139b6554715e105cd4c
- license: MIT
- targets: ClaimToken.sol
- validation: 14 passing tests, 0 failing; statement coverage ClaimToken.sol 100.0 %

## Contract: ClaimToken.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ClaimToken
 * @dev ERC-20 token that allows users to claim 10 tokens once per address
 */
contract ClaimToken is ERC20, Ownable, ReentrancyGuard {
    // Fixed claim amount - 10 tokens
    uint256 public constant CLAIM_AMOUNT = 10 * 10**18; // 10 tokens
    
    // Maximum total supply
    uint256 public constant MAX_TOTAL_SUPPLY = 1000000 * 10**18; // 1M tokens
    
    // Mapping to track if an address has already claimed
    mapping(address => bool) public hasClaimed;
    
    // Events
    event TokensClaimed(address indexed claimer, uint256 amount);
    
    constructor(
        string memory name,
        string memory symbol,
        address initialOwner
    ) ERC20(name, symbol) Ownable(initialOwner) {
        // Mint initial supply to owner
        _mint(initialOwner, 10000 * 10**18); // 10,000 tokens to owner
    }
    
    /**
     * @dev Allows users to claim 10 tokens (once per address)
     */
    function claimTokens() external nonReentrant {
        require(!hasClaimed[msg.sender], "Address has already claimed tokens");
        require(
            totalSupply() + CLAIM_AMOUNT <= MAX_TOTAL_SUPPLY,
            "Would exceed maximum total supply"
        );
        
        // Mark address as having claimed
        hasClaimed[msg.sender] = true;
        
        // Mint tokens to claimer
        _mint(msg.sender, CLAIM_AMOUNT);
        
        emit TokensClaimed(msg.sender, CLAIM_AMOUNT);
    }
    
    /**
     * @dev Check if an address can claim tokens
     * @param claimer The address to check
     * @return canClaim Whether the address can claim
     */
    function canClaimTokens(address claimer) external view returns (bool canClaim) {
        return !hasClaimed[claimer];
    }
    
    /**
     * @dev Get the claim amount
     * @return The claim amount (always 10 tokens)
     */
    function getClaimAmount() external pure returns (uint256) {
        return CLAIM_AMOUNT;
    }
    
    /**
     * @dev Owner can mint additional tokens (for airdrops, etc.)
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint
     */
    function ownerMint(address to, uint256 amount) external onlyOwner {
        require(
            totalSupply() + amount <= MAX_TOTAL_SUPPLY,
            "Would exceed maximum total supply"
        );
        _mint(to, amount);
    }
    
    /**
     * @dev Get remaining supply that can be minted
     * @return The remaining mintable supply
     */
    function getRemainingSupply() external view returns (uint256) {
        return MAX_TOTAL_SUPPLY - totalSupply();
    }
}
```

## Tests: ClaimToken.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClaimToken", function () {
  let claimToken;
  let owner;
  let user1;
  let user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const ClaimTokenFactory = await ethers.getContractFactory("ClaimToken");
    claimToken = await ClaimTokenFactory.deploy("ClaimToken", "CLAIM", owner.address);
    await claimToken.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await claimToken.owner()).to.equal(owner.address);
    });

    it("Should assign the initial supply to the owner", async function () {
      const ownerBalance = await claimToken.balanceOf(owner.address);
      expect(ownerBalance).to.equal(ethers.parseEther("10000"));
    });

    it("Should set the correct token details", async function () {
      expect(await claimToken.name()).to.equal("ClaimToken");
      expect(await claimToken.symbol()).to.equal("CLAIM");
      expect(await claimToken.decimals()).to.equal(18);
    });
  });

  describe("Token Claiming", function () {
    it("Should allow users to claim 10 tokens", async function () {
      const claimAmount = ethers.parseEther("10");

      await expect(claimToken.connect(user1).claimTokens())
        .to.emit(claimToken, "TokensClaimed")
        .withArgs(user1.address, claimAmount);

      const balance = await claimToken.balanceOf(user1.address);
      expect(balance).to.equal(claimAmount);
    });

    it("Should not allow the same address to claim twice", async function () {
      // First claim should succeed
      await claimToken.connect(user1).claimTokens();

      // Second claim should fail
      await expect(claimToken.connect(user1).claimTokens())
        .to.be.revertedWith("Address has already claimed tokens");
    });

    it("Should allow different addresses to claim", async function () {
      const claimAmount = ethers.parseEther("10");

      // User1 claims
      await claimToken.connect(user1).claimTokens();
      expect(await claimToken.balanceOf(user1.address)).to.equal(claimAmount);

      // User2 claims
      await claimToken.connect(user2).claimTokens();
      expect(await claimToken.balanceOf(user2.address)).to.equal(claimAmount);
    });

    it("Should not exceed maximum total supply", async function () {
      const maxSupply = await claimToken.MAX_TOTAL_SUPPLY();
      const currentSupply = await claimToken.totalSupply();
      const remainingSupply = maxSupply - currentSupply;

      // Mint tokens to get close to the max supply, leaving less than 10 tokens
      const mintAmount = remainingSupply - ethers.parseEther("5"); // Leave only 5 tokens remaining
      await claimToken.connect(owner).ownerMint(user1.address, mintAmount);

      // Now try to claim 10 tokens when only 5 are available
      await expect(claimToken.connect(user2).claimTokens())
        .to.be.revertedWith("Would exceed maximum total supply");
    });
  });

  describe("Claim Status Checking", function () {
    it("Should correctly report if user can claim tokens", async function () {
      const canClaim = await claimToken.canClaimTokens(user1.address);
      expect(canClaim).to.be.true;
    });

    it("Should correctly report that user cannot claim after claiming", async function () {
      await claimToken.connect(user1).claimTokens();

      const canClaim = await claimToken.canClaimTokens(user1.address);
      expect(canClaim).to.be.false;
    });

    it("Should track claimed status correctly", async function () {
      expect(await claimToken.hasClaimed(user1.address)).to.be.false;

      await claimToken.connect(user1).claimTokens();

      expect(await claimToken.hasClaimed(user1.address)).to.be.true;
    });
  });

  describe("Owner Functions", function () {
    it("Should allow owner to mint additional tokens", async function () {
      const mintAmount = ethers.parseEther("5000");

      await expect(claimToken.connect(owner).ownerMint(user1.address, mintAmount))
        .to.emit(claimToken, "Transfer")
        .withArgs(ethers.ZeroAddress, user1.address, mintAmount);

      const balance = await claimToken.balanceOf(user1.address);
      expect(balance).to.equal(mintAmount);
    });

    it("Should not allow non-owner to mint tokens", async function () {
      const mintAmount = ethers.parseEther("5000");

      await expect(claimToken.connect(user1).ownerMint(user2.address, mintAmount))
        .to.be.revertedWithCustomError(claimToken, "OwnableUnauthorizedAccount");
    });
  });

  describe("Supply Information", function () {
    it("Should correctly report remaining supply", async function () {
      const maxSupply = await claimToken.MAX_TOTAL_SUPPLY();
      const currentSupply = await claimToken.totalSupply();
      const expectedRemaining = maxSupply - currentSupply;

      const remainingSupply = await claimToken.getRemainingSupply();
      expect(remainingSupply).to.equal(expectedRemaining);
    });

    it("Should return correct claim amount", async function () {
      const claimAmount = await claimToken.getClaimAmount();
      expect(claimAmount).to.equal(ethers.parseEther("10"));
    });
  });
});
```
