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
