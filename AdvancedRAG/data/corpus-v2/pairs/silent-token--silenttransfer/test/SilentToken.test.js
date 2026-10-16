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
