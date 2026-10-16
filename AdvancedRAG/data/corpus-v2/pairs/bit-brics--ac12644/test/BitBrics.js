const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BitBricsERC1155", function () {
  let owner, backend, user1, user2, other;
  let bitbrics;
  const uri = "https://example.com/metadata/{id}.json";
  const propertyId = 1;
  const maxSupply = 1000;

  beforeEach(async () => {
    [owner, backend, user1, user2, other] = await ethers.getSigners();
    const BitBrics = await ethers.getContractFactory("BitBricsERC1155");
    bitbrics = (await BitBrics.deploy(uri, owner.address));
    await bitbrics.waitForDeployment();

    await bitbrics.connect(owner).setBackendOperator(backend.address);
  });

  it("sets and updates the URI", async () => {
    expect(await bitbrics.uri(propertyId)).to.equal(uri);
    await bitbrics
      .connect(owner)
      .setURI("https://newdomain.com/metadata/{id}.json");
    expect(await bitbrics.uri(propertyId)).to.equal(
      "https://newdomain.com/metadata/{id}.json"
    );
  });

  it("only owner or backend can set KYC", async () => {
    await expect(
      bitbrics.connect(user1).setKYC(user1.address, true)
    ).to.be.revertedWith("Not backend or owner");

    await bitbrics.connect(owner).setKYC(user1.address, true);
    expect(await bitbrics.isKYCApproved(user1.address)).to.be.true;

    await bitbrics.connect(backend).setKYC(user2.address, true);
    expect(await bitbrics.isKYCApproved(user2.address)).to.be.true;
  });

  it("owner sets max supply only once", async () => {
    await bitbrics.connect(owner).setMaxSupply(propertyId, maxSupply);
    expect(await bitbrics.maxSupply(propertyId)).to.equal(maxSupply);

    await expect(
      bitbrics.connect(owner).setMaxSupply(propertyId, 500)
    ).to.be.revertedWith("Max supply already set");
  });

  it("backend or owner can mint to KYC'd user up to max supply", async () => {
    await bitbrics.connect(owner).setMaxSupply(propertyId, maxSupply);
    await bitbrics.connect(backend).setKYC(user1.address, true);

    await expect(
      bitbrics.connect(backend).mint(user1.address, propertyId, 100, "0x")
    ).to.emit(bitbrics, "TransferSingle");

    await expect(
      bitbrics.connect(backend).mint(user1.address, propertyId, maxSupply, "0x")
    ).to.be.revertedWith("Exceeds property supply");
  });

  it("prevents minting/transfers to non-KYC users", async () => {
    await bitbrics.connect(owner).setMaxSupply(propertyId, maxSupply);
    await bitbrics.connect(backend).setKYC(user1.address, true);

    await bitbrics.connect(backend).mint(user1.address, propertyId, 1, "0x");

    await expect(
      bitbrics.connect(backend).mint(user2.address, propertyId, 1, "0x")
    ).to.be.revertedWith("KYC required");
  });

  it("only backend or owner can transfer between users (platformTransfer)", async () => {
    await bitbrics.connect(owner).setMaxSupply(propertyId, maxSupply);
    await bitbrics.connect(backend).setKYC(user1.address, true);
    await bitbrics.connect(backend).setKYC(user2.address, true);
    await bitbrics.connect(backend).mint(user1.address, propertyId, 10, "0x");

    await expect(
      bitbrics
        .connect(user1)
        .safeTransferFrom(user1.address, user2.address, propertyId, 1, "0x")
    ).to.be.revertedWith("Only backend/operator can transfer");

    await expect(
      bitbrics
        .connect(backend)
        .platformTransfer(user1.address, user2.address, propertyId, 5, "0x")
    ).to.emit(bitbrics, "TransferSingle");

    expect(await bitbrics.balanceOf(user2.address, propertyId)).to.equal(5);
  });

  it("adminForceTransfer by owner works in emergencies", async () => {
    await bitbrics.connect(owner).setMaxSupply(propertyId, maxSupply);
    await bitbrics.connect(backend).setKYC(user1.address, true);
    await bitbrics.connect(backend).setKYC(user2.address, true);
    await bitbrics.connect(backend).mint(user1.address, propertyId, 10, "0x");

    await expect(
      bitbrics
        .connect(owner)
        .adminForceTransfer(
          user1.address,
          user2.address,
          propertyId,
          3,
          "compliance"
        )
    ).to.emit(bitbrics, "AdminForceTransfer");

    expect(await bitbrics.balanceOf(user2.address, propertyId)).to.equal(3);
  });

  it("pausing blocks minting and transfers", async () => {
    await bitbrics.connect(owner).setMaxSupply(propertyId, maxSupply);
    await bitbrics.connect(backend).setKYC(user1.address, true);

    await bitbrics.connect(owner).pause();

    await expect(
      bitbrics.connect(backend).mint(user1.address, propertyId, 1, "0x")
    ).to.be.revertedWithCustomError(bitbrics, "EnforcedPause");

    await bitbrics.connect(owner).unpause();
    await expect(
      bitbrics.connect(backend).mint(user1.address, propertyId, 1, "0x")
    ).to.emit(bitbrics, "TransferSingle");
  });

  it("owner or backend can batch mint and batch transfer", async () => {
    const ids = [2, 3];
    const amts = [50, 60];
    await bitbrics.connect(owner).setMaxSupply(ids[0], 100);
    await bitbrics.connect(owner).setMaxSupply(ids[1], 100);
    await bitbrics.connect(backend).setKYC(user1.address, true);
    await bitbrics.connect(backend).setKYC(user2.address, true);

    await expect(
      bitbrics.connect(backend).mintBatch(user1.address, ids, amts, "0x")
    ).to.emit(bitbrics, "TransferBatch");

    await expect(
      bitbrics
        .connect(backend)
        .platformBatchTransfer(user1.address, user2.address, ids, amts, "0x")
    ).to.emit(bitbrics, "TransferBatch");
  });

  it("owner can rotate backend operator", async () => {
    await bitbrics.connect(owner).setBackendOperator(other.address);
    await expect(
      bitbrics.connect(backend).mint(user1.address, propertyId, 1, "0x")
    ).to.be.revertedWith("Not backend or owner");

    await bitbrics.connect(other).setKYC(user1.address, true);
    expect(await bitbrics.isKYCApproved(user1.address)).to.be.true;
  });

  it("does not allow approvals or public transfers", async () => {
    await expect(
      bitbrics.connect(user1).setApprovalForAll(user2.address, true)
    ).to.be.revertedWith("Approvals disabled");
    expect(
      await bitbrics.isApprovedForAll(user1.address, user2.address)
    ).to.equal(false);
  });
});
