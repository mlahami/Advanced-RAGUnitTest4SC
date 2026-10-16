const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GaslessRelayer", function () {
  let relayer;
  let owner, user, relayerSigner;
  let target;
  let domain;

  beforeEach(async function () {
    [owner, user, relayerSigner] = await ethers.getSigners();

    // Deploy GaslessRelayer
    const RelayerFactory = await ethers.getContractFactory("GaslessRelayer");
    relayer = await RelayerFactory.deploy();
    await relayer.waitForDeployment();

    // Deploy BenchmarkTarget
    const TargetFactory = await ethers.getContractFactory("BenchmarkTarget");
    target = await TargetFactory.deploy();
    await target.waitForDeployment();

    // Set up domain for EIP-712 signing
    domain = {
      name: "GaslessRelayer",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await relayer.getAddress()
    };
  });

  describe("execute", function () {
    it("should execute a valid meta-transaction", async function () {
      const nonce = await relayer.nonces(user.address);
      const deadline = (await ethers.provider.getBlock("latest")).timestamp + 1000;
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

      // Execute the meta-transaction
      const tx = await relayer.connect(relayerSigner).execute(request, signature, { value: value });
      const receipt = await tx.wait();

      // Check event emission
      expect(receipt.logs[0].fragment.name).to.equal("MetaTxExecuted");
      expect(receipt.logs[0].args.from).to.equal(user.address);
      expect(receipt.logs[0].args.to).to.equal(await target.getAddress());
      expect(receipt.logs[0].args.success).to.be.true;

      // Check nonce increment
      expect(await relayer.nonces(user.address)).to.equal(nonce + 1n);

      // Check target state change
      expect(await target.value()).to.equal(42n);
    });

    it("should revert with expired deadline", async function () {
      const nonce = await relayer.nonces(user.address);
      const deadline = (await ethers.provider.getBlock("latest")).timestamp - 1000;
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
        .to.be.revertedWith("Request expired");
    });

    it("should revert with bad nonce", async function () {
      const nonce = await relayer.nonces(user.address) + 1n;
      const deadline = (await ethers.provider.getBlock("latest")).timestamp + 1000;
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
        .to.be.revertedWith("Bad nonce");
    });

    it("should revert with bad signature", async function () {
      const nonce = await relayer.nonces(user.address);
      const deadline = (await ethers.provider.getBlock("latest")).timestamp + 1000;
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

      // Create a signature with wrong data
      const wrongRequest = { ...request, value: ethers.parseEther("2") };
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

      await expect(relayer.connect(relayerSigner).execute(request, signature, { value: value }))
        .to.be.revertedWith("Bad signature");
    });

    it("should handle failed target call", async function () {
      const nonce = await relayer.nonces(user.address);
      const deadline = (await ethers.provider.getBlock("latest")).timestamp + 1000;
      const value = ethers.parseEther("1");
      const gas = 100000n;
      const data = target.interface.encodeFunctionData("fail");

      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: value,
        gas: gas,
        nonce: nonce,
        deadline: deadline,
        data: data
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

      const tx = await relayer.connect(relayerSigner).execute(request, signature, { value: value });
      const receipt = await tx.wait();

      // Check event emission with success=false
      expect(receipt.logs[0].fragment.name).to.equal("MetaTxExecuted");
      expect(receipt.logs[0].args.from).to.equal(user.address);
      expect(receipt.logs[0].args.to).to.equal(await target.getAddress());
      expect(receipt.logs[0].args.success).to.be.false;

      // Check nonce increment
      expect(await relayer.nonces(user.address)).to.equal(nonce + 1n);
    });
  });

  describe("verify", function () {
    it("should verify valid signature", async function () {
      const nonce = await relayer.nonces(user.address);
      const deadline = (await ethers.provider.getBlock("latest")).timestamp + 1000;
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

    it("should reject invalid signature", async function () {
      const nonce = await relayer.nonces(user.address);
      const deadline = (await ethers.provider.getBlock("latest")).timestamp + 1000;
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

      // Create a signature with wrong data
      const wrongRequest = { ...request, value: ethers.parseEther("2") };
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