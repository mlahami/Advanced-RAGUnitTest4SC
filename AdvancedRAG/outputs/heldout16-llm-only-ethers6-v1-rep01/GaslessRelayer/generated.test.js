const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GaslessRelayer", function () {
  let relayer, owner, user, target, token;
  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

  beforeEach(async function () {
    [owner, user, relayer] = await ethers.getSigners();

    // Deploy GaslessRelayer
    const Relayer = await ethers.getContractFactory("GaslessRelayer");
    relayer = await Relayer.deploy();
    await relayer.waitForDeployment();

    // Deploy BenchmarkTarget
    const Target = await ethers.getContractFactory("BenchmarkTarget");
    target = await Target.deploy();
    await target.waitForDeployment();

    // Deploy BenchmarkERC20 for testing
    const Token = await ethers.getContractFactory("BenchmarkERC20");
    token = await Token.deploy("Test Token", "TST");
    await token.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the correct domain separator", async function () {
      const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
      const expectedDomainSeparator = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "bytes32", "bytes32", "uint256", "address"],
          [
            ethers.keccak256(ethers.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
            ethers.keccak256(ethers.toUtf8Bytes("GaslessRelayer")),
            ethers.keccak256(ethers.toUtf8Bytes("1")),
            chainId,
            await relayer.getAddress()
          ]
        )
      );
      expect(await relayer.DOMAIN_SEPARATOR()).to.equal(expectedDomainSeparator);
    });
  });

  describe("execute", function () {
    it("should execute a valid meta-transaction", async function () {
      const nonce = await relayer.nonces(user.address);
      const value = ethers.parseEther("1");
      const gas = 100000n;
      const data = target.interface.encodeFunctionData("setValue", [42n]);

      const req = {
        from: user.address,
        to: await target.getAddress(),
        value: value,
        gas: gas,
        nonce: nonce,
        deadline: deadline,
        data: data
      };

      // Sign the request
      const digest = await relayer._hashTypedData(req);
      const signature = await user.signMessage(ethers.getBytes(digest));

      // Execute the meta-transaction
      const tx = await relayer.execute(req, signature, { value: value });
      const receipt = await tx.wait();

      // Check events
      expect(receipt.logs[0].fragment.name).to.equal("MetaTxExecuted");
      expect(receipt.logs[0].args.from).to.equal(user.address);
      expect(receipt.logs[0].args.to).to.equal(await target.getAddress());
      expect(receipt.logs[0].args.success).to.be.true;

      // Check nonce incremented
      expect(await relayer.nonces(user.address)).to.equal(nonce + 1n);

      // Check target state
      expect(await target.value()).to.equal(42n);
    });

    it("should revert with expired deadline", async function () {
      const nonce = await relayer.nonces(user.address);
      const expiredDeadline = Math.floor(Date.now() / 1000) - 1; // 1 second ago

      const req = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        deadline: expiredDeadline,
        data: "0x"
      };

      const digest = await relayer._hashTypedData(req);
      const signature = await user.signMessage(ethers.getBytes(digest));

      await expect(relayer.execute(req, signature))
        .to.be.revertedWith("Request expired");
    });

    it("should revert with bad nonce", async function () {
      const nonce = await relayer.nonces(user.address) + 1n; // Invalid nonce

      const req = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        deadline: deadline,
        data: "0x"
      };

      const digest = await relayer._hashTypedData(req);
      const signature = await user.signMessage(ethers.getBytes(digest));

      await expect(relayer.execute(req, signature))
        .to.be.revertedWith("Bad nonce");
    });

    it("should revert with bad signature", async function () {
      const nonce = await relayer.nonces(user.address);

      const req = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        deadline: deadline,
        data: "0x"
      };

      // Sign with wrong signer
      const digest = await relayer._hashTypedData(req);
      const signature = await owner.signMessage(ethers.getBytes(digest));

      await expect(relayer.execute(req, signature))
        .to.be.revertedWith("Bad signature");
    });

    it("should handle failed target calls", async function () {
      const nonce = await relayer.nonces(user.address);
      const data = target.interface.encodeFunctionData("fail");

      const req = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        deadline: deadline,
        data: data
      };

      const digest = await relayer._hashTypedData(req);
      const signature = await user.signMessage(ethers.getBytes(digest));

      const tx = await relayer.execute(req, signature);
      const receipt = await tx.wait();

      expect(receipt.logs[0].fragment.name).to.equal("MetaTxExecuted");
      expect(receipt.logs[0].args.success).to.be.false;
    });
  });

  describe("verify", function () {
    it("should verify a valid signature", async function () {
      const nonce = await relayer.nonces(user.address);

      const req = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        deadline: deadline,
        data: "0x"
      };

      const digest = await relayer._hashTypedData(req);
      const signature = await user.signMessage(ethers.getBytes(digest));

      expect(await relayer.verify(req, signature)).to.be.true;
    });

    it("should reject an invalid signature", async function () {
      const nonce = await relayer.nonces(user.address);

      const req = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        deadline: deadline,
        data: "0x"
      };

      const digest = await relayer._hashTypedData(req);
      // Sign with wrong signer
      const signature = await owner.signMessage(ethers.getBytes(digest));

      expect(await relayer.verify(req, signature)).to.be.false;
    });
  });
});