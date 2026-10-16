# anneal-staking--winsznx

- domain: staking-yield (staking)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/winsznx/tryanneal @ 888b04fee28d084d09b2feee7ad12029c2880282
- license: MIT
- targets: AnnealStaking.sol, MockERC20.sol
- validation: 11 passing tests, 0 failing; statement coverage AnnealStaking.sol 93.88 %, MockERC20.sol 100.0 %

## Contract: AnnealStaking.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title AnnealStaking — auditor-backed staking + fee distribution + slashing.
/// @dev   Stage-0 vault: arbitrator role = multisig; AUDITOR_ROLE granted to
///        the audit-runner identity that records correct/incorrect verdicts.
contract AnnealStaking is AccessControl, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant ARBITRATOR_ROLE = keccak256("ARBITRATOR_ROLE");
    bytes32 public constant AUDITOR_ROLE    = keccak256("AUDITOR_ROLE");

    IERC20 public immutable stakeToken;

    struct AuditorStake {
        uint256 amount;
        uint256 stakedAt;
        uint256 totalAudits;
        uint256 correctAudits;
        uint256 slashedAmount;
        bool active;
    }

    mapping(address => AuditorStake) public stakes;

    uint256 public totalStaked;
    uint256 public minStake;
    uint256 public slashBasisPoints;
    uint256 public maxSlashBasisPoints;
    uint256 public constant BASIS = 10_000;
    uint256 public constant COOLDOWN = 7 days;

    uint256 public auditorFeeBps  = 6_000; // 60%
    uint256 public stakerFeeBps   = 3_000; // 30%
    uint256 public treasuryFeeBps = 1_000; // 10%
    address public treasury;

    uint256 public accRewardPerShare; // scaled 1e18
    mapping(address => uint256) public rewardDebt;

    event Staked(address indexed auditor, uint256 amount);
    event Unstaked(address indexed auditor, uint256 amount);
    event Slashed(address indexed auditor, uint256 amount, string reason);
    event AuditRecorded(address indexed auditor, bool correct);
    event FeeDistributed(uint256 auditorShare, uint256 stakerShare, uint256 treasuryShare);
    event RewardClaimed(address indexed staker, uint256 amount);

    error BelowMinStake();
    error InsufficientStake();
    error CooldownNotMet();
    error ExceedsMaxSlash();

    constructor(address _stakeToken, uint256 _minStake, address _treasury) {
        stakeToken = IERC20(_stakeToken);
        minStake = _minStake;
        treasury = _treasury;
        slashBasisPoints = 250;
        maxSlashBasisPoints = 1_000;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ARBITRATOR_ROLE, msg.sender);
    }

    function stake(uint256 amount) external whenNotPaused {
        if (amount < minStake) revert BelowMinStake();
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);

        AuditorStake storage s = stakes[msg.sender];
        // Settle any pending rewards before mutating shares.
        _settle(msg.sender);
        s.amount += amount;
        s.stakedAt = block.timestamp;
        s.active = true;
        totalStaked += amount;

        rewardDebt[msg.sender] = (s.amount * accRewardPerShare) / 1e18;
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external {
        AuditorStake storage s = stakes[msg.sender];
        if (amount > s.amount) revert InsufficientStake();
        if (block.timestamp < s.stakedAt + COOLDOWN) revert CooldownNotMet();

        _settle(msg.sender);
        s.amount -= amount;
        if (s.amount < minStake) s.active = false;
        totalStaked -= amount;

        rewardDebt[msg.sender] = (s.amount * accRewardPerShare) / 1e18;
        stakeToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    function slash(address auditor, uint256 basisPoints, string calldata reason)
        external
        onlyRole(ARBITRATOR_ROLE)
    {
        if (basisPoints > maxSlashBasisPoints) revert ExceedsMaxSlash();

        AuditorStake storage s = stakes[auditor];
        uint256 slashAmount = (s.amount * basisPoints) / BASIS;

        _settle(auditor);
        s.amount -= slashAmount;
        s.slashedAmount += slashAmount;
        totalStaked -= slashAmount;
        if (s.amount < minStake) s.active = false;
        rewardDebt[auditor] = (s.amount * accRewardPerShare) / 1e18;

        uint256 fishermanShare = slashAmount / 2;
        uint256 treasurySlashShare = slashAmount - fishermanShare;
        stakeToken.safeTransfer(msg.sender, fishermanShare);
        stakeToken.safeTransfer(treasury, treasurySlashShare);

        emit Slashed(auditor, slashAmount, reason);
    }

    function recordAudit(address auditor, bool correct) external onlyRole(AUDITOR_ROLE) {
        AuditorStake storage s = stakes[auditor];
        s.totalAudits++;
        if (correct) s.correctAudits++;
        emit AuditRecorded(auditor, correct);
    }

    function distributeFee(uint256 feeAmount) external {
        stakeToken.safeTransferFrom(msg.sender, address(this), feeAmount);
        uint256 auditorShare  = (feeAmount * auditorFeeBps) / BASIS;
        uint256 stakerShare   = (feeAmount * stakerFeeBps) / BASIS;
        uint256 treasuryShare = feeAmount - auditorShare - stakerShare;

        if (totalStaked > 0) {
            accRewardPerShare += (stakerShare * 1e18) / totalStaked;
        }
        stakeToken.safeTransfer(treasury, treasuryShare);
        // auditorShare is held in-contract; off-chain bookkeeping resolves which auditor in v1.
        emit FeeDistributed(auditorShare, stakerShare, treasuryShare);
    }

    function claimRewards() external {
        uint256 pending = _pendingRewards(msg.sender);
        if (pending > 0) {
            rewardDebt[msg.sender] = (stakes[msg.sender].amount * accRewardPerShare) / 1e18;
            stakeToken.safeTransfer(msg.sender, pending);
            emit RewardClaimed(msg.sender, pending);
        }
    }

    function pendingRewards(address staker) external view returns (uint256) {
        return _pendingRewards(staker);
    }

    function getAuditorInfo(address auditor)
        external
        view
        returns (uint256 amount, uint256 totalAudits, uint256 correctAudits, uint256 accuracy, uint256 slashedAmount, bool active)
    {
        AuditorStake storage s = stakes[auditor];
        accuracy = s.totalAudits > 0 ? (s.correctAudits * 100) / s.totalAudits : 0;
        return (s.amount, s.totalAudits, s.correctAudits, accuracy, s.slashedAmount, s.active);
    }

    function _pendingRewards(address staker) internal view returns (uint256) {
        uint256 owed = (stakes[staker].amount * accRewardPerShare) / 1e18;
        if (owed <= rewardDebt[staker]) return 0;
        return owed - rewardDebt[staker];
    }

    function _settle(address staker) internal {
        uint256 pending = _pendingRewards(staker);
        if (pending > 0) {
            rewardDebt[staker] += pending;
            stakeToken.safeTransfer(staker, pending);
            emit RewardClaimed(staker, pending);
        }
    }
}
```

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("MockMNT", "mMNT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Tests: AnnealStaking.test.js

```javascript
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const MIN_STAKE = ethers.parseEther("100");
const SCALE = ethers.parseEther("1");

