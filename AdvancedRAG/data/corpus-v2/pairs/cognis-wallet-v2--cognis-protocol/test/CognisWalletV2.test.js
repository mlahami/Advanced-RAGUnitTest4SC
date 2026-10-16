const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const LIMIT = ethers.parseEther("50");
const FUNDING = ethers.parseEther("1000");
const HOUR = 60 * 60;

async function deployWalletFixture() {
  const [deployer, owner, agent, payee, outsider, ops, founder] = await ethers.getSigners();

  const token = await (await ethers.getContractFactory("CognisTokenV2")).deploy(
    deployer.address,
    ops.address,
    founder.address
  );
  const wallet = await (await ethers.getContractFactory("CognisWalletV2")).deploy(
    await token.getAddress(),
    agent.address,
    LIMIT,
    owner.address
  );

  await token.connect(deployer).transfer(await wallet.getAddress(), FUNDING);
  return { token, wallet, deployer, owner, agent, payee, outsider };
}

/** Issues an over-limit approval and returns the nonce it was given. */
async function approve(wallet, owner, to, amount) {
  await wallet.connect(owner).approveOverLimit(to, amount);
  return wallet.approvalNonce();
}

describe("CognisWalletV2", function () {
  describe("deployment", function () {
    it("stores the configuration and sets the owner explicitly", async function () {
      const { wallet, token, owner, agent } = await loadFixture(deployWalletFixture);
      expect(await wallet.token()).to.equal(await token.getAddress());
      expect(await wallet.agent()).to.equal(agent.address);
      expect(await wallet.dailyLimit()).to.equal(LIMIT);
      expect(await wallet.owner()).to.equal(owner.address);
      expect(await wallet.spentToday()).to.equal(0n);
      expect(await wallet.remainingToday()).to.equal(LIMIT);
      expect(await wallet.approvalNonce()).to.equal(0n);
      expect(await wallet.APPROVAL_VALIDITY()).to.equal(BigInt(HOUR));
    });

    it("rejects zero addresses", async function () {
      const { wallet, token, agent, owner } = await loadFixture(deployWalletFixture);
      const factory = await ethers.getContractFactory("CognisWalletV2");
      await expect(
        factory.deploy(ethers.ZeroAddress, agent.address, LIMIT, owner.address)
      ).to.be.revertedWithCustomError(wallet, "ZeroAddress");
      await expect(
        factory.deploy(await token.getAddress(), ethers.ZeroAddress, LIMIT, owner.address)
      ).to.be.revertedWithCustomError(wallet, "ZeroAddress");
    });
  });

  describe("daily limit", function () {
    it("lets the agent spend inside the limit", async function () {
      const { wallet, token, agent, payee } = await loadFixture(deployWalletFixture);
      const amount = ethers.parseEther("30");

      await expect(wallet.connect(agent).agentSpend(payee.address, amount))
        .to.emit(wallet, "AgentSpent")
        .withArgs(payee.address, amount, false);

      expect(await token.balanceOf(payee.address)).to.equal(amount);
      expect(await wallet.spentToday()).to.equal(amount);
      expect(await wallet.remainingToday()).to.equal(LIMIT - amount);
    });

    it("reverts above the limit without an owner approval", async function () {
      const { wallet, agent, payee } = await loadFixture(deployWalletFixture);
      await wallet.connect(agent).agentSpend(payee.address, ethers.parseEther("40"));
      await expect(
        wallet.connect(agent).agentSpend(payee.address, ethers.parseEther("20"))
      ).to.be.revertedWithCustomError(wallet, "OverDailyLimit");
    });

    it("resets the counter after 24 hours", async function () {
      const { wallet, agent, payee } = await loadFixture(deployWalletFixture);
      await wallet.connect(agent).agentSpend(payee.address, ethers.parseEther("45"));

      await time.increase(24 * 60 * 60 + 1);
      expect(await wallet.remainingToday()).to.equal(LIMIT);

      await wallet.connect(agent).agentSpend(payee.address, ethers.parseEther("30"));
      expect(await wallet.spentToday()).to.equal(ethers.parseEther("30"));
    });
  });

  describe("over-limit approvals (nonce + expiry)", function () {
    it("accepts an over-limit spend once, against its own nonce", async function () {
      const { wallet, token, owner, agent, payee } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("20");

      await wallet.connect(agent).agentSpend(payee.address, ethers.parseEther("40"));

      const tx = wallet.connect(owner).approveOverLimit(payee.address, big);
      await expect(tx).to.emit(wallet, "OverLimitApproved");
      const nonce = await wallet.approvalNonce();
      expect(nonce).to.equal(1n);
      expect(await wallet.approvedOverLimit(await wallet.approvalKey(payee.address, big, nonce))).to.be.greaterThan(0n);
      expect(await wallet.approvalTimeLeft(payee.address, big, nonce)).to.be.greaterThan(0n);

      await expect(wallet.connect(agent).agentSpendApproved(payee.address, big, nonce))
        .to.emit(wallet, "AgentSpent")
        .withArgs(payee.address, big, true);

      expect(await token.balanceOf(payee.address)).to.equal(ethers.parseEther("60"));
      expect(await wallet.spentToday()).to.equal(ethers.parseEther("60"));
    });

    it("cannot be replayed: the approval is consumed on first use", async function () {
      const { wallet, owner, agent, payee } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("60");
      const nonce = await approve(wallet, owner, payee.address, big);

      await wallet.connect(agent).agentSpendApproved(payee.address, big, nonce);
      expect(await wallet.approvedOverLimit(await wallet.approvalKey(payee.address, big, nonce))).to.equal(0n);
      expect(await wallet.approvalTimeLeft(payee.address, big, nonce)).to.equal(0n);

      await expect(
        wallet.connect(agent).agentSpendApproved(payee.address, big, nonce)
      ).to.be.revertedWithCustomError(wallet, "UnknownApproval");
    });

    it("expires one hour after it was issued", async function () {
      const { wallet, owner, agent, payee } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("60");
      const nonce = await approve(wallet, owner, payee.address, big);

      await time.increase(HOUR + 1);
      expect(await wallet.approvalTimeLeft(payee.address, big, nonce)).to.equal(0n);
      await expect(
        wallet.connect(agent).agentSpendApproved(payee.address, big, nonce)
      ).to.be.revertedWithCustomError(wallet, "ApprovalExpired");
    });

    it("is still usable just before it expires", async function () {
      const { wallet, owner, agent, payee } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("60");
      const nonce = await approve(wallet, owner, payee.address, big);

      await time.increase(HOUR - 60);
      await expect(wallet.connect(agent).agentSpendApproved(payee.address, big, nonce)).to.emit(wallet, "AgentSpent");
    });

    it("gives every approval a fresh nonce, so an old one cannot stand in for a new one", async function () {
      const { wallet, owner, agent, payee } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("60");

      const first = await approve(wallet, owner, payee.address, big);
      const second = await approve(wallet, owner, payee.address, big);
      expect(second).to.equal(first + 1n);

      await wallet.connect(agent).agentSpendApproved(payee.address, big, first);
      await wallet.connect(agent).agentSpendApproved(payee.address, big, second);
      await expect(
        wallet.connect(agent).agentSpendApproved(payee.address, big, second + 1n)
      ).to.be.revertedWithCustomError(wallet, "UnknownApproval");
    });

    it("matches the approval to the exact recipient, amount and nonce", async function () {
      const { wallet, owner, agent, payee, outsider } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("60");
      const nonce = await approve(wallet, owner, payee.address, big);

      for (const call of [
        () => wallet.connect(agent).agentSpendApproved(outsider.address, big, nonce),
        () => wallet.connect(agent).agentSpendApproved(payee.address, big + 1n, nonce),
        () => wallet.connect(agent).agentSpendApproved(payee.address, big, nonce + 1n)
      ]) {
        await expect(call()).to.be.revertedWithCustomError(wallet, "UnknownApproval");
      }

      expect(await wallet.approvedOverLimit(await wallet.approvalKey(payee.address, big, nonce))).to.be.greaterThan(0n);
    });

    it("does not let the unattended path spend an approval", async function () {
      const { wallet, owner, agent, payee } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("60");
      await approve(wallet, owner, payee.address, big);

      await expect(wallet.connect(agent).agentSpend(payee.address, big)).to.be.revertedWithCustomError(
        wallet,
        "OverDailyLimit"
      );
    });

    it("lets the owner revoke an unused approval", async function () {
      const { wallet, owner, agent, payee } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("60");
      const nonce = await approve(wallet, owner, payee.address, big);

      await expect(wallet.connect(owner).revokeOverLimit(payee.address, big, nonce)).to.emit(
        wallet,
        "OverLimitRevoked"
      );
      await expect(
        wallet.connect(agent).agentSpendApproved(payee.address, big, nonce)
      ).to.be.revertedWithCustomError(wallet, "UnknownApproval");
      await expect(
        wallet.connect(owner).revokeOverLimit(payee.address, big, nonce)
      ).to.be.revertedWithCustomError(wallet, "UnknownApproval");
    });

    it("counts an over-limit spend towards the same daily window", async function () {
      const { wallet, owner, agent, payee } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("60");
      const nonce = await approve(wallet, owner, payee.address, big);

      await wallet.connect(agent).agentSpendApproved(payee.address, big, nonce);
      expect(await wallet.spentToday()).to.equal(big);
      expect(await wallet.remainingToday()).to.equal(0n);
    });
  });

  describe("access control", function () {
    it("blocks strangers and bad parameters", async function () {
      const { wallet, agent, payee, outsider } = await loadFixture(deployWalletFixture);
      await expect(
        wallet.connect(outsider).agentSpend(payee.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(wallet, "NotAuthorized");
      await expect(
        wallet.connect(outsider).agentSpendApproved(payee.address, ethers.parseEther("1"), 1n)
      ).to.be.revertedWithCustomError(wallet, "NotAuthorized");
      await expect(wallet.connect(agent).agentSpend(ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(
        wallet,
        "ZeroAddress"
      );
      await expect(wallet.connect(agent).agentSpend(payee.address, 0)).to.be.revertedWithCustomError(
        wallet,
        "InvalidAmount"
      );
      await expect(
        wallet.connect(agent).agentSpendApproved(ethers.ZeroAddress, 1n, 1n)
      ).to.be.revertedWithCustomError(wallet, "ZeroAddress");
      await expect(wallet.connect(agent).agentSpendApproved(payee.address, 0, 1n)).to.be.revertedWithCustomError(
        wallet,
        "InvalidAmount"
      );
    });

    it("lets the owner spend through the same entry point", async function () {
      const { wallet, token, owner, payee } = await loadFixture(deployWalletFixture);
      await wallet.connect(owner).agentSpend(payee.address, ethers.parseEther("10"));
      expect(await token.balanceOf(payee.address)).to.equal(ethers.parseEther("10"));
    });

    it("lets the owner withdraw without any limit and logs it", async function () {
      const { wallet, token, owner, outsider, payee } = await loadFixture(deployWalletFixture);
      await expect(wallet.connect(owner).ownerWithdraw(payee.address, FUNDING))
        .to.emit(wallet, "OwnerWithdrawal")
        .withArgs(payee.address, FUNDING);
      expect(await token.balanceOf(payee.address)).to.equal(FUNDING);

      await expect(wallet.connect(outsider).ownerWithdraw(outsider.address, 1n)).to.be.revertedWithCustomError(
        wallet,
        "OwnableUnauthorizedAccount"
      );
    });

    it("keeps agent, limit and approval changes to the owner", async function () {
      const { wallet, owner, agent, outsider } = await loadFixture(deployWalletFixture);

      await expect(wallet.connect(outsider).setAgent(outsider.address)).to.be.revertedWithCustomError(
        wallet,
        "OwnableUnauthorizedAccount"
      );
      await expect(wallet.connect(outsider).setDailyLimit(1n)).to.be.revertedWithCustomError(
        wallet,
        "OwnableUnauthorizedAccount"
      );
      await expect(wallet.connect(outsider).approveOverLimit(outsider.address, 1n)).to.be.revertedWithCustomError(
        wallet,
        "OwnableUnauthorizedAccount"
      );
      await expect(wallet.connect(outsider).revokeOverLimit(outsider.address, 1n, 1n)).to.be.revertedWithCustomError(
        wallet,
        "OwnableUnauthorizedAccount"
      );

      await expect(wallet.connect(owner).setAgent(outsider.address))
        .to.emit(wallet, "AgentChanged")
        .withArgs(agent.address, outsider.address);
      await expect(wallet.connect(owner).setDailyLimit(ethers.parseEther("5")))
        .to.emit(wallet, "LimitChanged")
        .withArgs(LIMIT, ethers.parseEther("5"));

      expect(await wallet.agent()).to.equal(outsider.address);
      expect(await wallet.dailyLimit()).to.equal(ethers.parseEther("5"));
    });

    it("hands ownership over in two steps", async function () {
      const { wallet, owner, outsider } = await loadFixture(deployWalletFixture);
      await wallet.connect(owner).transferOwnership(outsider.address);
      expect(await wallet.owner()).to.equal(owner.address);
      await wallet.connect(outsider).acceptOwnership();
      expect(await wallet.owner()).to.equal(outsider.address);
    });
  });
});
