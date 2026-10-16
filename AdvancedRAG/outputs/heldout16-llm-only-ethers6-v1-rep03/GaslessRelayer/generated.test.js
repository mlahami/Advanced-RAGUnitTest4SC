const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GaslessRelayer", function () {
  let relayer, owner, user, target, deadline, nonce, signature;
  const gas = 100000n;
  const value = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, user, target] = await ethers.getSigners();

    const Relayer = await ethers.getContractFactory("GaslessRelayer");
    relayer = await Relayer.deploy();
    await relayer.waitForDeployment();

    deadline = (await ethers.provider.getBlock("latest")).timestamp + 1000;
    nonce = 0n;
  });

  describe("Deployment", function () {
    it("Should set the correct domain separator", async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;
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
    it("Should execute a valid meta-transaction", async function () {
      const req = {
        from: user.address,
        to: await target.getAddress(),
        value: value,
        gas: gas,
        nonce: nonce,
        deadline: deadline,
        data: "0x"
      };

      const digest = await relayer._hashTypedData(req);
      signature = await user.signMessage(ethers.getBytes(digest));

      const tx = await relayer.execute(req, signature, { value: value });
      const receipt = await tx.wait();

      expect(receipt.status).to.equal(1);
      expect(await relayer.nonces(user.address)).to.equal(1n);

      const event = receipt.logs.find(log => log.fragment.name === "MetaTxExecuted");
      expect(event.args.from).to.equal(user.address);
      expect(event.args.to).to.equal(await target.getAddress());
      expect(event.args.success).to.be.true;
    });

    it("Should revert if request is expired", async function () {
      const expiredDeadline = (await ethers.provider.getBlock("latest")).timestamp - 1;
      const req = {
        from: user.address,
        to: await target.getAddress(),
        value: value,
        gas: gas,
        nonce: nonce,
        deadline: expiredDeadline,
        data: "0x"
      };

      const digest = await relayer._hashTypedData(req);
      signature = await user.signMessage(ethers.getBytes(digest));

      await expect(relayer.execute(req, signature, { value: value }))
        .to.be.revertedWith("Request expired");
    });

    it("Should revert if nonce is invalid", async function () {
      const req = {
        from: user.address,
        to: await target.getAddress(),
        value: value,
        gas: gas,
        nonce: 1n, // Invalid nonce
        deadline: deadline,
        data: "0x"
      };

      const digest = await relayer._hashTypedData(req);
      signature = await user.signMessage(ethers.getBytes(digest));

      await expect(relayer.execute(req, signature, { value: value }))
        .to.be.revertedWith("Bad nonce");
    });

    it("Should revert if signature is invalid", async function () {
      const req = {
        from: user.address,
        to: await target.getAddress(),
        value: value,
        gas: gas,
        nonce: nonce,
        deadline: deadline,
        data: "0x"
      };

      const digest = await relayer._hashTypedData(req);
      // Sign with wrong signer
      signature = await owner.signMessage(ethers.getBytes(digest));

      await expect(relayer.execute(req, signature, { value: value }))
        .to.be.revertedWith("Bad signature");
    });

    it("Should increment nonce after successful execution", async function () {
      const req1 = {
        from: user.address,
        to: await target.getAddress(),
        value: value,
        gas: gas,
        nonce: nonce,
        deadline: deadline,
        data: "0x"
      };

      const digest1 = await relayer._hashTypedData(req1);
      signature = await user.signMessage(ethers.getBytes(digest1));

      await relayer.execute(req1, signature, { value: value });
      expect(await relayer.nonces(user.address)).to.equal(1n);

      const req2 = {
        from: user.address,
        to: await target.getAddress(),
        value: value,
        gas: gas,
        nonce: 1n, // Next nonce
        deadline: deadline,
        data: "0x"
      };

      const digest2 = await relayer._hashTypedData(req2);
      signature = await user.signMessage(ethers.getBytes(digest2));

      await relayer.execute(req2, signature, { value: value });
      expect(await relayer.nonces(user.address)).to.equal(2n);
    });
  });

  describe("verify", function () {
    it("Should verify a valid signature", async function () {
      const req = {
        from: user.address,
        to: await target.getAddress(),
        value: value,
        gas: gas,
        nonce: nonce,
        deadline: deadline,
        data: "0x"
      };

      const digest = await relayer._hashTypedData(req);
      signature = await user.signMessage(ethers.getBytes(digest));

      expect(await relayer.verify(req, signature)).to.be.true;
    });

    it("Should reject an invalid signature", async function () {
      const req = {
        from: user.address,
        to: await target.getAddress(),
        value: value,
        gas: gas,
        nonce: nonce,
        deadline: deadline,
        data: "0x"
      };

      const digest = await relayer._hashTypedData(req);
      // Sign with wrong signer
      signature = await owner.signMessage(ethers.getBytes(digest));

      expect(await relayer.verify(req, signature)).to.be.false;
    });
  });
});