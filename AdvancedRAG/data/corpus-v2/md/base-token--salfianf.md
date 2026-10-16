# base-token--salfianf

- domain: fungible-tokens (erc20-token)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/SalfianF/hello-base-contract @ d42d584de651cf5ea8b6d21853e5e091b90b6223
- license: MIT
- targets: BaseToken.sol
- validation: 13 passing tests, 0 failing; statement coverage BaseToken.sol 100.0 %

## Contract: BaseToken.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title BaseToken
 * @notice ERC20 token with mint capabilities and pausable transfers
 * @dev Built for Base network with Ownable access control and Pausable for emergency stops
 */
contract BaseToken is ERC20, Ownable, Pausable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10 ** 18;

    event Minted(address indexed to, uint256 amount);

    /**
     * @notice Deploy the token with a name and symbol
     * @param _name Full token name
     * @param _symbol Token ticker symbol
     * @dev Mints 100M initial supply to the deployer
     */
    constructor(
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        _mint(msg.sender, 100_000_000 * 10 ** 18);
    }

    /**
     * @notice Mint new tokens
     * @dev Only callable by owner, respects MAX_SUPPLY cap
     * @param to Recipient address
     * @param amount Amount of tokens to mint (in wei)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "BaseToken: max supply exceeded");
        _mint(to, amount);
        emit Minted(to, amount);
    }

    /**
     * @notice Pause all token transfers
     * @dev Only callable by owner, emergency use
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause token transfers
     * @dev Only callable by owner
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Hook that ensures transfers respect pause state
     * @dev Overrides ERC20 _update with Pausable check
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override whenNotPaused {
        super._update(from, to, value);
    }
}
```

## Tests: test_base_token.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BaseToken", function () {
  let token, owner, addr1, addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    const BaseToken = await ethers.getContractFactory("BaseToken");
    token = await BaseToken.deploy("BaseToken", "BTK");
    await token.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set correct name and symbol", async function () {
      expect(await token.name()).to.equal("BaseToken");
      expect(await token.symbol()).to.equal("BTK");
    });

    it("Should mint 100M initial supply to deployer", async function () {
      const initial = ethers.parseEther("100000000");
      expect(await token.totalSupply()).to.equal(initial);
      expect(await token.balanceOf(owner.address)).to.equal(initial);
    });

    it("Should set owner correctly", async function () {
      expect(await token.owner()).to.equal(owner.address);
    });
  });

  describe("Minting", function () {
    it("Should allow owner to mint tokens", async function () {
      await token.mint(addr1.address, ethers.parseEther("1000"));
      expect(await token.balanceOf(addr1.address)).to.equal(ethers.parseEther("1000"));
    });

    it("Should reject mint from non-owner", async function () {
      await expect(
        token.connect(addr1).mint(addr1.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("Should enforce MAX_SUPPLY cap", async function () {
      const max = ethers.parseEther("1000000000");
      const current = await token.totalSupply();
      const overflow = max - current + 1n;
      await expect(
        token.mint(addr1.address, overflow)
      ).to.be.revertedWith("BaseToken: max supply exceeded");
    });
  });

  describe("Pausable", function () {
    it("Should allow owner to pause", async function () {
      await token.pause();
      expect(await token.paused()).to.equal(true);
    });

    it("Should block transfers when paused", async function () {
      await token.pause();
      await expect(
        token.transfer(addr1.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    it("Should allow owner to unpause", async function () {
      await token.pause();
      await token.unpause();
      expect(await token.paused()).to.equal(false);
    });

    it("Should allow transfers after unpause", async function () {
      await token.pause();
      await token.unpause();
      await token.transfer(addr1.address, ethers.parseEther("100"));
      expect(await token.balanceOf(addr1.address)).to.equal(ethers.parseEther("100"));
    });

    it("Should reject pause from non-owner", async function () {
      await expect(
        token.connect(addr1).pause()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

  describe("Transfers", function () {
    beforeEach(async function () {
      await token.transfer(addr1.address, ethers.parseEther("1000"));
    });

    it("Should transfer tokens between accounts", async function () {
      await token.connect(addr1).transfer(addr2.address, ethers.parseEther("500"));
      expect(await token.balanceOf(addr1.address)).to.equal(ethers.parseEther("500"));
      expect(await token.balanceOf(addr2.address)).to.equal(ethers.parseEther("500"));
    });

    it("Should reject transfer exceeding balance", async function () {
      await expect(
        token.connect(addr1).transfer(addr2.address, ethers.parseEther("2000"))
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });
  });
});
```
