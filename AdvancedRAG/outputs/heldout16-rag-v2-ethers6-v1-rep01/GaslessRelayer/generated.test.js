const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GaslessRelayer", function () {
  let relayer;
  let target;
  let user;
  let relayerSigner;
  let domain;
  let chainId;

  beforeEach(async function () {
    [user, relayerSigner] = await ethers.getSigners();

    // Deploy GaslessRelayer
    const RelayerFactory = await ethers.getContractFactory("GaslessRelayer");
    relayer = await RelayerFactory.deploy();
    await relayer.waitForDeployment();

    // Deploy BenchmarkTarget
    const TargetFactory = await ethers.getContractFactory("BenchmarkTarget");
    target = await TargetFactory.deploy();
    await target.waitForDeployment();

    // Set up EIP-712 domain
    chainId = (await ethers.provider.getNetwork()).chainId;
    domain = {
      name: "GaslessRelayer",
      version: "1",
      chainId: Number(chainId),
      verifyingContract: await relayer.getAddress(),
    };
  });

  describe("execute", function () {
    it("should execute a valid meta-transaction", async function () {
      const nonce = await relayer.nonces(user.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const data = target.interface.encodeFunctionData("setValue", [42n]);

      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        deadline: deadline,
        data: data,
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      };

      const signature = await user.signTypedData(domain, types, request);

      await expect(relayer.connect(relayerSigner).execute(request, signature))
        .to.emit(relayer, "MetaTxExecuted")
        .withArgs(user.address, await target.getAddress(), true);

      expect(await target.value()).to.equal(42n);
      expect(await relayer.nonces(user.address)).to.equal(nonce + 1n);
    });

    it("should revert with expired deadline", async function () {
      const nonce = await relayer.nonces(user.address);
      const deadline = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const data = target.interface.encodeFunctionData("setValue", [42n]);

      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        deadline: deadline,
        data: data,
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      };

      const signature = await user.signTypedData(domain, types, request);

      await expect(relayer.connect(relayerSigner).execute(request, signature))
        .to.be.revertedWith("Request expired");
    });

    it("should revert with bad nonce", async function () {
      const nonce = await relayer.nonces(user.address) + 1n; // Invalid nonce
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const data = target.interface.encodeFunctionData("setValue", [42n]);

      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        deadline: deadline,
        data: data,
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      };

      const signature = await user.signTypedData(domain, types, request);

      await expect(relayer.connect(relayerSigner).execute(request, signature))
        .to.be.revertedWith("Bad nonce");
    });

    it("should revert with bad signature", async function () {
      const nonce = await relayer.nonces(user.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const data = target.interface.encodeFunctionData("setValue", [42n]);

      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        deadline: deadline,
        data: data,
      };

      // Create invalid signature
      const invalidSignature = ethers.hexlify(ethers.randomBytes(65));

      await expect(relayer.connect(relayerSigner).execute(request, invalidSignature))
        .to.be.revertedWith("Bad signature");
    });

    it("should revert when target call fails", async function () {
      const nonce = await relayer.nonces(user.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const data = target.interface.encodeFunctionData("fail");

      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        deadline: deadline,
        data: data,
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      };

      const signature = await user.signTypedData(domain, types, request);

      const tx = await relayer.connect(relayerSigner).execute(request, signature);
      const receipt = await tx.wait();

      // Check that the MetaTxExecuted event was emitted with success=false
      const event = receipt.logs.find(log => log.fragment.name === "MetaTxExecuted");
      expect(event.args.success).to.be.false;
    });
  });

  describe("verify", function () {
    it("should verify a valid signature", async function () {
      const nonce = await relayer.nonces(user.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const data = target.interface.encodeFunctionData("setValue", [42n]);

      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        deadline: deadline,
        data: data,
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      };

      const signature = await user.signTypedData(domain, types, request);

      expect(await relayer.verify(request, signature)).to.be.true;
    });

    it("should reject an invalid signature", async function () {
      const nonce = await relayer.nonces(user.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const data = target.interface.encodeFunctionData("setValue", [42n]);

      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        deadline: deadline,
        data: data,
      };

      // Create invalid signature
      const invalidSignature = ethers.hexlify(ethers.randomBytes(65));

      expect(await relayer.verify(request, invalidSignature)).to.be.false;
    });
  });
});