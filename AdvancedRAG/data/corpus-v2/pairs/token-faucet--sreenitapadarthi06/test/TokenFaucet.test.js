const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");

describe("AquaToken & TokenFaucet", function () {
  // ───────────────────── Fixture ─────────────────────
  async function deployFixture() {
    const [admin, user1, user2, attacker] = await ethers.getSigners();

    // Deploy Faucet first to get its address, then deploy Token pointing to it
    // We use a deterministic approach: compute faucet address before deploying
    const nonce = await ethers.provider.getTransactionCount(admin.address);
    const faucetFutureAddr = ethers.getCreateAddress({
      from: admin.address,
      nonce: nonce + 1, // Token deploys at nonce, Faucet at nonce+1
    });

    const Token = await ethers.getContractFactory("AquaToken");
    const token = await Token.deploy(faucetFutureAddr);
    await token.waitForDeployment();

    const Faucet = await ethers.getContractFactory("TokenFaucet");
    const faucet = await Faucet.deploy(await token.getAddress());
    await faucet.waitForDeployment();

    // Sanity: faucet address should match what we predicted
    expect(await faucet.getAddress()).to.equal(faucetFutureAddr);

    const FAUCET_AMOUNT = await faucet.FAUCET_AMOUNT();
    const COOLDOWN_TIME = await faucet.COOLDOWN_TIME();
    const MAX_CLAIM_AMOUNT = await faucet.MAX_CLAIM_AMOUNT();
    const MAX_SUPPLY = await token.MAX_SUPPLY();

    return {
      token,
      faucet,
      admin,
      user1,
      user2,
      attacker,
      FAUCET_AMOUNT,
      COOLDOWN_TIME,
      MAX_CLAIM_AMOUNT,
      MAX_SUPPLY,
    };
  }

  // ───────────────────── Token Tests ─────────────────────
  describe("AquaToken", function () {
    it("Should have correct name and symbol", async function () {
      const { token } = await loadFixture(deployFixture);
      expect(await token.name()).to.equal("AquaToken");
      expect(await token.symbol()).to.equal("AQUA");
    });

    it("Should have 18 decimals", async function () {
      const { token } = await loadFixture(deployFixture);
      expect(await token.decimals()).to.equal(18);
    });

    it("Should have zero initial supply", async function () {
      const { token } = await loadFixture(deployFixture);
      expect(await token.totalSupply()).to.equal(0);
    });

    it("Should have correct MAX_SUPPLY", async function () {
      const { token, MAX_SUPPLY } = await loadFixture(deployFixture);
      expect(MAX_SUPPLY).to.equal(ethers.parseEther("1000000"));
    });

    it("Should set minter to faucet address", async function () {
      const { token, faucet } = await loadFixture(deployFixture);
      expect(await token.minter()).to.equal(await faucet.getAddress());
    });

    it("Should not allow non-minter to mint", async function () {
      const { token, user1 } = await loadFixture(deployFixture);
      await expect(
        token.connect(user1).mint(user1.address, 1000)
      ).to.be.revertedWith("AquaToken: caller is not the minter");
    });

    it("Should not allow admin to mint directly", async function () {
      const { token, admin } = await loadFixture(deployFixture);
      await expect(
        token.connect(admin).mint(admin.address, 1000)
      ).to.be.revertedWith("AquaToken: caller is not the minter");
    });

    it("Should allow admin to update minter", async function () {
      const { token, admin, user1 } = await loadFixture(deployFixture);
      await token.connect(admin).setMinter(user1.address);
      expect(await token.minter()).to.equal(user1.address);
    });

    it("Should not allow non-admin to update minter", async function () {
      const { token, user1 } = await loadFixture(deployFixture);
      await expect(
        token.connect(user1).setMinter(user1.address)
      ).to.be.revertedWith("AquaToken: caller is not the admin");
    });

    it("Should not allow setting minter to zero address", async function () {
      const { token, admin } = await loadFixture(deployFixture);
      await expect(
        token.connect(admin).setMinter(ethers.ZeroAddress)
      ).to.be.revertedWith("AquaToken: minter is zero address");
    });

    it("Should support standard ERC-20 transfer", async function () {
      const { token, faucet, user1, user2, FAUCET_AMOUNT } =
        await loadFixture(deployFixture);

      // User1 claims first
      await faucet.connect(user1).requestTokens();

      // Transfer tokens from user1 to user2
      const transferAmount = ethers.parseEther("10");
      await token.connect(user1).transfer(user2.address, transferAmount);

      expect(await token.balanceOf(user2.address)).to.equal(transferAmount);
      expect(await token.balanceOf(user1.address)).to.equal(
        FAUCET_AMOUNT - transferAmount
      );
    });

    it("Should support approve and transferFrom", async function () {
      const { token, faucet, user1, user2, FAUCET_AMOUNT } =
        await loadFixture(deployFixture);

      await faucet.connect(user1).requestTokens();

      const approveAmount = ethers.parseEther("50");
      await token.connect(user1).approve(user2.address, approveAmount);
      expect(await token.allowance(user1.address, user2.address)).to.equal(
        approveAmount
      );

      await token
        .connect(user2)
        .transferFrom(user1.address, user2.address, approveAmount);
      expect(await token.balanceOf(user2.address)).to.equal(approveAmount);
    });

    it("Should emit Transfer event on mint", async function () {
      const { token, faucet, user1, FAUCET_AMOUNT } =
        await loadFixture(deployFixture);

      await expect(faucet.connect(user1).requestTokens())
        .to.emit(token, "Transfer")
        .withArgs(ethers.ZeroAddress, user1.address, FAUCET_AMOUNT);
    });
  });

  // ───────────────────── Faucet Tests ─────────────────────
  describe("TokenFaucet", function () {
    it("Should have correct constants", async function () {
      const { faucet, FAUCET_AMOUNT, COOLDOWN_TIME, MAX_CLAIM_AMOUNT } =
        await loadFixture(deployFixture);

      expect(FAUCET_AMOUNT).to.equal(ethers.parseEther("100"));
      expect(COOLDOWN_TIME).to.equal(86400); // 24 hours in seconds
      expect(MAX_CLAIM_AMOUNT).to.equal(ethers.parseEther("1000"));
    });

    it("Should set admin to deployer", async function () {
      const { faucet, admin } = await loadFixture(deployFixture);
      expect(await faucet.admin()).to.equal(admin.address);
    });

    it("Should start unpaused", async function () {
      const { faucet } = await loadFixture(deployFixture);
      expect(await faucet.isPaused()).to.equal(false);
    });

    // ── Successful Claims ──
    describe("Successful Claims", function () {
      it("Should allow first-time claim", async function () {
        const { faucet, token, user1, FAUCET_AMOUNT } =
          await loadFixture(deployFixture);

        await faucet.connect(user1).requestTokens();
        expect(await token.balanceOf(user1.address)).to.equal(FAUCET_AMOUNT);
      });

      it("Should update lastClaimAt after claim", async function () {
        const { faucet, user1 } = await loadFixture(deployFixture);

        const tx = await faucet.connect(user1).requestTokens();
        const block = await tx.getBlock();

        expect(await faucet.lastClaimAt(user1.address)).to.equal(
          block.timestamp
        );
      });

      it("Should update totalClaimed after claim", async function () {
        const { faucet, user1, FAUCET_AMOUNT } =
          await loadFixture(deployFixture);

        await faucet.connect(user1).requestTokens();
        expect(await faucet.totalClaimed(user1.address)).to.equal(
          FAUCET_AMOUNT
        );
      });

      it("Should emit TokensClaimed event", async function () {
        const { faucet, user1, FAUCET_AMOUNT } =
          await loadFixture(deployFixture);

        await expect(faucet.connect(user1).requestTokens())
          .to.emit(faucet, "TokensClaimed")
          .withArgs(user1.address, FAUCET_AMOUNT, (v) => v > 0);
      });

      it("Should allow claim after cooldown", async function () {
        const { faucet, token, user1, FAUCET_AMOUNT, COOLDOWN_TIME } =
          await loadFixture(deployFixture);

        await faucet.connect(user1).requestTokens();

        // Fast-forward 24 hours
        await time.increase(Number(COOLDOWN_TIME));

        await faucet.connect(user1).requestTokens();
        expect(await token.balanceOf(user1.address)).to.equal(
          FAUCET_AMOUNT * 2n
        );
      });

      it("Should allow multiple users to claim independently", async function () {
        const { faucet, token, user1, user2, FAUCET_AMOUNT } =
          await loadFixture(deployFixture);

        await faucet.connect(user1).requestTokens();
        await faucet.connect(user2).requestTokens();

        expect(await token.balanceOf(user1.address)).to.equal(FAUCET_AMOUNT);
        expect(await token.balanceOf(user2.address)).to.equal(FAUCET_AMOUNT);
      });
    });

    // ── Cooldown Enforcement ──
    describe("Cooldown Enforcement", function () {
      it("Should revert on immediate re-claim", async function () {
        const { faucet, user1 } = await loadFixture(deployFixture);

        await faucet.connect(user1).requestTokens();

        await expect(
          faucet.connect(user1).requestTokens()
        ).to.be.revertedWith("TokenFaucet: cooldown period not elapsed");
      });

      it("Should revert just before cooldown ends", async function () {
        const { faucet, user1, COOLDOWN_TIME } =
          await loadFixture(deployFixture);

        await faucet.connect(user1).requestTokens();

        // Fast-forward to 1 second before cooldown ends
        await time.increase(Number(COOLDOWN_TIME) - 2);

        await expect(
          faucet.connect(user1).requestTokens()
        ).to.be.revertedWith("TokenFaucet: cooldown period not elapsed");
      });

      it("Should allow claim exactly at cooldown boundary", async function () {
        const { faucet, user1, COOLDOWN_TIME } =
          await loadFixture(deployFixture);

        await faucet.connect(user1).requestTokens();

        await time.increase(Number(COOLDOWN_TIME));

        // Should succeed
        await expect(faucet.connect(user1).requestTokens()).to.not.be.reverted;
      });
    });

    // ── Lifetime Limit Enforcement ──
    describe("Lifetime Limit Enforcement", function () {
      it("Should allow claims up to lifetime limit", async function () {
        const {
          faucet,
          token,
          user1,
          FAUCET_AMOUNT,
          COOLDOWN_TIME,
          MAX_CLAIM_AMOUNT,
        } = await loadFixture(deployFixture);

        const maxClaims = Number(MAX_CLAIM_AMOUNT / FAUCET_AMOUNT); // 10

        for (let i = 0; i < maxClaims; i++) {
          if (i > 0) await time.increase(Number(COOLDOWN_TIME));
          await faucet.connect(user1).requestTokens();
        }

        expect(await token.balanceOf(user1.address)).to.equal(MAX_CLAIM_AMOUNT);
        expect(await faucet.totalClaimed(user1.address)).to.equal(
          MAX_CLAIM_AMOUNT
        );
      });

      it("Should revert when lifetime limit reached", async function () {
        const { faucet, user1, FAUCET_AMOUNT, COOLDOWN_TIME, MAX_CLAIM_AMOUNT } =
          await loadFixture(deployFixture);

        const maxClaims = Number(MAX_CLAIM_AMOUNT / FAUCET_AMOUNT);

        for (let i = 0; i < maxClaims; i++) {
          if (i > 0) await time.increase(Number(COOLDOWN_TIME));
          await faucet.connect(user1).requestTokens();
        }

        await time.increase(Number(COOLDOWN_TIME));

        await expect(
          faucet.connect(user1).requestTokens()
        ).to.be.revertedWith("TokenFaucet: lifetime claim limit reached");
      });

      it("Should return correct remainingAllowance", async function () {
        const { faucet, user1, FAUCET_AMOUNT, MAX_CLAIM_AMOUNT } =
          await loadFixture(deployFixture);

        expect(await faucet.remainingAllowance(user1.address)).to.equal(
          MAX_CLAIM_AMOUNT
        );

        await faucet.connect(user1).requestTokens();

        expect(await faucet.remainingAllowance(user1.address)).to.equal(
          MAX_CLAIM_AMOUNT - FAUCET_AMOUNT
        );
      });

      it("Should return 0 remainingAllowance when limit reached", async function () {
        const { faucet, user1, FAUCET_AMOUNT, COOLDOWN_TIME, MAX_CLAIM_AMOUNT } =
          await loadFixture(deployFixture);

        const maxClaims = Number(MAX_CLAIM_AMOUNT / FAUCET_AMOUNT);
        for (let i = 0; i < maxClaims; i++) {
          if (i > 0) await time.increase(Number(COOLDOWN_TIME));
          await faucet.connect(user1).requestTokens();
        }

        expect(await faucet.remainingAllowance(user1.address)).to.equal(0);
      });
    });

    // ── canClaim ──
    describe("canClaim", function () {
      it("Should return true for fresh address", async function () {
        const { faucet, user1 } = await loadFixture(deployFixture);
        expect(await faucet.canClaim(user1.address)).to.equal(true);
      });

      it("Should return false during cooldown", async function () {
        const { faucet, user1 } = await loadFixture(deployFixture);
        await faucet.connect(user1).requestTokens();
        expect(await faucet.canClaim(user1.address)).to.equal(false);
      });

      it("Should return true after cooldown", async function () {
        const { faucet, user1, COOLDOWN_TIME } =
          await loadFixture(deployFixture);
        await faucet.connect(user1).requestTokens();
        await time.increase(Number(COOLDOWN_TIME));
        expect(await faucet.canClaim(user1.address)).to.equal(true);
      });

      it("Should return false when lifetime limit reached", async function () {
        const { faucet, user1, FAUCET_AMOUNT, COOLDOWN_TIME, MAX_CLAIM_AMOUNT } =
          await loadFixture(deployFixture);

        const maxClaims = Number(MAX_CLAIM_AMOUNT / FAUCET_AMOUNT);
        for (let i = 0; i < maxClaims; i++) {
          if (i > 0) await time.increase(Number(COOLDOWN_TIME));
          await faucet.connect(user1).requestTokens();
        }

        await time.increase(Number(COOLDOWN_TIME));
        expect(await faucet.canClaim(user1.address)).to.equal(false);
      });

      it("Should return false when paused", async function () {
        const { faucet, admin, user1 } = await loadFixture(deployFixture);
        await faucet.connect(admin).setPaused(true);
        expect(await faucet.canClaim(user1.address)).to.equal(false);
      });
    });

    // ── Pause Mechanism ──
    describe("Pause Mechanism", function () {
      it("Should allow admin to pause", async function () {
        const { faucet, admin } = await loadFixture(deployFixture);
        await faucet.connect(admin).setPaused(true);
        expect(await faucet.isPaused()).to.equal(true);
      });

      it("Should emit FaucetPaused event on pause", async function () {
        const { faucet, admin } = await loadFixture(deployFixture);
        await expect(faucet.connect(admin).setPaused(true))
          .to.emit(faucet, "FaucetPaused")
          .withArgs(true);
      });

      it("Should allow admin to unpause", async function () {
        const { faucet, admin } = await loadFixture(deployFixture);
        await faucet.connect(admin).setPaused(true);
        await faucet.connect(admin).setPaused(false);
        expect(await faucet.isPaused()).to.equal(false);
      });

      it("Should emit FaucetPaused event on unpause", async function () {
        const { faucet, admin } = await loadFixture(deployFixture);
        await faucet.connect(admin).setPaused(true);
        await expect(faucet.connect(admin).setPaused(false))
          .to.emit(faucet, "FaucetPaused")
          .withArgs(false);
      });

      it("Should revert claim when paused", async function () {
        const { faucet, admin, user1 } = await loadFixture(deployFixture);
        await faucet.connect(admin).setPaused(true);

        await expect(
          faucet.connect(user1).requestTokens()
        ).to.be.revertedWith("TokenFaucet: faucet is currently paused");
      });

      it("Should not allow non-admin to pause", async function () {
        const { faucet, user1 } = await loadFixture(deployFixture);
        await expect(
          faucet.connect(user1).setPaused(true)
        ).to.be.revertedWith("TokenFaucet: caller is not the admin");
      });

      it("Should not allow non-admin to unpause", async function () {
        const { faucet, admin, attacker } = await loadFixture(deployFixture);
        await faucet.connect(admin).setPaused(true);
        await expect(
          faucet.connect(attacker).setPaused(false)
        ).to.be.revertedWith("TokenFaucet: caller is not the admin");
      });

      it("Should allow claims after unpause", async function () {
        const { faucet, token, admin, user1, FAUCET_AMOUNT } =
          await loadFixture(deployFixture);

        await faucet.connect(admin).setPaused(true);
        await faucet.connect(admin).setPaused(false);

        await faucet.connect(user1).requestTokens();
        expect(await token.balanceOf(user1.address)).to.equal(FAUCET_AMOUNT);
      });
    });

    // ── Edge Cases ──
    describe("Edge Cases", function () {
      it("Should handle zero balances for unclaimed addresses", async function () {
        const { token, user1 } = await loadFixture(deployFixture);
        expect(await token.balanceOf(user1.address)).to.equal(0);
      });

      it("Should track independent cooldowns per user", async function () {
        const { faucet, user1, user2 } = await loadFixture(deployFixture);

        await faucet.connect(user1).requestTokens();

        // user2 should still be able to claim
        expect(await faucet.canClaim(user2.address)).to.equal(true);
        await faucet.connect(user2).requestTokens();
      });

      it("Should track independent lifetime limits per user", async function () {
        const { faucet, user1, user2, FAUCET_AMOUNT, COOLDOWN_TIME, MAX_CLAIM_AMOUNT } =
          await loadFixture(deployFixture);

        // Exhaust user1's limit
        const maxClaims = Number(MAX_CLAIM_AMOUNT / FAUCET_AMOUNT);
        for (let i = 0; i < maxClaims; i++) {
          if (i > 0) await time.increase(Number(COOLDOWN_TIME));
          await faucet.connect(user1).requestTokens();
        }

        // user2 should still have full allowance
        expect(await faucet.remainingAllowance(user2.address)).to.equal(
          MAX_CLAIM_AMOUNT
        );
      });
    });
  });
});
