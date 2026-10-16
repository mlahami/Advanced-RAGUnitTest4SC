const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ExclusiveClaim", function () {
  let exclusiveClaim;
  let mockToken;
  let depositor;
  let claimant;
  let other;

  const ONE_HOUR = 60 * 60;
  const ONE_DAY = 24 * ONE_HOUR;
  const ETH_AMOUNT = ethers.parseEther("1");
  const TOKEN_AMOUNT = ethers.parseUnits("1000", 6); // USDC-like (6 decimals)
  const DEFAULT_TITLE = "Test Deposit";
  const IMMEDIATE = 0; // startTime = 0 means immediate claiming

  beforeEach(async function () {
    [depositor, claimant, other] = await ethers.getSigners();

    // Deploy ExclusiveClaim contract
    const ExclusiveClaimFactory = await ethers.getContractFactory("ExclusiveClaim");
    exclusiveClaim = await ExclusiveClaimFactory.deploy();

    // Deploy mock ERC20 token (USDC-like with 6 decimals)
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20Factory.deploy("Mock USDC", "MUSDC", 6);

    // Mint tokens to depositor
    await mockToken.mint(depositor.address, TOKEN_AMOUNT * 10n);
  });

  describe("ETH Deposits", function () {
    describe("depositETH", function () {
      it("should create an ETH deposit successfully", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        await expect(
          exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
            value: ETH_AMOUNT,
          })
        )
          .to.emit(exclusiveClaim, "DepositCreated")
          .withArgs(0, depositor.address, claimant.address, ethers.ZeroAddress, ETH_AMOUNT, IMMEDIATE, deadline, DEFAULT_TITLE);

        const deposit = await exclusiveClaim.getDeposit(0);
        expect(deposit.depositor).to.equal(depositor.address);
        expect(deposit.claimant).to.equal(claimant.address);
        expect(deposit.token).to.equal(ethers.ZeroAddress);
        expect(deposit.amount).to.equal(ETH_AMOUNT);
        expect(deposit.startTime).to.equal(IMMEDIATE);
        expect(deposit.deadline).to.equal(deadline);
        expect(deposit.claimed).to.equal(false);
        expect(deposit.title).to.equal(DEFAULT_TITLE);
      });

      it("should create deposit with startTime", async function () {
        const startTime = (await time.latest()) + ONE_HOUR;
        const deadline = (await time.latest()) + ONE_DAY;

        await exclusiveClaim.connect(depositor).depositETH(claimant.address, startTime, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });

        const deposit = await exclusiveClaim.getDeposit(0);
        expect(deposit.startTime).to.equal(startTime);
      });

      it("should increment deposit count", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        expect(await exclusiveClaim.depositCount()).to.equal(0);

        await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });
        expect(await exclusiveClaim.depositCount()).to.equal(1);

        await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });
        expect(await exclusiveClaim.depositCount()).to.equal(2);
      });

      it("should revert if amount is zero", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        await expect(
          exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
            value: 0,
          })
        ).to.be.revertedWithCustomError(exclusiveClaim, "ZeroAmount");
      });

      it("should revert if claimant is zero address", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        await expect(
          exclusiveClaim.connect(depositor).depositETH(ethers.ZeroAddress, IMMEDIATE, deadline, DEFAULT_TITLE, {
            value: ETH_AMOUNT,
          })
        ).to.be.revertedWithCustomError(exclusiveClaim, "ZeroClaimant");
      });

      it("should revert if deadline is in the past", async function () {
        const pastDeadline = (await time.latest()) - 1;

        await expect(
          exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, pastDeadline, DEFAULT_TITLE, {
            value: ETH_AMOUNT,
          })
        ).to.be.revertedWithCustomError(exclusiveClaim, "DeadlineNotInFuture");
      });

      it("should revert if deadline is current timestamp", async function () {
        const currentTime = await time.latest();

        await expect(
          exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, currentTime, DEFAULT_TITLE, {
            value: ETH_AMOUNT,
          })
        ).to.be.revertedWithCustomError(exclusiveClaim, "DeadlineNotInFuture");
      });

      it("should revert if startTime is after deadline", async function () {
        const deadline = (await time.latest()) + ONE_DAY;
        const startTime = deadline + ONE_HOUR; // startTime after deadline

        await expect(
          exclusiveClaim.connect(depositor).depositETH(claimant.address, startTime, deadline, DEFAULT_TITLE, {
            value: ETH_AMOUNT,
          })
        ).to.be.revertedWithCustomError(exclusiveClaim, "StartTimeAfterDeadline");
      });

      it("should allow startTime equal to deadline", async function () {
        const deadline = (await time.latest()) + ONE_DAY;
        const startTime = deadline; // startTime equals deadline

        await exclusiveClaim.connect(depositor).depositETH(claimant.address, startTime, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });

        const deposit = await exclusiveClaim.getDeposit(0);
        expect(deposit.startTime).to.equal(startTime);
      });

      it("should revert if title is too long", async function () {
        const deadline = (await time.latest()) + ONE_DAY;
        const longTitle = "a".repeat(129); // 129 chars, exceeds MAX_TITLE_LENGTH of 128

        await expect(
          exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, longTitle, {
            value: ETH_AMOUNT,
          })
        ).to.be.revertedWithCustomError(exclusiveClaim, "TitleTooLong");
      });
    });

    describe("claim (ETH)", function () {
      let deadline;
      let depositId;

      beforeEach(async function () {
        deadline = (await time.latest()) + ONE_DAY;
        const tx = await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });
        const receipt = await tx.wait();
        depositId = 0n;
      });

      it("should allow claimant to claim before deadline", async function () {
        const balanceBefore = await ethers.provider.getBalance(claimant.address);

        await expect(exclusiveClaim.connect(claimant).claim(depositId))
          .to.emit(exclusiveClaim, "Claimed")
          .withArgs(depositId, claimant.address);

        const balanceAfter = await ethers.provider.getBalance(claimant.address);
        // Account for gas, balance should increase by approximately ETH_AMOUNT
        expect(balanceAfter - balanceBefore).to.be.closeTo(ETH_AMOUNT, ethers.parseEther("0.01"));

        const deposit = await exclusiveClaim.getDeposit(depositId);
        expect(deposit.claimed).to.equal(true);
      });

      it("should allow claimant to claim after deadline", async function () {
        await time.increase(ONE_DAY + 1);

        await expect(exclusiveClaim.connect(claimant).claim(depositId))
          .to.emit(exclusiveClaim, "Claimed")
          .withArgs(depositId, claimant.address);
      });

      it("should revert if not claimant", async function () {
        await expect(
          exclusiveClaim.connect(other).claim(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "NotClaimant");
      });

      it("should revert if already claimed", async function () {
        await exclusiveClaim.connect(claimant).claim(depositId);

        await expect(
          exclusiveClaim.connect(claimant).claim(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "AlreadyClaimed");
      });

      it("should revert if deposit doesn't exist", async function () {
        await expect(
          exclusiveClaim.connect(claimant).claim(999)
        ).to.be.revertedWithCustomError(exclusiveClaim, "DepositNotFound");
      });
    });

    describe("claim with startTime", function () {
      it("should revert if claiming before startTime", async function () {
        const startTime = (await time.latest()) + ONE_HOUR;
        const deadline = (await time.latest()) + ONE_DAY;

        await exclusiveClaim.connect(depositor).depositETH(claimant.address, startTime, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });

        await expect(
          exclusiveClaim.connect(claimant).claim(0)
        ).to.be.revertedWithCustomError(exclusiveClaim, "ClaimNotYetAllowed");
      });

      it("should allow claiming exactly at startTime", async function () {
        const startTime = (await time.latest()) + ONE_HOUR;
        const deadline = (await time.latest()) + ONE_DAY;

        await exclusiveClaim.connect(depositor).depositETH(claimant.address, startTime, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });

        await time.increaseTo(startTime);

        await expect(exclusiveClaim.connect(claimant).claim(0))
          .to.emit(exclusiveClaim, "Claimed");
      });

      it("should allow claiming after startTime", async function () {
        const startTime = (await time.latest()) + ONE_HOUR;
        const deadline = (await time.latest()) + ONE_DAY;

        await exclusiveClaim.connect(depositor).depositETH(claimant.address, startTime, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });

        await time.increaseTo(startTime + 1);

        await expect(exclusiveClaim.connect(claimant).claim(0))
          .to.emit(exclusiveClaim, "Claimed");
      });

      it("should allow immediate claiming when startTime is 0", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });

        await expect(exclusiveClaim.connect(claimant).claim(0))
          .to.emit(exclusiveClaim, "Claimed");
      });
    });

    describe("refund (ETH)", function () {
      let deadline;
      let depositId;

      beforeEach(async function () {
        deadline = (await time.latest()) + ONE_DAY;
        await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });
        depositId = 0n;
      });

      it("should allow depositor to refund after deadline", async function () {
        await time.increase(ONE_DAY + 1);

        const balanceBefore = await ethers.provider.getBalance(depositor.address);

        await expect(exclusiveClaim.connect(depositor).refund(depositId))
          .to.emit(exclusiveClaim, "Refunded")
          .withArgs(depositId, depositor.address);

        const balanceAfter = await ethers.provider.getBalance(depositor.address);
        expect(balanceAfter - balanceBefore).to.be.closeTo(ETH_AMOUNT, ethers.parseEther("0.01"));

        const deposit = await exclusiveClaim.getDeposit(depositId);
        expect(deposit.claimed).to.equal(true);
      });

      it("should revert if deadline not reached", async function () {
        await expect(
          exclusiveClaim.connect(depositor).refund(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "DeadlineNotReached");
      });

      it("should revert if not depositor", async function () {
        await time.increase(ONE_DAY + 1);

        await expect(
          exclusiveClaim.connect(other).refund(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "NotDepositor");
      });

      it("should revert if already claimed", async function () {
        await exclusiveClaim.connect(claimant).claim(depositId);
        await time.increase(ONE_DAY + 1);

        await expect(
          exclusiveClaim.connect(depositor).refund(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "AlreadyClaimed");
      });

      it("should revert if already refunded", async function () {
        await time.increase(ONE_DAY + 1);
        await exclusiveClaim.connect(depositor).refund(depositId);

        await expect(
          exclusiveClaim.connect(depositor).refund(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "AlreadyClaimed");
      });
    });
  });

  describe("ERC20 Token Deposits", function () {
    describe("depositToken", function () {
      it("should create a token deposit successfully", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        // Approve tokens first
        await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);

        await expect(
          exclusiveClaim.connect(depositor).depositToken(
            claimant.address,
            await mockToken.getAddress(),
            TOKEN_AMOUNT,
            IMMEDIATE,
            deadline,
            DEFAULT_TITLE
          )
        )
          .to.emit(exclusiveClaim, "DepositCreated")
          .withArgs(
            0,
            depositor.address,
            claimant.address,
            await mockToken.getAddress(),
            TOKEN_AMOUNT,
            IMMEDIATE,
            deadline,
            DEFAULT_TITLE
          );

        const deposit = await exclusiveClaim.getDeposit(0);
        expect(deposit.depositor).to.equal(depositor.address);
        expect(deposit.claimant).to.equal(claimant.address);
        expect(deposit.token).to.equal(await mockToken.getAddress());
        expect(deposit.amount).to.equal(TOKEN_AMOUNT);
        expect(deposit.startTime).to.equal(IMMEDIATE);
        expect(deposit.title).to.equal(DEFAULT_TITLE);

        // Contract should hold the tokens
        expect(await mockToken.balanceOf(await exclusiveClaim.getAddress())).to.equal(TOKEN_AMOUNT);
      });

      it("should create token deposit with startTime", async function () {
        const startTime = (await time.latest()) + ONE_HOUR;
        const deadline = (await time.latest()) + ONE_DAY;

        await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);
        await exclusiveClaim.connect(depositor).depositToken(
          claimant.address,
          await mockToken.getAddress(),
          TOKEN_AMOUNT,
          startTime,
          deadline,
          DEFAULT_TITLE
        );

        const deposit = await exclusiveClaim.getDeposit(0);
        expect(deposit.startTime).to.equal(startTime);
      });

      it("should revert if amount is zero", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        await expect(
          exclusiveClaim.connect(depositor).depositToken(
            claimant.address,
            await mockToken.getAddress(),
            0,
            IMMEDIATE,
            deadline,
            DEFAULT_TITLE
          )
        ).to.be.revertedWithCustomError(exclusiveClaim, "ZeroAmount");
      });

      it("should revert if claimant is zero address", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        await expect(
          exclusiveClaim.connect(depositor).depositToken(
            ethers.ZeroAddress,
            await mockToken.getAddress(),
            TOKEN_AMOUNT,
            IMMEDIATE,
            deadline,
            DEFAULT_TITLE
          )
        ).to.be.revertedWithCustomError(exclusiveClaim, "ZeroClaimant");
      });

      it("should revert if token is zero address", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        await expect(
          exclusiveClaim.connect(depositor).depositToken(
            claimant.address,
            ethers.ZeroAddress,
            TOKEN_AMOUNT,
            IMMEDIATE,
            deadline,
            DEFAULT_TITLE
          )
        ).to.be.revertedWithCustomError(exclusiveClaim, "InvalidETHAmount");
      });

      it("should revert if deadline is in the past", async function () {
        const pastDeadline = (await time.latest()) - 1;

        await expect(
          exclusiveClaim.connect(depositor).depositToken(
            claimant.address,
            await mockToken.getAddress(),
            TOKEN_AMOUNT,
            IMMEDIATE,
            pastDeadline,
            DEFAULT_TITLE
          )
        ).to.be.revertedWithCustomError(exclusiveClaim, "DeadlineNotInFuture");
      });

      it("should revert if startTime is after deadline", async function () {
        const deadline = (await time.latest()) + ONE_DAY;
        const startTime = deadline + ONE_HOUR;

        await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);

        await expect(
          exclusiveClaim.connect(depositor).depositToken(
            claimant.address,
            await mockToken.getAddress(),
            TOKEN_AMOUNT,
            startTime,
            deadline,
            DEFAULT_TITLE
          )
        ).to.be.revertedWithCustomError(exclusiveClaim, "StartTimeAfterDeadline");
      });

      it("should revert if not approved", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        await expect(
          exclusiveClaim.connect(depositor).depositToken(
            claimant.address,
            await mockToken.getAddress(),
            TOKEN_AMOUNT,
            IMMEDIATE,
            deadline,
            DEFAULT_TITLE
          )
        ).to.be.reverted;
      });

      it("should revert if title is too long", async function () {
        const deadline = (await time.latest()) + ONE_DAY;
        const longTitle = "a".repeat(129); // 129 chars, exceeds MAX_TITLE_LENGTH of 128

        await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);

        await expect(
          exclusiveClaim.connect(depositor).depositToken(
            claimant.address,
            await mockToken.getAddress(),
            TOKEN_AMOUNT,
            IMMEDIATE,
            deadline,
            longTitle
          )
        ).to.be.revertedWithCustomError(exclusiveClaim, "TitleTooLong");
      });
    });

    describe("claim (ERC20)", function () {
      let deadline;
      let depositId;

      beforeEach(async function () {
        deadline = (await time.latest()) + ONE_DAY;
        await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);
        await exclusiveClaim.connect(depositor).depositToken(
          claimant.address,
          await mockToken.getAddress(),
          TOKEN_AMOUNT,
          IMMEDIATE,
          deadline,
          DEFAULT_TITLE
        );
        depositId = 0n;
      });

      it("should allow claimant to claim tokens before deadline", async function () {
        const balanceBefore = await mockToken.balanceOf(claimant.address);

        await expect(exclusiveClaim.connect(claimant).claim(depositId))
          .to.emit(exclusiveClaim, "Claimed")
          .withArgs(depositId, claimant.address);

        const balanceAfter = await mockToken.balanceOf(claimant.address);
        expect(balanceAfter - balanceBefore).to.equal(TOKEN_AMOUNT);

        const deposit = await exclusiveClaim.getDeposit(depositId);
        expect(deposit.claimed).to.equal(true);
      });

      it("should allow claimant to claim tokens after deadline", async function () {
        await time.increase(ONE_DAY + 1);

        await expect(exclusiveClaim.connect(claimant).claim(depositId))
          .to.emit(exclusiveClaim, "Claimed")
          .withArgs(depositId, claimant.address);

        expect(await mockToken.balanceOf(claimant.address)).to.equal(TOKEN_AMOUNT);
      });

      it("should revert if not claimant", async function () {
        await expect(
          exclusiveClaim.connect(other).claim(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "NotClaimant");
      });
    });

    describe("claim (ERC20) with startTime", function () {
      it("should revert if claiming before startTime", async function () {
        const startTime = (await time.latest()) + ONE_HOUR;
        const deadline = (await time.latest()) + ONE_DAY;

        await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);
        await exclusiveClaim.connect(depositor).depositToken(
          claimant.address,
          await mockToken.getAddress(),
          TOKEN_AMOUNT,
          startTime,
          deadline,
          DEFAULT_TITLE
        );

        await expect(
          exclusiveClaim.connect(claimant).claim(0)
        ).to.be.revertedWithCustomError(exclusiveClaim, "ClaimNotYetAllowed");
      });

      it("should allow claiming after startTime", async function () {
        const startTime = (await time.latest()) + ONE_HOUR;
        const deadline = (await time.latest()) + ONE_DAY;

        await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);
        await exclusiveClaim.connect(depositor).depositToken(
          claimant.address,
          await mockToken.getAddress(),
          TOKEN_AMOUNT,
          startTime,
          deadline,
          DEFAULT_TITLE
        );

        await time.increaseTo(startTime + 1);

        await expect(exclusiveClaim.connect(claimant).claim(0))
          .to.emit(exclusiveClaim, "Claimed");
      });
    });

    describe("refund (ERC20)", function () {
      let deadline;
      let depositId;
      let depositorInitialBalance;

      beforeEach(async function () {
        deadline = (await time.latest()) + ONE_DAY;
        depositorInitialBalance = await mockToken.balanceOf(depositor.address);

        await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);
        await exclusiveClaim.connect(depositor).depositToken(
          claimant.address,
          await mockToken.getAddress(),
          TOKEN_AMOUNT,
          IMMEDIATE,
          deadline,
          DEFAULT_TITLE
        );
        depositId = 0n;
      });

      it("should allow depositor to refund tokens after deadline", async function () {
        await time.increase(ONE_DAY + 1);

        const balanceBefore = await mockToken.balanceOf(depositor.address);

        await expect(exclusiveClaim.connect(depositor).refund(depositId))
          .to.emit(exclusiveClaim, "Refunded")
          .withArgs(depositId, depositor.address);

        const balanceAfter = await mockToken.balanceOf(depositor.address);
        expect(balanceAfter - balanceBefore).to.equal(TOKEN_AMOUNT);
      });

      it("should revert if deadline not reached", async function () {
        await expect(
          exclusiveClaim.connect(depositor).refund(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "DeadlineNotReached");
      });

      it("should revert if not depositor", async function () {
        await time.increase(ONE_DAY + 1);

        await expect(
          exclusiveClaim.connect(other).refund(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "NotDepositor");
      });
    });
  });

  describe("Multiple Deposits", function () {
    it("should handle multiple deposits from different users", async function () {
      const deadline = (await time.latest()) + ONE_DAY;

      // First deposit: ETH from depositor to claimant
      await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, "ETH Deposit", {
        value: ETH_AMOUNT,
      });

      // Second deposit: Tokens from depositor to other
      await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);
      await exclusiveClaim.connect(depositor).depositToken(
        other.address,
        await mockToken.getAddress(),
        TOKEN_AMOUNT,
        IMMEDIATE,
        deadline,
        "Token Deposit"
      );

      expect(await exclusiveClaim.depositCount()).to.equal(2);

      // Claim first deposit
      await exclusiveClaim.connect(claimant).claim(0);

      // Claim second deposit
      await exclusiveClaim.connect(other).claim(1);

      const deposit0 = await exclusiveClaim.getDeposit(0);
      const deposit1 = await exclusiveClaim.getDeposit(1);

      expect(deposit0.claimed).to.equal(true);
      expect(deposit1.claimed).to.equal(true);
    });

    it("should handle race condition: claimant claims just before depositor refunds", async function () {
      const deadline = (await time.latest()) + ONE_DAY;
      await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
        value: ETH_AMOUNT,
      });

      // Move time to just after deadline
      await time.increase(ONE_DAY + 1);

      // Claimant claims successfully
      await exclusiveClaim.connect(claimant).claim(0);

      // Depositor tries to refund but fails because already claimed
      await expect(
        exclusiveClaim.connect(depositor).refund(0)
      ).to.be.revertedWithCustomError(exclusiveClaim, "AlreadyClaimed");
    });
  });

  describe("Edge Cases", function () {
    it("should handle very small amounts", async function () {
      const deadline = (await time.latest()) + ONE_DAY;
      const smallAmount = 1n; // 1 wei

      await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
        value: smallAmount,
      });

      await exclusiveClaim.connect(claimant).claim(0);

      const deposit = await exclusiveClaim.getDeposit(0);
      expect(deposit.claimed).to.equal(true);
    });

    it("should handle very large amounts", async function () {
      const deadline = (await time.latest()) + ONE_DAY;
      const largeAmount = ethers.parseEther("1000"); // 1000 ETH (reasonable for test accounts)

      await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
        value: largeAmount,
      });

      const deposit = await exclusiveClaim.getDeposit(0);
      expect(deposit.amount).to.equal(largeAmount);
    });

    it("should handle minimum deadline (1 second in future)", async function () {
      const deadline = (await time.latest()) + 2; // +2 to account for block time

      await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
        value: ETH_AMOUNT,
      });

      const deposit = await exclusiveClaim.getDeposit(0);
      expect(deposit.deadline).to.equal(deadline);
    });

    it("should allow depositor to be their own claimant", async function () {
      const deadline = (await time.latest()) + ONE_DAY;

      await exclusiveClaim.connect(depositor).depositETH(depositor.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
        value: ETH_AMOUNT,
      });

      await exclusiveClaim.connect(depositor).claim(0);

      const deposit = await exclusiveClaim.getDeposit(0);
      expect(deposit.claimed).to.equal(true);
    });

    it("should handle empty title", async function () {
      const deadline = (await time.latest()) + ONE_DAY;

      await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, "", {
        value: ETH_AMOUNT,
      });

      const deposit = await exclusiveClaim.getDeposit(0);
      expect(deposit.title).to.equal("");
    });

    it("should handle max length title", async function () {
      const deadline = (await time.latest()) + ONE_DAY;
      const maxTitle = "a".repeat(128); // Exactly MAX_TITLE_LENGTH

      await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, maxTitle, {
        value: ETH_AMOUNT,
      });

      const deposit = await exclusiveClaim.getDeposit(0);
      expect(deposit.title).to.equal(maxTitle);
    });
  });
});
