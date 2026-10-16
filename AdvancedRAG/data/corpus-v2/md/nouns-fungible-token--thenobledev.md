# nouns-fungible-token--thenobledev

- domain: fungible-tokens (erc20-token)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/TheNobleDev/fractional-nouns @ 2c1acb9608484d286c5005fb187090dd84acac65
- license: MIT
- targets: NounsFungibleToken.sol
- validation: 7 passing tests, 0 failing; statement coverage NounsFungibleToken.sol 100.0 %

## Contract: NounsFungibleToken.sol (primary target)

```solidity
// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';

contract NounsFungibleToken is ERC20, Ownable {
    /**
     * @notice Initializes the NounsFungibleToken contract
     * @param initialOwner The address that will be granted the owner role
     */
    constructor(address initialOwner) ERC20('Nouns Fungible Token', unicode'$⌐◧-◧') Ownable(initialOwner) {}

    /**
     * @notice Mints new tokens to the specified address
     * @dev Only callable by the owner
     * @param to The address that will receive the minted tokens
     * @param amount The amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Burns tokens from the specified address
     * @dev Only callable by the owner
     * @param from The address from which tokens will be burned
     * @param amount The amount of tokens to burn
     */
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
}
```

## Tests: NounsFungibleToken.js

```javascript
const { expect } = require('chai');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

describe('NounsFungibleToken contract', function () {
  async function deployNounsFungibleTokenFixture() {
    const [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

    const NounsFungibleToken = await ethers.getContractFactory('NounsFungibleToken');
    const nounsFungibleToken = await NounsFungibleToken.deploy(owner.address);
    await nounsFungibleToken.waitForDeployment();

    return { nounsFungibleToken, owner, addr1, addr2, addrs };
  }

  describe('Deployment', function () {
    it('Should set the right owner', async function () {
      const { nounsFungibleToken, owner } = await loadFixture(deployNounsFungibleTokenFixture);
      expect(await nounsFungibleToken.owner()).to.equal(owner.address);
    });

    it('Should have correct name and symbol', async function () {
      const { nounsFungibleToken } = await loadFixture(deployNounsFungibleTokenFixture);
      expect(await nounsFungibleToken.name()).to.equal('Nouns Fungible Token');
      expect(await nounsFungibleToken.symbol()).to.equal('$⌐◧-◧');
    });
  });

  describe('Minting', function () {
    it('Should allow owner to mint tokens', async function () {
      const { nounsFungibleToken, owner, addr1 } = await loadFixture(
        deployNounsFungibleTokenFixture,
      );
      await nounsFungibleToken.mint(addr1.address, 100);
      expect(await nounsFungibleToken.balanceOf(addr1.address)).to.equal(100);
    });

    it('Should not allow non-owner to mint tokens', async function () {
      const { nounsFungibleToken, addr1 } = await loadFixture(deployNounsFungibleTokenFixture);
      await expect(nounsFungibleToken.connect(addr1).mint(addr1.address, 100))
        .to.be.revertedWithCustomError(nounsFungibleToken, 'OwnableUnauthorizedAccount')
        .withArgs(addr1.address);
    });
  });

  describe('Burning', function () {
    it('Should allow owner to burn tokens', async function () {
      const { nounsFungibleToken, owner, addr1 } = await loadFixture(
        deployNounsFungibleTokenFixture,
      );
      await nounsFungibleToken.mint(addr1.address, 100);
      await nounsFungibleToken.burn(addr1.address, 50);
      expect(await nounsFungibleToken.balanceOf(addr1.address)).to.equal(50);
    });

    it('Should not allow non-owner to burn tokens', async function () {
      const { nounsFungibleToken, owner, addr1 } = await loadFixture(
        deployNounsFungibleTokenFixture,
      );
      await nounsFungibleToken.mint(addr1.address, 100);
      await expect(nounsFungibleToken.connect(addr1).burn(addr1.address, 50))
        .to.be.revertedWithCustomError(nounsFungibleToken, 'OwnableUnauthorizedAccount')
        .withArgs(addr1.address);
    });

    it('Should not allow burning more tokens than owned', async function () {
      const { nounsFungibleToken, owner, addr1 } = await loadFixture(
        deployNounsFungibleTokenFixture,
      );
      await nounsFungibleToken.mint(addr1.address, 100);
      await expect(nounsFungibleToken.burn(addr1.address, 150)).to.be.revertedWithCustomError(
        nounsFungibleToken,
        'ERC20InsufficientBalance',
      );
    });
  });
});
```
