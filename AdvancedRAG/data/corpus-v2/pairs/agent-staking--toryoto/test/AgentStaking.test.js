const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe('AgentStaking', function () {
  let staking;
  let registry;
  let usdc;

  let deployer;
  let agentOwner;
  let otherUser;
  let treasury;

  const COOLDOWN = 7 * 24 * 60 * 60; // 7 days in seconds
  const USDC_DECIMALS = 6;
  const toUSDC = (n) => ethers.parseUnits(n.toString(), USDC_DECIMALS);

  let agentId;

  beforeEach(async function () {
    [deployer, agentOwner, otherUser, treasury] = await ethers.getSigners();

    // Deploy USDC
    const USDCFactory = await ethers.getContractFactory('Stablecoin');
    usdc = await USDCFactory.deploy('USDC', 'USDC', toUSDC(1_000_000), USDC_DECIMALS);
    await usdc.waitForDeployment();

    // Distribute USDC to agentOwner
    await usdc.transfer(agentOwner.address, toUSDC(10_000));

    // Deploy AgentIdentityRegistry
    const RegistryFactory = await ethers.getContractFactory('AgentIdentityRegistry');
    registry = await RegistryFactory.deploy();
    await registry.waitForDeployment();

    // Register an agent (agentId = 1)
    await registry.connect(agentOwner)['register(string)']('ipfs://QmTest');
    agentId = 1;

    // Deploy AgentStaking
    const StakingFactory = await ethers.getContractFactory('AgentStaking');
    staking = await StakingFactory.deploy(
      await usdc.getAddress(),
      await registry.getAddress(),
      treasury.address
    );
    await staking.waitForDeployment();

    // Approve staking contract to spend agentOwner's USDC
    await usdc.connect(agentOwner).approve(await staking.getAddress(), ethers.MaxUint256);
  });

  // ============================================================================
  // Constructor
  // ============================================================================

  describe('Constructor', function () {
    it('should set immutables and treasury correctly', async function () {
      expect(await staking.usdc()).to.equal(await usdc.getAddress());
      expect(await staking.registry()).to.equal(await registry.getAddress());
      expect(await staking.treasury()).to.equal(treasury.address);
    });

    it('should reject zero addresses', async function () {
      const F = await ethers.getContractFactory('AgentStaking');
      await expect(
        F.deploy(ethers.ZeroAddress, await registry.getAddress(), treasury.address)
      ).to.be.revertedWith('AgentStaking: zero usdc');
      await expect(
        F.deploy(await usdc.getAddress(), ethers.ZeroAddress, treasury.address)
      ).to.be.revertedWith('AgentStaking: zero registry');
      await expect(
        F.deploy(await usdc.getAddress(), await registry.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWith('AgentStaking: zero treasury');
    });
  });

  // ============================================================================
  // Stake
  // ============================================================================

  describe('Stake', function () {
    it('should stake USDC successfully', async function () {
      await expect(staking.connect(agentOwner).stake(agentId, toUSDC(100)))
        .to.emit(staking, 'Staked')
        .withArgs(agentId, agentOwner.address, toUSDC(100), toUSDC(100));

      expect(await staking.getStake(agentId)).to.equal(toUSDC(100));
    });

    it('should accumulate multiple stakes', async function () {
      await staking.connect(agentOwner).stake(agentId, toUSDC(50));
      await staking.connect(agentOwner).stake(agentId, toUSDC(75));

      expect(await staking.getStake(agentId)).to.equal(toUSDC(125));
    });

    it('should transfer USDC from staker to contract', async function () {
      const balanceBefore = await usdc.balanceOf(agentOwner.address);
      await staking.connect(agentOwner).stake(agentId, toUSDC(100));
      const balanceAfter = await usdc.balanceOf(agentOwner.address);

      expect(balanceBefore - balanceAfter).to.equal(toUSDC(100));
      expect(await usdc.balanceOf(await staking.getAddress())).to.equal(toUSDC(100));
    });

    it('should revert for non-owner of agent NFT', async function () {
      await expect(
        staking.connect(otherUser).stake(agentId, toUSDC(100))
      ).to.be.revertedWith('AgentStaking: not agent owner');
    });

    it('should revert for zero amount', async function () {
      await expect(
        staking.connect(agentOwner).stake(agentId, 0)
      ).to.be.revertedWith('AgentStaking: zero amount');
    });

    it('should revert if USDC not approved', async function () {
      await usdc.connect(agentOwner).approve(await staking.getAddress(), 0);
      await expect(
        staking.connect(agentOwner).stake(agentId, toUSDC(100))
      ).to.be.reverted;
    });
  });

  // ============================================================================
  // Request Unstake
  // ============================================================================

  describe('Request Unstake', function () {
    beforeEach(async function () {
      await staking.connect(agentOwner).stake(agentId, toUSDC(500));
    });

    it('should create an unstake request', async function () {
      const tx = await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(200));
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt .blockNumber);
      const expectedAvailable = block .timestamp + COOLDOWN;

      await expect(tx)
        .to.emit(staking, 'UnstakeRequested')
        .withArgs(agentId, toUSDC(200), expectedAvailable);

      const req = await staking.unstakeRequests(agentId);
      expect(req.amount).to.equal(toUSDC(200));
      expect(req.availableAt).to.equal(expectedAvailable);
    });

    it('should not reduce stakes on request', async function () {
      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(200));
      expect(await staking.getStake(agentId)).to.equal(toUSDC(500));
    });

    it('should overwrite existing request', async function () {
      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(100));
      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(300));

      const req = await staking.unstakeRequests(agentId);
      expect(req.amount).to.equal(toUSDC(300));
    });

    it('should revert if amount exceeds stake', async function () {
      await expect(
        staking.connect(agentOwner).requestUnstake(agentId, toUSDC(501))
      ).to.be.revertedWith('AgentStaking: exceeds stake');
    });

    it('should revert for zero amount', async function () {
      await expect(
        staking.connect(agentOwner).requestUnstake(agentId, 0)
      ).to.be.revertedWith('AgentStaking: zero amount');
    });

    it('should revert for non-owner', async function () {
      await expect(
        staking.connect(otherUser).requestUnstake(agentId, toUSDC(100))
      ).to.be.revertedWith('AgentStaking: not agent owner');
    });
  });

  // ============================================================================
  // Execute Unstake
  // ============================================================================

  describe('Execute Unstake', function () {
    beforeEach(async function () {
      await staking.connect(agentOwner).stake(agentId, toUSDC(500));
      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(200));
    });

    it('should execute after cooldown', async function () {
      await time.increase(COOLDOWN);

      await expect(staking.connect(agentOwner).executeUnstake(agentId))
        .to.emit(staking, 'Unstaked')
        .withArgs(agentId, agentOwner.address, toUSDC(200), toUSDC(300));

      expect(await staking.getStake(agentId)).to.equal(toUSDC(300));

      const req = await staking.unstakeRequests(agentId);
      expect(req.amount).to.equal(0);
    });

    it('should return USDC to agent owner', async function () {
      await time.increase(COOLDOWN);

      const balanceBefore = await usdc.balanceOf(agentOwner.address);
      await staking.connect(agentOwner).executeUnstake(agentId);
      const balanceAfter = await usdc.balanceOf(agentOwner.address);

      expect(balanceAfter - balanceBefore).to.equal(toUSDC(200));
    });

    it('should revert before cooldown', async function () {
      await time.increase(COOLDOWN - 10);

      await expect(
        staking.connect(agentOwner).executeUnstake(agentId)
      ).to.be.revertedWith('AgentStaking: cooldown active');
    });

    it('should revert when no request exists', async function () {
      // Register a second agent, stake, but don't request unstake
      await registry.connect(agentOwner)['register(string)']('ipfs://QmTest2');
      await staking.connect(agentOwner).stake(2, toUSDC(100));

      await expect(
        staking.connect(agentOwner).executeUnstake(2)
      ).to.be.revertedWith('AgentStaking: no request');
    });

    it('should revert for non-owner', async function () {
      await time.increase(COOLDOWN);
      await expect(
        staking.connect(otherUser).executeUnstake(agentId)
      ).to.be.revertedWith('AgentStaking: not agent owner');
    });
  });

  // ============================================================================
  // Cancel Unstake
  // ============================================================================

  describe('Cancel Unstake', function () {
    beforeEach(async function () {
      await staking.connect(agentOwner).stake(agentId, toUSDC(500));
      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(200));
    });

    it('should cancel pending request', async function () {
      await expect(staking.connect(agentOwner).cancelUnstake(agentId))
        .to.emit(staking, 'UnstakeCancelled')
        .withArgs(agentId);

      const req = await staking.unstakeRequests(agentId);
      expect(req.amount).to.equal(0);
    });

    it('should keep stakes unchanged', async function () {
      await staking.connect(agentOwner).cancelUnstake(agentId);
      expect(await staking.getStake(agentId)).to.equal(toUSDC(500));
    });

    it('should revert when no request exists', async function () {
      await staking.connect(agentOwner).cancelUnstake(agentId);
      await expect(
        staking.connect(agentOwner).cancelUnstake(agentId)
      ).to.be.revertedWith('AgentStaking: no request');
    });

    it('should revert for non-owner', async function () {
      await expect(
        staking.connect(otherUser).cancelUnstake(agentId)
      ).to.be.revertedWith('AgentStaking: not agent owner');
    });
  });

  // ============================================================================
  // Slash
  // ============================================================================

  describe('Slash', function () {
    beforeEach(async function () {
      await staking.connect(agentOwner).stake(agentId, toUSDC(500));
    });

    it('should slash and send USDC to treasury', async function () {
      await expect(staking.connect(deployer).slash(agentId, toUSDC(100), 'malicious'))
        .to.emit(staking, 'Slashed')
        .withArgs(agentId, toUSDC(100), 'malicious');

      expect(await staking.getStake(agentId)).to.equal(toUSDC(400));
      expect(await usdc.balanceOf(treasury.address)).to.equal(toUSDC(100));
    });

    it('should cap slash at available stake', async function () {
      await staking.connect(deployer).slash(agentId, toUSDC(9999), 'severe');

      expect(await staking.getStake(agentId)).to.equal(0);
      expect(await usdc.balanceOf(treasury.address)).to.equal(toUSDC(500));
    });

    it('should auto-shrink pending unstake request', async function () {
      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(400));

      // Slash 200 → stakes goes from 500 to 300, pending 400 → 300
      await staking.connect(deployer).slash(agentId, toUSDC(200), 'partial');

      const req = await staking.unstakeRequests(agentId);
      expect(req.amount).to.equal(toUSDC(300));
      expect(await staking.getStake(agentId)).to.equal(toUSDC(300));
    });

    it('should zero out pending unstake on full slash', async function () {
      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(400));

      await staking.connect(deployer).slash(agentId, toUSDC(500), 'full');

      const req = await staking.unstakeRequests(agentId);
      expect(req.amount).to.equal(0);
      expect(await staking.getStake(agentId)).to.equal(0);
    });

    it('should revert for non-owner (deployer)', async function () {
      await expect(
        staking.connect(agentOwner).slash(agentId, toUSDC(100), 'attempt')
      ).to.be.revertedWithCustomError(staking, 'OwnableUnauthorizedAccount');
    });

    it('should revert for zero amount', async function () {
      await expect(
        staking.connect(deployer).slash(agentId, 0, 'zero')
      ).to.be.revertedWith('AgentStaking: zero amount');
    });

    it('should revert when nothing to slash', async function () {
      await expect(
        staking.connect(deployer).slash(999, toUSDC(100), 'no stake')
      ).to.be.revertedWith('AgentStaking: nothing to slash');
    });
  });

  // ============================================================================
  // Slash + Execute Unstake Interaction
  // ============================================================================

  describe('Slash + Execute Unstake', function () {
    it('should allow partial withdrawal after slash', async function () {
      await staking.connect(agentOwner).stake(agentId, toUSDC(100));
      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(80));

      // Slash 50 → stakes = 50, pending 80 → 50
      await staking.connect(deployer).slash(agentId, toUSDC(50), 'partial');

      await time.increase(COOLDOWN);
      await staking.connect(agentOwner).executeUnstake(agentId);

      expect(await staking.getStake(agentId)).to.equal(0);
      expect(await usdc.balanceOf(treasury.address)).to.equal(toUSDC(50));
    });
  });

  // ============================================================================
  // Treasury
  // ============================================================================

  describe('Treasury', function () {
    it('should update treasury address', async function () {
      await expect(staking.connect(deployer).setTreasury(otherUser.address))
        .to.emit(staking, 'TreasuryUpdated')
        .withArgs(treasury.address, otherUser.address);

      expect(await staking.treasury()).to.equal(otherUser.address);
    });

    it('should reject zero address', async function () {
      await expect(
        staking.connect(deployer).setTreasury(ethers.ZeroAddress)
      ).to.be.revertedWith('AgentStaking: zero address');
    });

    it('should reject non-owner', async function () {
      await expect(
        staking.connect(otherUser).setTreasury(otherUser.address)
      ).to.be.revertedWithCustomError(staking, 'OwnableUnauthorizedAccount');
    });
  });

  // ============================================================================
  // View
  // ============================================================================

  describe('View', function () {
    it('should return 0 for unstaked agent', async function () {
      expect(await staking.getStake(999)).to.equal(0);
    });

    it('should reflect correct stake after operations', async function () {
      await staking.connect(agentOwner).stake(agentId, toUSDC(200));
      expect(await staking.getStake(agentId)).to.equal(toUSDC(200));

      await staking.connect(agentOwner).requestUnstake(agentId, toUSDC(50));
      await time.increase(COOLDOWN);
      await staking.connect(agentOwner).executeUnstake(agentId);
      expect(await staking.getStake(agentId)).to.equal(toUSDC(150));

      await staking.connect(deployer).slash(agentId, toUSDC(30), 'test');
      expect(await staking.getStake(agentId)).to.equal(toUSDC(120));
    });
  });

  // ============================================================================
  // NFT Transfer Scenario
  // ============================================================================

  describe('NFT Transfer', function () {
    it('should let new NFT owner manage stakes after transfer', async function () {
      await staking.connect(agentOwner).stake(agentId, toUSDC(100));

      // Transfer NFT to otherUser
      await registry.connect(agentOwner).transferFrom(agentOwner.address, otherUser.address, agentId);

      // Old owner can no longer unstake
      await expect(
        staking.connect(agentOwner).requestUnstake(agentId, toUSDC(50))
      ).to.be.revertedWith('AgentStaking: not agent owner');

      // New owner can
      await staking.connect(otherUser).requestUnstake(agentId, toUSDC(50));
      await time.increase(COOLDOWN);

      // USDC goes to new owner
      const balanceBefore = await usdc.balanceOf(otherUser.address);
      await staking.connect(otherUser).executeUnstake(agentId);
      const balanceAfter = await usdc.balanceOf(otherUser.address);

      expect(balanceAfter - balanceBefore).to.equal(toUSDC(50));
      expect(await staking.getStake(agentId)).to.equal(toUSDC(50));
    });
  });
});
