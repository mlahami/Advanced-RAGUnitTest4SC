# my-token--stephen-dev92

- domain: fungible-tokens (erc20-token)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/stephen-dev92/solidity-fundamentals @ ee3cdd0b1fc22143bb38e4902ad8267fc6684ddd
- license: MIT
- targets: MyToken.sol
- validation: 5 passing tests, 0 failing; statement coverage MyToken.sol 100.0 %

## Contract: MyToken.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MyToken
/// @notice A simple ERC-20 token with mint (owner-only) and burn (anyone, their own balance).
/// @dev Built on OpenZeppelin's audited ERC20 and Ownable implementations rather than
///      writing the token logic from scratch — this is the standard, professional approach.
contract MyToken is ERC20, Ownable {
    /// @param initialSupply Number of whole tokens minted to the deployer at launch (18 decimals applied automatically).
    constructor(uint256 initialSupply)
        ERC20("MyToken", "MTK")
        Ownable(msg.sender)
    {
        _mint(msg.sender, initialSupply * 10 ** decimals());
    }

    /// @notice Create new tokens. Only the contract owner can call this.
    /// @param to Address to receive the new tokens.
    /// @param amount Number of whole tokens to mint (18 decimals applied automatically).
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount * 10 ** decimals());
    }

    /// @notice Destroy tokens from your own balance, reducing total supply.
    /// @param amount Number of whole tokens to burn (18 decimals applied automatically).
    function burn(uint256 amount) external {
        _burn(msg.sender, amount * 10 ** decimals());
    }
}
```

## Tests: MyToken.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MyToken", function () {
  let token, owner, alice, bob;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    const MyToken = await ethers.getContractFactory("MyToken");
    token = await MyToken.deploy(1000); // 1000 whole tokens minted to owner at deploy
  });

  it("mints the initial supply to the deployer", async function () {
    expect(await token.balanceOf(owner.address)).to.equal(
      ethers.parseUnits("1000", 18)
    );
  });

  it("lets the owner mint new tokens", async function () {
    await token.mint(alice.address, 50);
    expect(await token.balanceOf(alice.address)).to.equal(
      ethers.parseUnits("50", 18)
    );
  });

  it("blocks non-owners from minting", async function () {
    await expect(
      token.connect(alice).mint(alice.address, 50)
    ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
  });

  it("lets any holder burn their own tokens", async function () {
    await token.transfer(alice.address, ethers.parseUnits("100", 18));
    await token.connect(alice).burn(40);
    expect(await token.balanceOf(alice.address)).to.equal(
      ethers.parseUnits("60", 18)
    );
  });

  it("supports normal transfers between accounts", async function () {
    await token.transfer(bob.address, ethers.parseUnits("25", 18));
    expect(await token.balanceOf(bob.address)).to.equal(
      ethers.parseUnits("25", 18)
    );
  });
});
```
