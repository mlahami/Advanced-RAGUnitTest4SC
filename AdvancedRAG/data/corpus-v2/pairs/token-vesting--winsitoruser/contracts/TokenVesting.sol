// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TokenVesting
 * @dev A token vesting contract that releases tokens gradually over time
 */
contract TokenVesting is Ownable, ReentrancyGuard {
    struct VestingSchedule {
        uint256 totalAmount;
        uint256 releasedAmount;
        uint256 startTime;
        uint256 cliffDuration;
        uint256 duration;
        bool revocable;
        bool revoked;
    }

    IERC20 public token;
    mapping(address => VestingSchedule) public vestingSchedules;

    event VestingScheduleCreated(
        address indexed beneficiary,
        uint256 totalAmount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 duration
    );
    event TokensReleased(address indexed beneficiary, uint256 amount);
    event VestingRevoked(address indexed beneficiary);

    constructor(address tokenAddress) Ownable(msg.sender) {
        require(tokenAddress != address(0), "Token address cannot be zero");
        token = IERC20(tokenAddress);
    }

    /**
     * @dev Creates a vesting schedule
     * @param beneficiary Address of the beneficiary
     * @param totalAmount Total amount of tokens to vest
     * @param startTime Start time of vesting
     * @param cliffDuration Cliff duration in seconds
     * @param duration Total vesting duration in seconds
     * @param revocable Whether the vesting is revocable
     */
    function createVestingSchedule(
        address beneficiary,
        uint256 totalAmount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 duration,
        bool revocable
    ) external onlyOwner {
        require(beneficiary != address(0), "Beneficiary cannot be zero address");
        require(totalAmount > 0, "Amount must be greater than 0");
        require(duration > 0, "Duration must be greater than 0");
        require(cliffDuration <= duration, "Cliff must be <= duration");
        require(vestingSchedules[beneficiary].totalAmount == 0, "Schedule already exists");

        vestingSchedules[beneficiary] = VestingSchedule({
            totalAmount: totalAmount,
            releasedAmount: 0,
            startTime: startTime,
            cliffDuration: cliffDuration,
            duration: duration,
            revocable: revocable,
            revoked: false
        });

        require(
            token.transferFrom(msg.sender, address(this), totalAmount),
            "Token transfer failed"
        );

        emit VestingScheduleCreated(beneficiary, totalAmount, startTime, cliffDuration, duration);
    }

    /**
     * @dev Releases vested tokens to beneficiary
     */
    function release() external nonReentrant {
        VestingSchedule storage schedule = vestingSchedules[msg.sender];
        require(schedule.totalAmount > 0, "No vesting schedule");
        require(!schedule.revoked, "Vesting revoked");

        uint256 releasable = _releasableAmount(schedule);
        require(releasable > 0, "No tokens to release");

        schedule.releasedAmount += releasable;
        require(token.transfer(msg.sender, releasable), "Token transfer failed");

        emit TokensReleased(msg.sender, releasable);
    }

    /**
     * @dev Revokes a vesting schedule (only if revocable)
     * @param beneficiary Address of the beneficiary
     */
    function revoke(address beneficiary) external onlyOwner {
        VestingSchedule storage schedule = vestingSchedules[beneficiary];
        require(schedule.totalAmount > 0, "No vesting schedule");
        require(schedule.revocable, "Vesting not revocable");
        require(!schedule.revoked, "Already revoked");

        uint256 releasable = _releasableAmount(schedule);
        uint256 refund = schedule.totalAmount - schedule.releasedAmount - releasable;

        schedule.revoked = true;

        if (releasable > 0) {
            schedule.releasedAmount += releasable;
            require(token.transfer(beneficiary, releasable), "Token transfer failed");
        }

        if (refund > 0) {
            require(token.transfer(owner(), refund), "Refund transfer failed");
        }

        emit VestingRevoked(beneficiary);
    }

    /**
     * @dev Calculates the releasable amount of tokens
     */
    function _releasableAmount(VestingSchedule memory schedule) private view returns (uint256) {
        return _vestedAmount(schedule) - schedule.releasedAmount;
    }

    /**
     * @dev Calculates the vested amount of tokens
     */
    function _vestedAmount(VestingSchedule memory schedule) private view returns (uint256) {
        if (block.timestamp < schedule.startTime + schedule.cliffDuration) {
            return 0;
        } else if (
            block.timestamp >= schedule.startTime + schedule.duration ||
            schedule.revoked
        ) {
            return schedule.totalAmount;
        } else {
            return (schedule.totalAmount * (block.timestamp - schedule.startTime)) / schedule.duration;
        }
    }

    /**
     * @dev Returns the releasable amount for a beneficiary
     */
    function getReleasableAmount(address beneficiary) external view returns (uint256) {
        return _releasableAmount(vestingSchedules[beneficiary]);
    }

    /**
     * @dev Returns the vested amount for a beneficiary
     */
    function getVestedAmount(address beneficiary) external view returns (uint256) {
        return _vestedAmount(vestingSchedules[beneficiary]);
    }
}
