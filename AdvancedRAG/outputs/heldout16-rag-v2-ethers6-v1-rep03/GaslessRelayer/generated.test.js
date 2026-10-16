const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GaslessRelayer", function () {
  let relayer;
  let user;
  let target;
  let domain;
  let forwarder;

  beforeEach(async function () {
    [relayer, user] = await ethers.getSigners();

    // Deploy forwarder
    const Forwarder = await ethers.getContractFactory("GaslessRelayer");
    forwarder = await Forwarder.deploy();
    await forwarder.waitForDeployment();

    // Deploy target contract
    const Target = await ethers.getContractFactory("BenchmarkTarget");
    target = await Target.deploy();
    await target.waitForDeployment();

    // Set up EIP-712 domain
    const chainId = (await ethers.provider.getNetwork()).chainId;
    domain = {
      name: "GaslessRelayer",
      version: "1",
      chainId: Number(chainId),
      verifyingContract: await forwarder.getAddress()
    };
  });

  describe("execute", function () {
    it("should execute a valid meta-transaction", async function () {
      const nonce = await forwarder.nonces(user.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const value = 0n;
      const gas = 100000n;
      const data = target.interface.encodeFunctionData("setValue", [42n]);

      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: value.toString(),
        gas: gas.toString(),
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        data
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      };

      const signature = await user.signTypedData(domain, types, request);

      await expect(forwarder.connect(relayer).execute(request, signature))
        .to.emit(forwarder, "MetaTxExecuted")
        .withArgs(user.address, await target.getAddress(), true);

      expect(await target.value()).to.equal(42n);
    });

    it("should revert with expired deadline", async function () {
      const nonce = await forwarder.nonces(user.address);
      const deadline = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const value = 0n;
      const gas = 100000n;
      const data = target.interface.encodeFunctionData("setValue", [42n]);

      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: value.toString(),
        gas: gas.toString(),
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        data
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      };

      const signature = await user.signTypedData(domain, types, request);

      await expect(forwarder.connect(relayer).execute(request, signature))
        .to.be.revertedWith("Request expired");
    });

    it("should revert with bad nonce", async function () {
      const nonce = 12345n; // Invalid nonce
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const value = 0n;
      const gas = 100000n;
      const data = target.interface.encodeFunctionData("setValue", [42n]);

      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: value.toString(),
        gas: gas.toString(),
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        data
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      };

      const signature = await user.signTypedData(domain, types, request);

      await expect(forwarder.connect(relayer).execute(request, signature))
        .to.be.revertedWith("Bad nonce");
    });

    it("should revert with bad signature", async function () {
      const nonce = await forwarder.nonces(user.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const value = 0n;
      const gas = 100000n;
      const data = target.interface.encodeFunctionData("setValue", [42n]);

      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: value.toString(),
        gas: gas.toString(),
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        data
      };

      // Create invalid signature
      const invalidSignature = ethers.hexlify(ethers.randomBytes(65));

      await expect(forwarder.connect(relayer).execute(request, invalidSignature))
        .to.be.revertedWith("Bad signature");
    });

    it("should increment nonce after successful execution", async function () {
      const initialNonce = await forwarder.nonces(user.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const value = 0n;
      const gas = 100000n;
      const data = target.interface.encodeFunctionData("setValue", [42n]);

      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: value.toString(),
        gas: gas.toString(),
        nonce: initialNonce.toString(),
        deadline: deadline.toString(),
        data
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      };

      const signature = await user.signTypedData(domain, types, request);

      await forwarder.connect(relayer).execute(request, signature);

      const newNonce = await forwarder.nonces(user.address);
      expect(newNonce).to.equal(initialNonce + 1n);
    });

    it("should handle failed target execution", async function () {
      const nonce = await forwarder.nonces(user.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const value = 0n;
      const gas = 100000n;
      const data = target.interface.encodeFunctionData("fail");

      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: value.toString(),
        gas: gas.toString(),
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        data
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      };

      const signature = await user.signTypedData(domain, types, request);

      await expect(forwarder.connect(relayer).execute(request, signature))
        .to.emit(forwarder, "MetaTxExecuted")
        .withArgs(user.address, await target.getAddress(), false);
    });
  });

  describe("verify", function () {
    it("should verify a valid signature", async function () {
      const nonce = await forwarder.nonces(user.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const value = 0n;
      const gas = 100000n;
      const data = target.interface.encodeFunctionData("setValue", [42n]);

      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: value.toString(),
        gas: gas.toString(),
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        data
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      };

      const signature = await user.signTypedData(domain, types, request);

      const isValid = await forwarder.verify(request, signature);
      expect(isValid).to.be.true;
    });

    it("should reject an invalid signature", async function () {
      const nonce = await forwarder.nonces(user.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const value = 0n;
      const gas = 100000n;
      const data = target.interface.encodeFunctionData("setValue", [42n]);

      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: value.toString(),
        gas: gas.toString(),
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        data
      };

      // Create invalid signature
      const invalidSignature = ethers.hexlify(ethers.randomBytes(65));

      const isValid = await forwarder.verify(request, invalidSignature);
      expect(isValid).to.be.false;
    });
  });
});