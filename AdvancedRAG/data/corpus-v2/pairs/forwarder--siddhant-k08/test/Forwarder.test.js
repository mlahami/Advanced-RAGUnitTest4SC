const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Forwarder", function () {
  let forwarder;
  let exampleTarget;
  let owner;
  let user;
  let relayer;

  beforeEach(async function () {
    [owner, user, relayer] = await ethers.getSigners();

    const ForwarderFactory = await ethers.getContractFactory("Forwarder");
    forwarder = await ForwarderFactory.deploy();
    await forwarder.waitForDeployment();

    const ExampleTargetFactory = await ethers.getContractFactory("ExampleTarget");
    exampleTarget = await ExampleTargetFactory.deploy(await forwarder.getAddress());
    await exampleTarget.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should deploy with correct domain separator", async function () {
      const domainSeparator = await forwarder.getDomainSeparator();
      expect(domainSeparator).to.not.equal(ethers.ZeroHash);
    });

    it("Should initialize nonces to 0", async function () {
      const nonce = await forwarder.getNonce(user.address);
      expect(nonce).to.equal(0);
    });
  });

  describe("Meta-transactions", function () {
    it("Should execute valid meta-transaction", async function () {
      const nonce = await forwarder.getNonce(user.address);

      const data = exampleTarget.interface.encodeFunctionData("addPoints", [10n]);

      const request = {
        from: user.address,
        to: await exampleTarget.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        data: data,
      };

      const domain = {
        name: "RSKForwarder",
        version: "0.0.1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await forwarder.getAddress(),
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      };

      const signature = await user.signTypedData(domain, types, request);

      await expect(forwarder.connect(relayer).execute(request, signature))
        .to.emit(forwarder, "MetaTransactionExecuted")
        .withArgs(user.address, await exampleTarget.getAddress(), nonce, true, "0x");

      const points = await exampleTarget.getPoints(user.address);
      expect(points).to.equal(10n);

      const newNonce = await forwarder.getNonce(user.address);
      expect(newNonce).to.equal(nonce + 1n);
    });

    it("Should reject invalid signature", async function () {
      const nonce = await forwarder.getNonce(user.address);

      const data = exampleTarget.interface.encodeFunctionData("addPoints", [10n]);

      const request = {
        from: user.address,
        to: await exampleTarget.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        data: data,
      };

      const invalidSignature =
        "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

      await expect(forwarder.connect(relayer).execute(request, invalidSignature)).to.be.revertedWith(
        "Forwarder: signature does not match request",
      );
    });

    it("Should reject replay attacks", async function () {
      const nonce = await forwarder.getNonce(user.address);

      const data = exampleTarget.interface.encodeFunctionData("addPoints", [10n]);

      const request = {
        from: user.address,
        to: await exampleTarget.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        data: data,
      };

      const domain = {
        name: "RSKForwarder",
        version: "0.0.1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await forwarder.getAddress(),
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      };

      const signature = await user.signTypedData(domain, types, request);

      await forwarder.connect(relayer).execute(request, signature);

      await expect(forwarder.connect(relayer).execute(request, signature)).to.be.revertedWith(
        "Forwarder: signature does not match request",
      );
    });
  });

  describe("Verification", function () {
    it("Should verify valid request", async function () {
      const nonce = await forwarder.getNonce(user.address);

      const data = exampleTarget.interface.encodeFunctionData("addPoints", [10n]);

      const request = {
        from: user.address,
        to: await exampleTarget.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        data: data,
      };

      const domain = {
        name: "RSKForwarder",
        version: "0.0.1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await forwarder.getAddress(),
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      };

      const signature = await user.signTypedData(domain, types, request);

      const isValid = await forwarder.verify(request, signature);
      expect(isValid).to.be.true;
    });

    it("Should reject invalid nonce", async function () {
      const nonce = await forwarder.getNonce(user.address);

      const data = exampleTarget.interface.encodeFunctionData("addPoints", [10n]);

      const request = {
        from: user.address,
        to: await exampleTarget.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce + 1n,
        data: data,
      };

      const domain = {
        name: "RSKForwarder",
        version: "0.0.1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await forwarder.getAddress(),
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      };

      const signature = await user.signTypedData(domain, types, request);

      const isValid = await forwarder.verify(request, signature);
      expect(isValid).to.be.false;
    });
  });
});
