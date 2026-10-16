const { expect } = require("chai");
const { ethers } = require("hardhat");

const DOMAIN_ETHEREUM = 31338;
const DOMAIN_XPHERE = 31337;

function addressToBytes32(address) {
  return `0x${"0".repeat(24)}${address.slice(2)}`;
}

function transferRemoteMessageId(bridge, receipt) {
  const event = receipt?.logs
    .map((log) => {
      try {
        return bridge.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed?.name === "TransferRemote");

  expect(event).to.not.equal(undefined);
  return event .args.messageId;
}

async function deployBridgeFixture() {
  const [owner, user, other] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("MintableERC20");
  const collateral = (await Token.deploy("Local USDC", "USDC", 6, owner.address));
  await collateral.waitForDeployment();
  const synthetic = (await Token.deploy("Local xUSDC", "xUSDC", 6, owner.address));
  await synthetic.waitForDeployment();

  const Bridge = await ethers.getContractFactory("LocalERC20Bridge");
  const collateralBridge = (await Bridge.deploy(
    await collateral.getAddress(),
    DOMAIN_ETHEREUM,
    DOMAIN_XPHERE,
    0,
    owner.address,
  ));
  await collateralBridge.waitForDeployment();
  const syntheticBridge = (await Bridge.deploy(
    await synthetic.getAddress(),
    DOMAIN_XPHERE,
    DOMAIN_ETHEREUM,
    1,
    owner.address,
  ));
  await syntheticBridge.waitForDeployment();

  await collateral.mint(user.address, ethers.parseUnits("1000", 6));
  await synthetic.transferOwnership(await syntheticBridge.getAddress());

  return { owner, user, other, collateral, synthetic, collateralBridge, syntheticBridge };
}

async function deployNativeBridgeFixture() {
  const [owner, user, other] = await ethers.getSigners();
  const Bridge = await ethers.getContractFactory("LocalNativeBridge");
  const ethereumBridge = (await Bridge.deploy(DOMAIN_ETHEREUM, DOMAIN_XPHERE, owner.address, {
    value: ethers.parseEther("25"),
  }));
  await ethereumBridge.waitForDeployment();
  const xphereBridge = (await Bridge.deploy(DOMAIN_XPHERE, DOMAIN_ETHEREUM, owner.address, {
    value: ethers.parseEther("25"),
  }));
  await xphereBridge.waitForDeployment();
  return { owner, user, other, ethereumBridge, xphereBridge };
}

describe("LocalERC20Bridge", function () {
  it("locks collateral and mints synthetic with replay protection", async function () {
    const { user, collateral, synthetic, collateralBridge, syntheticBridge } = await deployBridgeFixture();
    const amount = ethers.parseUnits("25", 6);
    const recipient = addressToBytes32(user.address);

    await collateral.connect(user).approve(await collateralBridge.getAddress(), amount);
    const tx = await collateralBridge.connect(user).transferRemote(DOMAIN_XPHERE, recipient, amount);
    const receipt = await tx.wait();
    const event = receipt?.logs
      .map((log) => {
        try {
          return collateralBridge.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "TransferRemote");

    expect(event).to.not.equal(undefined);
    const messageId = event .args.messageId;
    expect(await collateral.balanceOf(await collateralBridge.getAddress())).to.equal(amount);

    await syntheticBridge.receiveRemote(messageId, addressToBytes32(user.address), user.address, amount);
    expect(await synthetic.balanceOf(user.address)).to.equal(amount);

    await expect(
      syntheticBridge.receiveRemote(messageId, addressToBytes32(user.address), user.address, amount),
    ).to.be.revertedWith("LocalERC20Bridge: already processed");
  });

  it("burns synthetic and releases collateral", async function () {
    const { user, collateral, synthetic, collateralBridge, syntheticBridge } = await deployBridgeFixture();
    const amount = ethers.parseUnits("40", 6);
    const messageId = ethers.keccak256(ethers.toUtf8Bytes("inbound synthetic seed"));

    await collateral.mint(await collateralBridge.getAddress(), amount);
    await syntheticBridge.receiveRemote(messageId, addressToBytes32(user.address), user.address, amount);
    expect(await synthetic.balanceOf(user.address)).to.equal(amount);

    await synthetic.connect(user).approve(await syntheticBridge.getAddress(), amount);
    await syntheticBridge.connect(user).transferRemote(DOMAIN_ETHEREUM, addressToBytes32(user.address), amount);
    expect(await synthetic.balanceOf(user.address)).to.equal(0);

    const releaseMessageId = ethers.keccak256(ethers.toUtf8Bytes("release collateral"));
    const before = await collateral.balanceOf(user.address);
    await collateralBridge.receiveRemote(releaseMessageId, addressToBytes32(user.address), user.address, amount);
    expect(await collateral.balanceOf(user.address)).to.equal(before + amount);
  });

  it("enforces owner-only receive and pause controls", async function () {
    const { user, other, collateral, collateralBridge } = await deployBridgeFixture();
    const amount = ethers.parseUnits("5", 6);

    await expect(
      collateralBridge.connect(other).receiveRemote(
        ethers.keccak256(ethers.toUtf8Bytes("unauthorized")),
        addressToBytes32(user.address),
        user.address,
        amount,
      ),
    ).to.be.revertedWith("LocalERC20Bridge: not owner");

    await collateralBridge.pause();
    await collateral.connect(user).approve(await collateralBridge.getAddress(), amount);
    await expect(
      collateralBridge.connect(user).transferRemote(DOMAIN_XPHERE, addressToBytes32(user.address), amount),
    ).to.be.revertedWith("LocalERC20Bridge: paused");

    await collateralBridge.unpause();
    await collateralBridge.connect(user).transferRemote(DOMAIN_XPHERE, addressToBytes32(user.address), amount);
  });

  it("includes the bridge address in message IDs to avoid redeploy collisions", async function () {
    const { owner, user, collateral, collateralBridge } = await deployBridgeFixture();
    const Bridge = await ethers.getContractFactory("LocalERC20Bridge");
    const secondBridge = (await Bridge.deploy(
      await collateral.getAddress(),
      DOMAIN_ETHEREUM,
      DOMAIN_XPHERE,
      0,
      owner.address,
    ));
    await secondBridge.waitForDeployment();

    const amount = ethers.parseUnits("5", 6);
    const recipient = addressToBytes32(user.address);
    await collateral.connect(user).approve(await collateralBridge.getAddress(), amount);
    await collateral.connect(user).approve(await secondBridge.getAddress(), amount);

    const firstReceipt = await (await collateralBridge.connect(user).transferRemote(DOMAIN_XPHERE, recipient, amount)).wait();
    const secondReceipt = await (await secondBridge.connect(user).transferRemote(DOMAIN_XPHERE, recipient, amount)).wait();

    expect(transferRemoteMessageId(collateralBridge, firstReceipt)).to.not.equal(
      transferRemoteMessageId(secondBridge, secondReceipt),
    );
  });

  it("rejects invalid domains, zero recipients, and zero amounts", async function () {
    const { user, collateralBridge } = await deployBridgeFixture();

    await expect(
      collateralBridge.connect(user).transferRemote(1, addressToBytes32(user.address), ethers.parseUnits("1", 6)),
    ).to.be.revertedWith("LocalERC20Bridge: bad domain");

    await expect(
      collateralBridge.connect(user).transferRemote(DOMAIN_XPHERE, ethers.ZeroHash, ethers.parseUnits("1", 6)),
    ).to.be.revertedWith("LocalERC20Bridge: zero recipient");

    await expect(
      collateralBridge.connect(user).transferRemote(DOMAIN_XPHERE, addressToBytes32(user.address), 0),
    ).to.be.revertedWith("LocalERC20Bridge: zero amount");
  });
});

describe("LocalNativeBridge", function () {
  it("locks native collateral and releases native liquidity with replay protection", async function () {
    const { user, ethereumBridge, xphereBridge } = await deployNativeBridgeFixture();
    const amount = ethers.parseEther("1.25");
    const recipient = addressToBytes32(user.address);
    const beforeSourceBridge = await ethers.provider.getBalance(await ethereumBridge.getAddress());

    const tx = await ethereumBridge.connect(user).transferRemote(DOMAIN_XPHERE, recipient, amount, { value: amount });
    const receipt = await tx.wait();
    const event = receipt?.logs
      .map((log) => {
        try {
          return ethereumBridge.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "TransferRemote");

    expect(event).to.not.equal(undefined);
    const messageId = event .args.messageId;
    expect(await ethers.provider.getBalance(await ethereumBridge.getAddress())).to.equal(beforeSourceBridge + amount);

    const beforeRecipient = await ethers.provider.getBalance(user.address);
    await xphereBridge.receiveRemote(messageId, addressToBytes32(user.address), user.address, amount);
    expect(await ethers.provider.getBalance(user.address)).to.equal(beforeRecipient + amount);

    await expect(
      xphereBridge.receiveRemote(messageId, addressToBytes32(user.address), user.address, amount),
    ).to.be.revertedWith("LocalNativeBridge: already processed");
  });

  it("bridges native value in the reverse direction", async function () {
    const { user, ethereumBridge, xphereBridge } = await deployNativeBridgeFixture();
    const amount = ethers.parseEther("0.5");

    const tx = await xphereBridge
      .connect(user)
      .transferRemote(DOMAIN_ETHEREUM, addressToBytes32(user.address), amount, { value: amount });
    const receipt = await tx.wait();
    const event = receipt?.logs
      .map((log) => {
        try {
          return xphereBridge.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "TransferRemote");
    const messageId = event .args.messageId;

    const beforeRecipient = await ethers.provider.getBalance(user.address);
    await ethereumBridge.receiveRemote(messageId, addressToBytes32(user.address), user.address, amount);
    expect(await ethers.provider.getBalance(user.address)).to.equal(beforeRecipient + amount);
  });

  it("enforces native owner-only receive and pause controls", async function () {
    const { user, other, ethereumBridge } = await deployNativeBridgeFixture();
    const amount = ethers.parseEther("0.1");

    await expect(
      ethereumBridge
        .connect(other)
        .receiveRemote(ethers.keccak256(ethers.toUtf8Bytes("unauthorized-native")), addressToBytes32(user.address), user.address, amount),
    ).to.be.revertedWith("LocalNativeBridge: not owner");

    await ethereumBridge.pause();
    await expect(
      ethereumBridge.connect(user).transferRemote(DOMAIN_XPHERE, addressToBytes32(user.address), amount, { value: amount }),
    ).to.be.revertedWith("LocalNativeBridge: paused");
  });

  it("includes the native bridge address in message IDs to avoid redeploy collisions", async function () {
    const { owner, user, ethereumBridge } = await deployNativeBridgeFixture();
    const Bridge = await ethers.getContractFactory("LocalNativeBridge");
    const secondBridge = (await Bridge.deploy(DOMAIN_ETHEREUM, DOMAIN_XPHERE, owner.address, {
      value: ethers.parseEther("25"),
    }));
    await secondBridge.waitForDeployment();

    const amount = ethers.parseEther("0.1");
    const recipient = addressToBytes32(user.address);
    const firstReceipt = await (
      await ethereumBridge.connect(user).transferRemote(DOMAIN_XPHERE, recipient, amount, { value: amount })
    ).wait();
    const secondReceipt = await (
      await secondBridge.connect(user).transferRemote(DOMAIN_XPHERE, recipient, amount, { value: amount })
    ).wait();

    expect(transferRemoteMessageId(ethereumBridge, firstReceipt)).to.not.equal(
      transferRemoteMessageId(secondBridge, secondReceipt),
    );
  });

  it("rejects bad native bridge inputs", async function () {
    const { user, ethereumBridge } = await deployNativeBridgeFixture();
    const amount = ethers.parseEther("0.1");

    await expect(
      ethereumBridge.connect(user).transferRemote(1, addressToBytes32(user.address), amount, { value: amount }),
    ).to.be.revertedWith("LocalNativeBridge: bad domain");

    await expect(
      ethereumBridge.connect(user).transferRemote(DOMAIN_XPHERE, ethers.ZeroHash, amount, { value: amount }),
    ).to.be.revertedWith("LocalNativeBridge: zero recipient");

    await expect(
      ethereumBridge.connect(user).transferRemote(DOMAIN_XPHERE, addressToBytes32(user.address), amount, { value: 0 }),
    ).to.be.revertedWith("LocalNativeBridge: amount/value mismatch");
  });
});
