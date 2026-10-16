const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GaslessRelayer", function () {
  let relayer;
  let target;
  let owner;
  let user;
  let relayerSigner;
  let domainSeparator;
  let chainId;

  beforeEach(async function () {
    [owner, user, relayerSigner] = await ethers.getSigners();

    const RelayerFactory = await ethers.getContractFactory("GaslessRelayer");
    relayer = await RelayerFactory.deploy();
    await relayer.waitForDeployment();

    const TargetFactory = await ethers.getContractFactory("BenchmarkTarget");
    target = await TargetFactory.deploy();
    await target.waitForDeployment();

    domainSeparator = await relayer.DOMAIN_SEPARATOR();
    chainId = (await ethers.provider.getNetwork()).chainId;
  });

  describe("Deployment", function () {
    it("Should set correct domain separator", async function () {
      const expectedDomainSeparator = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "bytes32", "bytes32", "uint256", "address"],
          [
            await relayer.DOMAIN_TYPEHASH(),
            ethers.keccak256(ethers.toUtf8Bytes("GaslessRelayer")),
            ethers.keccak256(ethers.toUtf8Bytes("1")),
            chainId,
            await relayer.getAddress()
          ]
        )
      );
      expect(domainSeparator).to.equal(expectedDomainSeparator);
    });
  });

  describe("execute", function () {
    it("Should execute a valid meta-transaction", async function () {
      const nonce = await relayer.nonces(user.address);
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const value = ethers.parseEther("1");
      const gas = 100000n;
      const data = target.interface.encodeFunctionData("setValue", [42n]);

      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: value,
        gas: gas,
        nonce: nonce,
        deadline: deadline,
        data: data
      };

      const domain = {
        name: "GaslessRelayer",
        version: "1",
        chainId: chainId,
        verifyingContract: await relayer.getAddress()
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

      await expect(relayer.connect(relayerSigner).execute(request, signature, { value: value }))
        .to.emit(relayer, "MetaTxExecuted")
        .withArgs(user.address, await target.getAddress(), true);

      expect(await target.value()).to.equal(42n);
      expect(await relayer.nonces(user.address)).to.equal(nonce + 1n);
    });

    it("Should revert with expired deadline", async function () {
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
        data: data
      };

      const domain = {
        name: "GaslessRelayer",
        version: "1",
        chainId: chainId,
        verifyingContract: await relayer.getAddress()
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

      await expect(relayer.connect(relayerSigner).execute(request, signature))
        .to.be.revertedWith("Request expired");
    });

    it("Should revert with bad nonce", async function () {
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
        data: data
      };

      const domain = {
        name: "GaslessRelayer",
        version: "1",
        chainId: chainId,
        verifyingContract: await relayer.getAddress()
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

      await expect(relayer.connect(relayerSigner).execute(request, signature))
        .to.be.revertedWith("Bad nonce");
    });

    it("Should revert with bad signature", async function () {
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
        data: data
      };

      // Create a signature with wrong data
      const wrongData = target.interface.encodeFunctionData("setValue", [99n]);
      const wrongRequest = { ...request, data: wrongData };

      const domain = {
        name: "GaslessRelayer",
        version: "1",
        chainId: chainId,
        verifyingContract: await relayer.getAddress()
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

      const signature = await user.signTypedData(domain, types, wrongRequest);

      await expect(relayer.connect(relayerSigner).execute(request, signature))
        .to.be.revertedWith("Bad signature");
    });

    it("Should revert when target call fails", async function () {
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
        data: data
      };

      const domain = {
        name: "GaslessRelayer",
        version: "1",
        chainId: chainId,
        verifyingContract: await relayer.getAddress()
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

      const tx = await relayer.connect(relayerSigner).execute(request, signature);
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("MetaTxExecuted");
      expect(receipt.logs[0].args.success).to.be.false;
    });
  });

  describe("verify", function () {
    it("Should verify a valid signature", async function () {
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
        data: data
      };

      const domain = {
        name: "GaslessRelayer",
        version: "1",
        chainId: chainId,
        verifyingContract: await relayer.getAddress()
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

      expect(await relayer.verify(request, signature)).to.be.true;
    });

    it("Should reject an invalid signature", async function () {
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
        data: data
      };

      // Create a signature with wrong data
      const wrongData = target.interface.encodeFunctionData("setValue", [99n]);
      const wrongRequest = { ...request, data: wrongData };

      const domain = {
        name: "GaslessRelayer",
        version: "1",
        chainId: chainId,
        verifyingContract: await relayer.getAddress()
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

      const signature = await user.signTypedData(domain, types, wrongRequest);

      expect(await relayer.verify(request, signature)).to.be.false;
    });
  });
});