async function fixture() {
  const [admin, treasury, alice, bob, fisherman, runner] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockERC20");
  const token = await Mock.deploy();
  await token.waitForDeployment();

  const Staking = await ethers.getContractFactory("AnnealStaking");
  const staking = await Staking.deploy(await token.getAddress(), MIN_STAKE, treasury.address);
  await staking.waitForDeployment();

  // Grant AUDITOR_ROLE to runner
  const role = await staking.AUDITOR_ROLE();
  await (await staking.grantRole(role, runner.address)).wait();

  for (const u of [alice, bob, admin]) {
    await (await token.mint(u.address, ethers.parseEther("10000"))).wait();
    await (await token.connect(u).approve(await staking.getAddress(), ethers.MaxUint256)).wait();
  }

  return { admin, treasury, alice, bob, fisherman, runner, token, staking };
}

async function advanceDays(d) {
  await network.provider.send("evm_increaseTime", [d * 86400]);
  await network.provider.send("evm_mine", []);
}

describe("AnnealStaking", () => {
  it("stakes and emits Staked event", async () => {
    const { staking, alice, token } = await fixture();
    const amt = ethers.parseEther("500");
    await expect(staking.connect(alice).stake(amt))
      .to.emit(staking, "Staked")
      .withArgs(alice.address, amt);
    const info = await staking.getAuditorInfo(alice.address);
    expect(info.amount).to.equal(amt);
    expect(info.active).to.equal(true);
    expect(await token.balanceOf(await staking.getAddress())).to.equal(amt);
  });

  it("unstakes after cooldown", async () => {
    const { staking, alice, token } = await fixture();
    await (await staking.connect(alice).stake(ethers.parseEther("500"))).wait();
    await advanceDays(8);
    await expect(staking.connect(alice).unstake(ethers.parseEther("200")))
      .to.emit(staking, "Unstaked")
      .withArgs(alice.address, ethers.parseEther("200"));
    expect((await staking.getAuditorInfo(alice.address)).amount).to.equal(ethers.parseEther("300"));
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("9700"));
  });

  it("reverts unstake before cooldown", async () => {
    const { staking, alice } = await fixture();
    await (await staking.connect(alice).stake(ethers.parseEther("500"))).wait();
    await expect(staking.connect(alice).unstake(ethers.parseEther("100")))
      .to.be.revertedWithCustomError(staking, "CooldownNotMet");
  });

  it("slashes 2.5% with fisherman+treasury split", async () => {
    const { staking, admin, alice, treasury, token } = await fixture();
    await (await staking.connect(alice).stake(ethers.parseEther("1000"))).wait();
    const before = await token.balanceOf(admin.address);
    const treasuryBefore = await token.balanceOf(treasury.address);
    await expect(staking.connect(admin).slash(alice.address, 250, "bad audit"))
      .to.emit(staking, "Slashed")
      .withArgs(alice.address, ethers.parseEther("25"), "bad audit");
    expect((await staking.getAuditorInfo(alice.address)).amount).to.equal(ethers.parseEther("975"));
    const fisherman = await token.balanceOf(admin.address);
    const treasuryAfter = await token.balanceOf(treasury.address);
    expect(fisherman - before).to.equal(ethers.parseEther("12.5"));
    expect(treasuryAfter - treasuryBefore).to.equal(ethers.parseEther("12.5"));
  });

  it("rejects slash exceeding 10% cap", async () => {
    const { staking, admin, alice } = await fixture();
    await (await staking.connect(alice).stake(ethers.parseEther("1000"))).wait();
    await expect(staking.connect(admin).slash(alice.address, 1001, "too much"))
      .to.be.revertedWithCustomError(staking, "ExceedsMaxSlash");
  });

  it("non-arbitrator cannot slash", async () => {
    const { staking, alice, bob } = await fixture();
    await (await staking.connect(alice).stake(ethers.parseEther("1000"))).wait();
    await expect(staking.connect(bob).slash(alice.address, 100, "nope"))
      .to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount");
  });

  it("recordAudit updates accuracy", async () => {
    const { staking, alice, runner } = await fixture();
    await (await staking.connect(alice).stake(ethers.parseEther("500"))).wait();
    await (await staking.connect(runner).recordAudit(alice.address, true)).wait();
    await (await staking.connect(runner).recordAudit(alice.address, true)).wait();
    await (await staking.connect(runner).recordAudit(alice.address, false)).wait();
    const info = await staking.getAuditorInfo(alice.address);
    expect(info.totalAudits).to.equal(3n);
    expect(info.correctAudits).to.equal(2n);
    expect(info.accuracy).to.equal(66n);
  });

  it("distributes fees 60/30/10", async () => {
    const { staking, alice, admin, treasury, token } = await fixture();
    await (await staking.connect(alice).stake(ethers.parseEther("1000"))).wait();
    const tBefore = await token.balanceOf(treasury.address);
    const fee = ethers.parseEther("100");
    await expect(staking.connect(admin).distributeFee(fee))
      .to.emit(staking, "FeeDistributed")
      .withArgs(ethers.parseEther("60"), ethers.parseEther("30"), ethers.parseEther("10"));
    expect((await token.balanceOf(treasury.address)) - tBefore).to.equal(ethers.parseEther("10"));
  });

  it("stakers can claim accumulated rewards", async () => {
    const { staking, alice, bob, admin, token } = await fixture();
    await (await staking.connect(alice).stake(ethers.parseEther("1000"))).wait();
    await (await staking.connect(bob).stake(ethers.parseEther("1000"))).wait();
    await (await staking.connect(admin).distributeFee(ethers.parseEther("200"))).wait(); // 60 stakers
    const before = await token.balanceOf(alice.address);
    await (await staking.connect(alice).claimRewards()).wait();
    const gained = (await token.balanceOf(alice.address)) - before;
    expect(gained).to.equal(ethers.parseEther("30")); // 60 / 2 stakers
  });

  it("slash that drops auditor below minStake deactivates them", async () => {
    const { staking, admin, alice } = await fixture();
    // Stake exactly min so any slash drops below.
    await (await staking.connect(alice).stake(MIN_STAKE)).wait();
    await (await staking.connect(admin).slash(alice.address, 100, "1%")).wait(); // 1 token off
    const info = await staking.getAuditorInfo(alice.address);
    expect(info.active).to.equal(false);
    expect(info.slashedAmount).to.be.greaterThan(0n);
  });

  it("below-minimum stake reverts", async () => {
    const { staking, alice } = await fixture();
    await expect(staking.connect(alice).stake(ethers.parseEther("10")))
      .to.be.revertedWithCustomError(staking, "BelowMinStake");
  });
});

// Silence ts unused warning for SCALE if present
void SCALE;
```
