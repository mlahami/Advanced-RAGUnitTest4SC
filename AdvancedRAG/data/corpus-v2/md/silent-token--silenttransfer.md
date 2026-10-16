# silent-token--silenttransfer

- domain: fungible-tokens (erc20-token)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/SilentTransfer/silenttransfer @ ba05f19fa41d85d37b65bd32877a2b9c297d55ab
- license: MIT
- targets: SilentToken.sol
- validation: 6 passing tests, 0 failing; statement coverage SilentToken.sol 73.33 %

## Contract: SilentToken.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Silent Token (SILENT)
/// @notice Product ERC-20 for SilentTransfer. Hard-capped at 1,000,000,000 tokens.
/// @dev No KYC / transfer whitelist. No mint above MAX_SUPPLY (1B whole tokens).
contract SilentToken is ERC20, Ownable {
    /// @notice Maximum total supply in whole tokens (1 billion). Scaled by decimals() in storage.
    uint256 public constant MAX_SUPPLY_WHOLE = 1_000_000_000;

    uint8 private immutable _decimals;
    uint256 public immutable maxSupply;

    error ZeroAddress();
    error ZeroAmount();
    error CapExceeded(uint256 attempted, uint256 maxSupply_);
    error InitialMintExceedsCap();

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address initialOwner,
        uint256 initialMint
    ) ERC20(name_, symbol_) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        _decimals = decimals_;
        maxSupply = MAX_SUPPLY_WHOLE * (10 ** uint256(decimals_));

        if (initialMint > maxSupply) revert InitialMintExceedsCap();
        if (initialMint > 0) {
            _mint(initialOwner, initialMint);
        }
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /// @notice Remaining mintable amount (0 when fully capped).
    function remainingMintable() public view returns (uint256) {
        return maxSupply - totalSupply();
    }

    /// @notice Owner mint — reverts if it would exceed the 1B hard cap.
    /// @dev When totalSupply == maxSupply, no further mint is possible.
    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 next = totalSupply() + amount;
        if (next > maxSupply) revert CapExceeded(next, maxSupply);
        _mint(to, amount);
    }

    /// @notice Owner faucet — same hard cap as mint.
    function faucet(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        uint256 next = totalSupply() + amount;
        if (next > maxSupply) revert CapExceeded(next, maxSupply);
        _mint(msg.sender, amount);
    }
}
```

## Tests: SilentToken.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SilentToken (SILENT)", function () {
  const ONE_B = ethers.parseEther("1000000000"); // 1B with 18 decimals

  async function deploy(initial) {
    const [owner, alice, bob] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("SilentToken");
    const token = await Token.deploy(
      "Silent",
      "SILENT",
      18,
      owner.address,
      initial
    );
    await token.waitForDeployment();
    return { token, owner, alice, bob };
  }

  it("mints initial supply to owner with 18 decimals and 1B cap", async function () {
    const initial = ethers.parseEther("1000000");
    const { token, owner } = await deploy(initial);
    expect(await token.symbol()).to.equal("SILENT");
    expect(await token.name()).to.equal("Silent");
    expect(await token.decimals()).to.equal(18);
    expect(await token.balanceOf(owner.address)).to.equal(initial);
    expect(await token.maxSupply()).to.equal(ONE_B);
    expect(await token.MAX_SUPPLY_WHOLE()).to.equal(1_000_000_000n);
  });

  it("transfers freely with no whitelist / KYC", async function () {
    const { token, alice, bob } = await deploy(ethers.parseEther("1000"));
    await (await token.transfer(alice.address, ethers.parseEther("100"))).wait();
    await (
      await token.connect(alice).transfer(bob.address, ethers.parseEther("40"))
    ).wait();
    expect(await token.balanceOf(bob.address)).to.equal(ethers.parseEther("40"));
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("60"));
  });

  it("only owner can mint", async function () {
    const { token, alice } = await deploy(ethers.parseEther("1000"));
    await expect(
      token.connect(alice).mint(alice.address, ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
  });

  it("owner can mint only up to hard cap", async function () {
    const { token, alice } = await deploy(ethers.parseEther("1000"));
    await (await token.mint(alice.address, ethers.parseEther("50"))).wait();
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("50"));
  });

  it("rejects mint that exceeds 1B hard cap", async function () {
    const { token, alice } = await deploy(ONE_B);
    expect(await token.totalSupply()).to.equal(ONE_B);
    expect(await token.remainingMintable()).to.equal(0n);
    await expect(
      token.mint(alice.address, 1n)
    ).to.be.revertedWithCustomError(token, "CapExceeded");
  });

  it("rejects constructor initial mint above cap", async function () {
    const [owner] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("SilentToken");
    await expect(
      Token.deploy("Silent", "SILENT", 18, owner.address, ONE_B + 1n)
    ).to.be.revertedWithCustomError(Token, "InitialMintExceedsCap");
  });
});
```
