# mh-token--gzliudan

- domain: fungible-tokens (erc20-token)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/gzliudan/hardhat-project @ a711a80ad79e6fea8c3f500a973478866a014cef
- license: MIT
- targets: MhToken.sol
- validation: 5 passing tests, 0 failing; statement coverage MhToken.sol 100.0 %

## Contract: MhToken.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.23;

/**
 * @title MhToken
 * @dev Implementation of a basic ERC20-like token
 * @notice This contract implements a simple token with transfer functionality
 */
contract MhToken {
    /**
     * @dev Custom error for insufficient token balance
     */
    error InsufficientToken();

    /**
     * @dev Emitted when tokens are transferred from one address to another
     * @param _from The address tokens are transferred from
     * @param _to The address tokens are transferred to
     * @param _value The amount of tokens transferred
     */
    event Transfer(address indexed _from, address indexed _to, uint256 _value);

    /**
     * @dev Total supply of tokens
     */
    uint256 public totalSupply = 1000000;

    /**
     * @dev Address of the contract owner
     */
    address public owner;

    /**
     * @dev Name of the token
     */
    string public name = "My Hardhat Token";

    /**
     * @dev Symbol of the token
     */
    string public symbol = "MHT";

    /**
     * @dev Mapping of addresses to their token balances
     */
    mapping(address => uint256) internal balances;

    /**
     * @dev Constructor that initializes the token supply and assigns it to the deployer
     */
    constructor() {
        balances[msg.sender] = totalSupply;
        owner = msg.sender;
    }

    /**
     * @dev Transfers tokens from the sender to a specified address
     * @param to The address to transfer tokens to
     * @param amount The amount of tokens to transfer
     * @notice Reverts if the sender has insufficient balance
     * @notice Emits a Transfer event on successful transfer
     */
    function transfer(address to, uint256 amount) external {
        if (balances[msg.sender] < amount) {
            revert InsufficientToken();
        }

        balances[msg.sender] -= amount;
        balances[to] += amount;

        emit Transfer(msg.sender, to, amount);
    }

    /**
     * @dev Returns the token balance of a specified address
     * @param account The address to check the balance of
     * @return The token balance of the specified address
     */
    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }
}
```

## Tests: MhToken.js

```javascript
/* global describe, ethers, it */

const { expect } = require('chai');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

describe('MhToken contract', function () {
  let mhToken;
  let owner;
  let addr1;
  let addr2;

  async function deployTokenFixture() {
    const [owner, addr1, addr2] = await ethers.getSigners();
    const mhToken = await ethers.deployContract('MhToken');
    await mhToken.waitForDeployment();
    return { mhToken, owner, addr1, addr2 };
  }

  beforeEach(async function () {
    const fixture = await loadFixture(deployTokenFixture);
    mhToken = fixture.mhToken;
    owner = fixture.owner;
    addr1 = fixture.addr1;
    addr2 = fixture.addr2;
  });

  describe('Deployment', function () {
    it('Should set the right owner', async function () {
      expect(await mhToken.owner()).to.equal(owner.address);
    });

    it('Should assign the total supply of tokens to the owner', async function () {
      const ownerBalance = await mhToken.balanceOf(owner.address);
      expect(await mhToken.totalSupply()).to.equal(ownerBalance);
    });
  });

  describe('Transactions', function () {
    it('Should transfer tokens between accounts', async function () {
      await expect(mhToken.transfer(addr1.address, 50)).to.changeTokenBalances(mhToken, [owner, addr1], [-50, 50]);
      await expect(mhToken.connect(addr1).transfer(addr2.address, 50)).to.changeTokenBalances(
        mhToken,
        [addr1, addr2],
        [-50, 50]
      );
    });

    it('Should emit Transfer events', async function () {
      await expect(mhToken.transfer(addr1.address, 50))
        .to.emit(mhToken, 'Transfer')
        .withArgs(owner.address, addr1.address, 50);
      await expect(mhToken.connect(addr1).transfer(addr2.address, 50))
        .to.emit(mhToken, 'Transfer')
        .withArgs(addr1.address, addr2.address, 50);
    });

    it("Should fail if sender doesn't have enough tokens", async function () {
      const initialOwnerBalance = await mhToken.balanceOf(owner.address);
      await expect(mhToken.connect(addr1).transfer(owner.address, 1)).to.be.revertedWithCustomError(
        mhToken,
        `InsufficientToken`
      );
      expect(await mhToken.balanceOf(owner.address)).to.equal(initialOwnerBalance);
    });
  });
});
```
