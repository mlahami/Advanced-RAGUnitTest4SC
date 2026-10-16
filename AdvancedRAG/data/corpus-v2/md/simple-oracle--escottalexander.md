# simple-oracle--escottalexander

- domain: price-oracles (oracle)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/escottalexander/oracle-challenge @ 62acb5c13ec3e777a79a767b0893cf5f9edf81b8
- license: MIT
- targets: SimpleOracle.sol
- validation: 5 passing tests, 0 failing; statement coverage SimpleOracle.sol 100.0 %

## Contract: SimpleOracle.sol (primary target)

```solidity
//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

contract SimpleOracle {
    uint256 public price;
    uint256 public timestamp;

    event PriceUpdated(uint256 newPrice);

    constructor() {}

    modifier onlyOwner() {
        // Intentionally removing the owner requirement to make it easy for you to impersonate the owner
        // require(msg.sender == owner, "Not the owner");
        _;
    }

    function setPrice(uint256 _newPrice) public onlyOwner {
        price = _newPrice;
        timestamp = block.timestamp;
        emit PriceUpdated(_newPrice);
    }

    function getPrice() public view returns (uint256, uint256) {
        return (price, timestamp);
    }
}
```

## Tests: SimpleOracle.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SimpleOracle", function () {
  let oracle;
  let owner;

  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    const SimpleOracleFactory = await ethers.getContractFactory("SimpleOracle");
    oracle = await SimpleOracleFactory.deploy();
  });

  it("Should deploy successfully", function () {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    expect(oracle.target).to.not.be.undefined;
  });

  it("Should initialize price and timestamp to zero", async function () {
    const price = await oracle.price();
    const timestamp = await oracle.timestamp();

    expect(price).to.equal(0n);
    expect(timestamp).to.equal(0n);
  });

  it("Should set price", async function () {
    const newPrice = 1500n;
    await oracle.connect(owner).setPrice(newPrice);
    const price = await oracle.price();
    expect(price).to.equal(newPrice);
  });

  it("Should emit PriceUpdated event", async function () {
    const newPrice = 1500n;
    const tx = await oracle.connect(owner).setPrice(newPrice);
    expect(tx).to.emit(oracle, "PriceUpdated").withArgs(newPrice);
  });

  it("Should return correct price and timestamp from getPrice", async function () {
    const newPrice = 1500n;
    await oracle.connect(owner).setPrice(newPrice);
    const [retrievedPrice, retrievedTimestamp] = await oracle.getPrice();
    expect(retrievedPrice).to.equal(newPrice);
    expect(retrievedTimestamp).to.be.a("bigint");
    expect(retrievedTimestamp).to.be.greaterThan(0n);
  });
});
```
