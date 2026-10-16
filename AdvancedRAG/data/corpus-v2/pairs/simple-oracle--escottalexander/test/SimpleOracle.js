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
