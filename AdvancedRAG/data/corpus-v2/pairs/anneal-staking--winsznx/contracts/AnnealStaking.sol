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
