const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GaslessRelayer", function () {
  let relayer, owner, user, target, other;
  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

  beforeEach(async function () {
    [owner, user, target, other] = await ethers.getSigners();

    const Relayer = await ethers.getContractFactory("GaslessRelayer");
    relayer = await Relayer.deploy();
    await relayer.waitForDeployment();

    const Target = await ethers.getContractFactory("BenchmarkTarget");
    target = await Target.deploy();
    await target.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the correct domain separator", async function () {
      const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
      const domainSeparator = ethers.keccak256(
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
      expect(await relayer.DOMAIN_SEPARATOR()).to.equal(domainSeparator);
    });
  });

  describe("execute", function () {
    it("should execute a valid meta-transaction", async function () {
      const nonce = await relayer.nonces(user.address);
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

      const digest = await relayer._hashTypedData(request);
      const signature = await user.signMessage(ethers.getBytes(digest));

      const tx = await relayer.execute(request, signature, { value: value });
      const receipt = await tx.wait();

      expect(receipt.status).to.equal(1);
      expect(await relayer.nonces(user.address)).to.equal(nonce + 1n);
      expect(await target.value()).to.equal(42n);

      const event = receipt.logs.find(log => log.fragment.name === "MetaTxExecuted");
      expect(event.args.from).to.equal(user.address);
      expect(event.args.to).to.equal(await target.getAddress());
      expect(event.args.success).to.be.true;
    });

    it("should revert if request is expired", async function () {
      const nonce = await relayer.nonces(user.address);
      const expiredRequest = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        deadline: 0, // expired
        data: "0x"
      };

      const digest = await relayer._hashTypedData(expiredRequest);
      const signature = await user.signMessage(ethers.getBytes(digest));

      await expect(relayer.execute(expiredRequest, signature))
        .to.be.revertedWith("Request expired");
    });

    it("should revert if nonce is invalid", async function () {
      const invalidNonce = 999n; // invalid nonce
      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: invalidNonce,
        deadline: deadline,
        data: "0x"
      };

      const digest = await relayer._hashTypedData(request);
      const signature = await user.signMessage(ethers.getBytes(digest));

      await expect(relayer.execute(request, signature))
        .to.be.revertedWith("Bad nonce");
    });

    it("should revert if signature is invalid", async function () {
      const nonce = await relayer.nonces(user.address);
      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        deadline: deadline,
        data: "0x"
      };

      const digest = await relayer._hashTypedData(request);
      const invalidSignature = await other.signMessage(ethers.getBytes(digest)); // signed by wrong account

      await expect(relayer.execute(request, invalidSignature))
        .to.be.revertedWith("Bad signature");
    });

    it("should handle failed target calls", async function () {
      const nonce = await relayer.nonces(user.address);
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

      const digest = await relayer._hashTypedData(request);
      const signature = await user.signMessage(ethers.getBytes(digest));

      const tx = await relayer.execute(request, signature);
      const receipt = await tx.wait();

      const event = receipt.logs.find(log => log.fragment.name === "MetaTxExecuted");
      expect(event.args.success).to.be.false;
    });
  });

  describe("verify", function () {
    it("should verify a valid signature", async function () {
      const nonce = await relayer.nonces(user.address);
      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        deadline: deadline,
        data: "0x"
      };

      const digest = await relayer._hashTypedData(request);
      const signature = await user.signMessage(ethers.getBytes(digest));

      expect(await relayer.verify(request, signature)).to.be.true;
    });

    it("should reject an invalid signature", async function () {
      const nonce = await relayer.nonces(user.address);
      const request = {
        from: user.address,
        to: await target.getAddress(),
        value: 0n,
        gas: 100000n,
        nonce: nonce,
        deadline: deadline,
        data: "0x"
      };

      const digest = await relayer._hashTypedData(request);
      const invalidSignature = await other.signMessage(ethers.getBytes(digest)); // signed by wrong account

      expect(await relayer.verify(request, invalidSignature)).to.be.false;
    });
  });
});