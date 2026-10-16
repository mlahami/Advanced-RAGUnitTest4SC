const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Vault", function () {
  // Fixture for deployment
  async function deployVaultFixture() {
    const [owner, user1, user2, strategy] =
      await ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDCFactory.deploy();
    await usdc.waitForDeployment();

    // Deploy Vault
    const VaultFactory = await ethers.getContractFactory("Vault");
    const vault = await VaultFactory.deploy(
      await usdc.getAddress(),
      "Swiss DeFi Vault",
      "sdvUSDC"
    );
    await vault.waitForDeployment();

    // Mint USDC to users for testing (1M USDC each with 6 decimals)
    const amount = ethers.parseUnits("1000000", 6);
    await usdc.mint(user1.address, amount);
    await usdc.mint(user2.address, amount);

    return { vault, usdc, owner, user1, user2, strategy };
  }

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      const { vault } = await loadFixture(deployVaultFixture);

      expect(await vault.name()).to.equal("Swiss DeFi Vault");
      expect(await vault.symbol()).to.equal("sdvUSDC");
    });

    it("Should set the correct owner", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);

      expect(await vault.owner()).to.equal(owner.address);
    });

    it("Should set the correct asset", async function () {
      const { vault, usdc } = await loadFixture(deployVaultFixture);

      expect(await vault.asset()).to.equal(await usdc.getAddress());
    });

    it("Should initialize with zero total assets", async function () {
      const { vault } = await loadFixture(deployVaultFixture);

      expect(await vault.totalAssets()).to.equal(0);
    });

    it("Should initialize with max deposit limit", async function () {
      const { vault } = await loadFixture(deployVaultFixture);

      expect(await vault.depositCap()).to.equal(ethers.MaxUint256);
    });

    it("Should revert if asset address is zero", async function () {
      const VaultFactory = await ethers.getContractFactory("Vault");

      await expect(
        VaultFactory.deploy(
          ethers.ZeroAddress,
          "Swiss DeFi Vault",
          "sdvUSDC"
        )
      ).to.be.revertedWithCustomError(VaultFactory, "ZeroAddress");
    });
  });

  describe("Deposits", function () {
    it("Should allow users to deposit USDC", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const depositAmount = ethers.parseUnits("1000", 6); // 1000 USDC

      // Approve vault to spend USDC
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);

      // Deposit
      await expect(
        vault.connect(user1).deposit(depositAmount, user1.address)
      )
        .to.emit(vault, "Deposit")
        .withArgs(user1.address, user1.address, depositAmount, depositAmount);

      // Check vault shares
      expect(await vault.balanceOf(user1.address)).to.equal(depositAmount);
    });

    it("Should mint correct amount of shares on first deposit", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const depositAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // First deposit should mint 1:1 shares
      expect(await vault.balanceOf(user1.address)).to.equal(depositAmount);
      expect(await vault.totalAssets()).to.equal(depositAmount);
    });

    it("Should handle multiple deposits correctly", async function () {
      const { vault, usdc, user1, user2 } = await loadFixture(
        deployVaultFixture
      );

      const amount1 = ethers.parseUnits("1000", 6);
      const amount2 = ethers.parseUnits("500", 6);

      // User1 deposits
      await usdc.connect(user1).approve(await vault.getAddress(), amount1);
      await vault.connect(user1).deposit(amount1, user1.address);

      // User2 deposits
      await usdc.connect(user2).approve(await vault.getAddress(), amount2);
      await vault.connect(user2).deposit(amount2, user2.address);

      expect(await vault.balanceOf(user1.address)).to.equal(amount1);
      expect(await vault.balanceOf(user2.address)).to.equal(amount2);
      expect(await vault.totalAssets()).to.equal(amount1 + amount2);
    });

    it("Should revert when depositing zero amount", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(user1).deposit(0, user1.address)
      ).to.be.revertedWithCustomError(vault, "InvalidAmount");
    });

    it("Should revert when receiver is zero address", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);

      await expect(
        vault.connect(user1).deposit(depositAmount, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });

    it("Should revert when exceeding max deposit", async function () {
      const { vault, usdc, user1, owner } = await loadFixture(
        deployVaultFixture
      );

      const maxDep = ethers.parseUnits("100", 6);
      await vault.connect(owner).setDepositCap(maxDep);

      const depositAmount = ethers.parseUnits("200", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);

      await expect(
        vault.connect(user1).deposit(depositAmount, user1.address)
      ).to.be.revertedWithCustomError(vault, "ExceedsDepositCap");
    });

    it("Should revert deposits when emergency shutdown is active", async function () {
      const { vault, usdc, user1, owner } = await loadFixture(
        deployVaultFixture
      );

      // Trigger emergency shutdown
      await vault.connect(owner).triggerEmergencyShutdown();

      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);

      await expect(
        vault.connect(user1).deposit(depositAmount, user1.address)
      ).to.be.revertedWithCustomError(vault, "EmergencyShutdownActive");
    });
  });

  describe("Withdrawals", function () {
    it("Should allow users to withdraw assets", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const depositAmount = ethers.parseUnits("1000", 6);

      // Deposit first
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const initialBalance = await usdc.balanceOf(user1.address);

      // Withdraw
      await vault
        .connect(user1)
        .withdraw(depositAmount, user1.address, user1.address);

      expect(await vault.balanceOf(user1.address)).to.equal(0);
      expect(await usdc.balanceOf(user1.address)).to.equal(
        initialBalance + depositAmount
      );
    });

    it("Should allow users to redeem shares", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const depositAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const shares = await vault.balanceOf(user1.address);
      const initialBalance = await usdc.balanceOf(user1.address);

      // Redeem all shares
      await vault.connect(user1).redeem(shares, user1.address, user1.address);

      expect(await vault.balanceOf(user1.address)).to.equal(0);
      expect(await usdc.balanceOf(user1.address)).to.be.greaterThan(
        initialBalance
      );
    });

    it("Should revert when withdrawing zero amount", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(user1).withdraw(0, user1.address, user1.address)
      ).to.be.revertedWithCustomError(vault, "InvalidAmount");
    });

    it("Should revert when redeeming zero shares", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(user1).redeem(0, user1.address, user1.address)
      ).to.be.revertedWithCustomError(vault, "InvalidAmount");
    });

    it("Should allow withdrawals even during emergency shutdown", async function () {
      const { vault, usdc, user1, owner } = await loadFixture(
        deployVaultFixture
      );

      const depositAmount = ethers.parseUnits("1000", 6);

      // Deposit first
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // Trigger emergency shutdown
      await vault.connect(owner).triggerEmergencyShutdown();

      // Should still allow withdrawal
      await expect(
        vault
          .connect(user1)
          .withdraw(depositAmount, user1.address, user1.address)
      ).to.not.be.reverted;
    });
  });

  describe("Minting", function () {
    it("Should allow users to mint shares", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const shares = ethers.parseUnits("1000", 6);

      // Approve enough USDC
      await usdc
        .connect(user1)
        .approve(await vault.getAddress(), ethers.parseUnits("10000", 6));

      // Mint shares
      await vault.connect(user1).mint(shares, user1.address);

      expect(await vault.balanceOf(user1.address)).to.equal(shares);
    });

    it("Should revert when minting zero shares", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(user1).mint(0, user1.address)
      ).to.be.revertedWithCustomError(vault, "InvalidAmount");
    });

    it("Should revert minting when emergency shutdown is active", async function () {
      const { vault, usdc, user1, owner } = await loadFixture(
        deployVaultFixture
      );

      // Trigger emergency shutdown
      await vault.connect(owner).triggerEmergencyShutdown();

      const shares = ethers.parseUnits("1000", 6);
      await usdc
        .connect(user1)
        .approve(await vault.getAddress(), ethers.parseUnits("10000", 6));

      await expect(
        vault.connect(user1).mint(shares, user1.address)
      ).to.be.revertedWithCustomError(vault, "EmergencyShutdownActive");
    });
  });

  describe("Strategy Management", function () {
    it("Should allow owner to set strategy", async function () {
      const { vault, owner, strategy } = await loadFixture(deployVaultFixture);

      await expect(vault.connect(owner).setStrategy(strategy.address))
        .to.emit(vault, "StrategyUpdated")
        .withArgs(ethers.ZeroAddress, strategy.address);

      expect(await vault.strategy()).to.equal(strategy.address);
    });

    it("Should revert when non-owner tries to set strategy", async function () {
      const { vault, user1, strategy } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(user1).setStrategy(strategy.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("Should revert when setting zero address as strategy", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(owner).setStrategy(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });

    it("Should allow owner to allocate assets to strategy", async function () {
      const { vault, usdc, owner, user1, strategy } = await loadFixture(
        deployVaultFixture
      );

      // Set strategy
      await vault.connect(owner).setStrategy(strategy.address);

      // User deposits
      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // Owner allocates to strategy
      const allocateAmount = ethers.parseUnits("500", 6);
      await expect(vault.connect(owner).allocateToStrategy(allocateAmount))
        .to.emit(vault, "AssetsAllocated")
        .withArgs(allocateAmount, allocateAmount);

      expect(await vault.totalAllocated()).to.equal(allocateAmount);
      expect(await usdc.balanceOf(strategy.address)).to.equal(allocateAmount);
    });

    it("Should revert allocation when no strategy is set", async function () {
      const { vault, usdc, owner, user1 } = await loadFixture(
        deployVaultFixture
      );

      // User deposits
      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // Try to allocate without strategy
      const allocateAmount = ethers.parseUnits("500", 6);
      await expect(
        vault.connect(owner).allocateToStrategy(allocateAmount)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });

    it("Should revert when allocating zero amount", async function () {
      const { vault, owner, strategy } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setStrategy(strategy.address);

      await expect(
        vault.connect(owner).allocateToStrategy(0)
      ).to.be.revertedWithCustomError(vault, "InvalidAmount");
    });

    it("Should revert when allocating more than available", async function () {
      const { vault, usdc, owner, user1, strategy } = await loadFixture(
        deployVaultFixture
      );

      await vault.connect(owner).setStrategy(strategy.address);

      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const allocateAmount = ethers.parseUnits("2000", 6);
      await expect(
        vault.connect(owner).allocateToStrategy(allocateAmount)
      ).to.be.revertedWithCustomError(vault, "InsufficientBalance");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to set max deposit", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);

      const newMax = ethers.parseUnits("10000", 6);

      await expect(vault.connect(owner).setDepositCap(newMax))
        .to.emit(vault, "DepositCapUpdated")
        .withArgs(ethers.MaxUint256, newMax);

      expect(await vault.depositCap()).to.equal(newMax);
    });

    it("Should revert when non-owner tries to set max deposit", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);

      const newMax = ethers.parseUnits("10000", 6);

      await expect(
        vault.connect(user1).setDepositCap(newMax)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("Should allow owner to trigger emergency shutdown", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);

      await expect(vault.connect(owner).triggerEmergencyShutdown())
        .to.emit(vault, "EmergencyShutdown")
        .withArgs(owner.address);

      expect(await vault.emergencyShutdown()).to.equal(true);
    });

    it("Should revert when non-owner tries to trigger shutdown", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(user1).triggerEmergencyShutdown()
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("Should allow owner to harvest", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);

      // Fast forward time by 2 hours
      await ethers.provider.send("evm_increaseTime", [2 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);

      await expect(vault.connect(owner).harvest()).to.emit(vault, "Harvest");
    });

    it("Should revert harvest if called too soon", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);

      // Try to harvest immediately (within 1 hour)
      await expect(
        vault.connect(owner).harvest()
      ).to.be.revertedWithCustomError(vault, "HarvestTooSoon");
    });
  });

  describe("View Functions", function () {
    it("Should return correct vault info", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const [totalAssets, totalShares, pricePerShare] =
        await vault.getVaultInfo();

      expect(totalAssets).to.equal(depositAmount);
      expect(totalShares).to.equal(depositAmount);
      expect(pricePerShare).to.equal(ethers.parseEther("1")); // 1:1 ratio
    });

    it("Should return correct total assets with strategy allocation", async function () {
      const { vault, usdc, owner, user1, strategy } = await loadFixture(
        deployVaultFixture
      );

      await vault.connect(owner).setStrategy(strategy.address);

      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const allocateAmount = ethers.parseUnits("500", 6);
      await vault.connect(owner).allocateToStrategy(allocateAmount);

      // Total assets should include both vault balance and allocated
      expect(await vault.totalAssets()).to.equal(depositAmount);
    });
  });

  describe("Reentrancy Protection", function () {
    // A strategy is chosen by the owner, but it still runs arbitrary code while
    // the vault waits on it. These exercise a real attacker contract rather
    // than asserting that a modifier is present in the source.
    async function deployReenteringFixture() {
      const base = await loadFixture(deployVaultFixture);
      const { vault, usdc, owner, user1 } = base;

      const Factory = await ethers.getContractFactory("ReenteringStrategy");
      const attacker = await Factory.deploy(
        await usdc.getAddress(),
        await vault.getAddress()
      );
      await attacker.waitForDeployment();

      // An honest depositor funds the vault, then the owner attaches the
      // strategy and allocates everything to it.
      const deposited = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), deposited);
      await vault.connect(user1).deposit(deposited, user1.address);
      await vault.connect(owner).setStrategy(await attacker.getAddress());
      await vault.connect(owner).allocateToStrategy(deposited);

      return { ...base, attacker, deposited };
    }

    it("Should stop a strategy that re-enters deposit() during setStrategy", async function () {
      const { vault, usdc, owner, user1, attacker, deposited } =
        await loadFixture(deployReenteringFixture);

      // Return 600 of the 1000 and cover the missing 400 by depositing the
      // vault's own assets back in. Unguarded, the balance delta reads as the
      // full 1000 and the strategy walks away holding 400 USDC worth of shares.
      const returned = ethers.parseUnits("600", 6);
      const reentered = ethers.parseUnits("400", 6);
      await attacker.arm(returned, reentered);

      const Factory = await ethers.getContractFactory("ReenteringStrategy");
      const replacement = await Factory.deploy(
        await usdc.getAddress(),
        await vault.getAddress()
      );
      await replacement.waitForDeployment();

      await expect(
        vault.connect(owner).setStrategy(await replacement.getAddress())
      ).to.be.reverted;

      // Nothing moved: the strategy holds no shares and the depositor's claim
      // is intact.
      expect(await vault.balanceOf(await attacker.getAddress())).to.equal(0);
      expect(await vault.balanceOf(user1.address)).to.equal(deposited);
      expect(await vault.totalAllocated()).to.equal(deposited);
    });

    it("Should let an honest strategy be replaced", async function () {
      const { vault, usdc, owner, user1, attacker, deposited } =
        await loadFixture(deployReenteringFixture);

      // Same path with no re-entry: returns everything, deposits nothing.
      await attacker.arm(0, 0);

      const Factory = await ethers.getContractFactory("ReenteringStrategy");
      const replacement = await Factory.deploy(
        await usdc.getAddress(),
        await vault.getAddress()
      );
      await replacement.waitForDeployment();

      await vault.connect(owner).setStrategy(await replacement.getAddress());

      expect(await vault.totalAllocated()).to.equal(0);
      expect(await vault.balanceOf(user1.address)).to.equal(deposited);
      expect(await vault.balanceOf(await attacker.getAddress())).to.equal(0);
    });
  });

  describe("Gas Optimization", function () {
    it("Should use reasonable gas for deposit", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), depositAmount);

      const tx = await vault
        .connect(user1)
        .deposit(depositAmount, user1.address);
      const receipt = await tx.wait();

      // Gas should be less than 300k (target from specs)
      expect(receipt .gasUsed).to.be.lessThan(300000);
    });
  });

  // These exercise the ERC-4626 entry point `maxDeposit(address)` itself, not
  // the `depositCap` storage variable behind it. Before the rename the public
  // variable produced a zero-arg `maxDeposit()` getter that sat alongside the
  // inherited `maxDeposit(address)`; the standard function still returned
  // type(uint256).max no matter what the cap was set to, so an integrator
  // reading the vault through the ERC-4626 interface got a limit that the
  // vault did not honour.
  describe("ERC-4626 conformance: maxDeposit(address)", function () {
    it("Should not expose a zero-argument maxDeposit() alongside the standard one", async function () {
      const { vault } = await loadFixture(deployVaultFixture);

      const overloads = vault.interface.fragments.filter(
        (f) => f.type === "function" && f.name === "maxDeposit"
      );

      expect(overloads).to.have.lengthOf(1);
      expect((overloads[0]).inputs).to.have.lengthOf(1);
      expect((overloads[0]).inputs[0].type).to.equal("address");
    });

    it("Should report the uncapped default through the standard function", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);

      expect(await vault.maxDeposit(user1.address)).to.equal(ethers.MaxUint256);
    });

    it("Should report the configured cap through the standard function", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);

      const cap = ethers.parseUnits("100", 6);
      await vault.connect(owner).setDepositCap(cap);

      expect(await vault.maxDeposit(user1.address)).to.equal(cap);
    });

    it("Should return 0 while emergency shutdown is active", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setDepositCap(ethers.parseUnits("100", 6));
      await vault.connect(owner).triggerEmergencyShutdown();

      // EIP-4626: if deposits are disabled, even temporarily, maxDeposit MUST return 0.
      expect(await vault.maxDeposit(user1.address)).to.equal(0);
    });

    it("Should accept a deposit of exactly maxDeposit(receiver)", async function () {
      const { vault, usdc, owner, user1 } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setDepositCap(ethers.parseUnits("100", 6));

      const limit = await vault.maxDeposit(user1.address);
      await usdc.connect(user1).approve(await vault.getAddress(), limit);

      await expect(vault.connect(user1).deposit(limit, user1.address)).to.not.be
        .reverted;
    });

    it("Should reject a deposit of maxDeposit(receiver) + 1", async function () {
      const { vault, usdc, owner, user1 } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setDepositCap(ethers.parseUnits("100", 6));

      const limit = await vault.maxDeposit(user1.address);
      const overLimit = limit + 1n;
      await usdc.connect(user1).approve(await vault.getAddress(), overLimit);

      await expect(
        vault.connect(user1).deposit(overLimit, user1.address)
      ).to.be.revertedWithCustomError(vault, "ExceedsDepositCap");
    });

    it("Should track setDepositCap so the standard function never drifts", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);

      for (const raw of ["1", "500", "1000000"]) {
        const cap = ethers.parseUnits(raw, 6);
        await vault.connect(owner).setDepositCap(cap);
        expect(await vault.maxDeposit(user1.address)).to.equal(cap);
        expect(await vault.maxDeposit(user1.address)).to.equal(
          await vault.depositCap()
        );
      }
    });

    it("Should never revert, per EIP-4626, even with a zero cap", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setDepositCap(0);

      expect(await vault.maxDeposit(user1.address)).to.equal(0);
      expect(await vault.maxDeposit(ethers.ZeroAddress)).to.equal(0);
    });
  });

  // Companion to the block above, for the mint() side of the same cap.
  // maxDeposit(address) was fixed first; mint() kept going straight to
  // super.mint() without consulting any limit, and maxMint(address) was left
  // inherited, so it advertised type(uint256).max regardless of the cap. The
  // deposit cap was therefore bypassable simply by entering through mint().
  describe("ERC-4626 conformance: maxMint(address) and mint()", function () {
    it("Should not expose a zero-argument maxMint() alongside the standard one", async function () {
      const { vault } = await loadFixture(deployVaultFixture);

      const overloads = vault.interface.fragments.filter(
        (f) => f.type === "function" && f.name === "maxMint"
      );

      expect(overloads).to.have.lengthOf(1);
      expect((overloads[0]).inputs).to.have.lengthOf(1);
      expect((overloads[0]).inputs[0].type).to.equal("address");
    });

    it("Should report the uncapped default through the standard function", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);

      // Converting type(uint256).max would overflow, so an uncapped vault
      // reports the sentinel directly.
      expect(await vault.maxMint(user1.address)).to.equal(ethers.MaxUint256);
    });

    it("Should report the configured cap, converted to shares", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);

      const cap = ethers.parseUnits("100", 6);
      await vault.connect(owner).setDepositCap(cap);

      expect(await vault.maxMint(user1.address)).to.equal(
        await vault.convertToShares(cap)
      );
    });

    it("Should return 0 while emergency shutdown is active", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setDepositCap(ethers.parseUnits("100", 6));
      await vault.connect(owner).triggerEmergencyShutdown();

      // Mirrors maxDeposit: if minting is disabled, maxMint MUST return 0.
      expect(await vault.maxMint(user1.address)).to.equal(0);
    });

    it("Should accept a mint of exactly maxMint(receiver)", async function () {
      const { vault, usdc, owner, user1 } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setDepositCap(ethers.parseUnits("100", 6));

      const limit = await vault.maxMint(user1.address);
      await usdc
        .connect(user1)
        .approve(await vault.getAddress(), await vault.previewMint(limit));

      await expect(vault.connect(user1).mint(limit, user1.address)).to.not.be
        .reverted;
    });

    it("Should reject a mint of maxMint(receiver) + 1", async function () {
      const { vault, usdc, owner, user1 } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setDepositCap(ethers.parseUnits("100", 6));

      const overLimit = (await vault.maxMint(user1.address)) + 1n;
      await usdc
        .connect(user1)
        .approve(await vault.getAddress(), await vault.previewMint(overLimit));

      await expect(
        vault.connect(user1).mint(overLimit, user1.address)
      ).to.be.revertedWithCustomError(vault, "ExceedsDepositCap");
    });

    it("Should not let mint() bypass the deposit cap that deposit() enforces", async function () {
      const { vault, usdc, owner, user1 } = await loadFixture(deployVaultFixture);

      const cap = ethers.parseUnits("100", 6);
      await vault.connect(owner).setDepositCap(cap);

      // The exact regression: an amount of assets deposit() refuses must not
      // become reachable by converting it to shares and calling mint().
      const overCap = cap + ethers.parseUnits("1", 6);
      const sharesForOverCap = await vault.convertToShares(overCap);

      await usdc.connect(user1).approve(await vault.getAddress(), overCap * 2n);

      await expect(
        vault.connect(user1).deposit(overCap, user1.address)
      ).to.be.revertedWithCustomError(vault, "ExceedsDepositCap");

      await expect(
        vault.connect(user1).mint(sharesForOverCap, user1.address)
      ).to.be.revertedWithCustomError(vault, "ExceedsDepositCap");
    });

    it("Should never pull more assets than the cap for maxMint() shares", async function () {
      const { vault, usdc, owner, user1, user2 } = await loadFixture(
        deployVaultFixture
      );

      // Move the exchange rate off 1:1 so the share/asset conversion actually
      // rounds, then confirm the rounding cannot round *up* through the cap.
      await usdc
        .connect(user1)
        .approve(await vault.getAddress(), ethers.parseUnits("300", 6));
      await vault
        .connect(user1)
        .deposit(ethers.parseUnits("300", 6), user1.address);
      await usdc
        .connect(user2)
        .transfer(await vault.getAddress(), ethers.parseUnits("77", 6));

      for (const raw of ["1", "13", "100", "999"]) {
        const cap = ethers.parseUnits(raw, 6);
        await vault.connect(owner).setDepositCap(cap);

        const limit = await vault.maxMint(user2.address);
        expect(await vault.previewMint(limit)).to.be.lte(cap);
      }
    });

    it("Should never revert, per EIP-4626, even with a zero cap", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).setDepositCap(0);

      expect(await vault.maxMint(user1.address)).to.equal(0);
      expect(await vault.maxMint(ethers.ZeroAddress)).to.equal(0);
    });
  });

  // The withdrawal side is deliberately NOT capped and deliberately stays open
  // during emergency shutdown — the shutdown blocks new deposits only. These
  // tests pin that intent down so a future "consistency" change cannot quietly
  // trap depositors' funds.
  describe("ERC-4626 conformance: maxWithdraw / maxRedeem", function () {
    it("Should report the holder's full balance", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);

      const assets = ethers.parseUnits("250", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), assets);
      await vault.connect(user1).deposit(assets, user1.address);

      expect(await vault.maxRedeem(user1.address)).to.equal(
        await vault.balanceOf(user1.address)
      );
      expect(await vault.maxWithdraw(user1.address)).to.equal(
        await vault.convertToAssets(await vault.balanceOf(user1.address))
      );
    });

    it("Should stay open during emergency shutdown", async function () {
      const { vault, usdc, owner, user1 } = await loadFixture(deployVaultFixture);

      const assets = ethers.parseUnits("250", 6);
      await usdc.connect(user1).approve(await vault.getAddress(), assets);
      await vault.connect(user1).deposit(assets, user1.address);

      await vault.connect(owner).triggerEmergencyShutdown();

      // Withdrawals remain allowed, so these must NOT drop to 0.
      expect(await vault.maxRedeem(user1.address)).to.be.gt(0);
      expect(await vault.maxWithdraw(user1.address)).to.be.gt(0);

      await expect(
        vault
          .connect(user1)
          .redeem(
            await vault.maxRedeem(user1.address),
            user1.address,
            user1.address
          )
      ).to.not.be.reverted;
    });

    it("Should not revert for an address holding nothing", async function () {
      const { vault, user2 } = await loadFixture(deployVaultFixture);

      expect(await vault.maxWithdraw(user2.address)).to.equal(0);
      expect(await vault.maxRedeem(user2.address)).to.equal(0);
      expect(await vault.maxWithdraw(ethers.ZeroAddress)).to.equal(0);
      expect(await vault.maxRedeem(ethers.ZeroAddress)).to.equal(0);
    });
  });

  // EIP-4626: preview functions MUST NOT revert because of vault-specific
  // user or global limits. They answer "what would this trade give me", which
  // stays meaningful even when the cap would refuse the trade.
  describe("ERC-4626 conformance: preview functions ignore the cap", function () {
    it("Should quote amounts above the deposit cap without reverting", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);

      const cap = ethers.parseUnits("100", 6);
      await vault.connect(owner).setDepositCap(cap);

      const overCap = cap * 10n;
      expect(await vault.previewDeposit(overCap)).to.be.gt(0);
      expect(await vault.previewMint(await vault.convertToShares(overCap))).to.be.gt(
        0
      );
    });

    it("Should quote without reverting while emergency shutdown is active", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);

      await vault.connect(owner).triggerEmergencyShutdown();

      const assets = ethers.parseUnits("10", 6);
      expect(await vault.previewDeposit(assets)).to.be.gt(0);
      expect(await vault.previewMint(assets)).to.be.gt(0);
      expect(await vault.previewWithdraw(assets)).to.be.gt(0);
      expect(await vault.previewRedeem(assets)).to.be.gt(0);
    });
  });
});
