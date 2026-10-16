// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract AirdropDistributor is Ownable, ReentrancyGuard {
    using Math for uint256;

    IERC20 public immutable token;

    uint256 public immutable totalReserves;      // Total airdrop tokens reserved
    uint256 public immutable startTime;          // Timestamp when unlocks begin
    uint256 public immutable cliffDuration;      // Time before unlocking starts
    uint256 public immutable unlockDuration;     // Time over which tokens unlock linearly

    uint256 public reservesAllocated;            // How many tokens have been *currently* assigned

    mapping(address => uint256) public claimable;

    event Claimed(address indexed user, uint256 amount);
    event ClaimableSet(address indexed user, uint256 amount);

    constructor(address _token, uint256 _totalReserves, uint256 _cliffDuration, uint256 _unlockDuration) Ownable(msg.sender) {
        require(_token != address(0), "Token address required");
        require(_totalReserves > 0, "Reserves must be > 0");
        require(_unlockDuration > 0, "Unlock duration must be > 0");

        // guard against timestamp overflow in cliff/unlock math
        require(block.timestamp + _cliffDuration >= block.timestamp, "Cliff overflow");
        require(block.timestamp + _cliffDuration + _unlockDuration >= block.timestamp, "Unlock overflow");

        token           = IERC20(_token);
        totalReserves   = _totalReserves;
        cliffDuration   = _cliffDuration;
        unlockDuration  = _unlockDuration;
        startTime       = block.timestamp;
    }

    /// @notice Owner can assign “claimable” balances as tokens unlock
    function setClaimable(address user, uint256 amount) external onlyOwner {
        require(user != address(0), "Invalid address");
        uint256 previous = claimable[user];
        uint256 unlocked  = getUnlockedReserves();

        // compute what the total allocated would become
        uint256 newAllocated = reservesAllocated + amount;
        unchecked { newAllocated -= previous; } // safe because previous ≤ reservesAllocated by invariant

        require(newAllocated <= unlocked, "Exceeds unlocked tokens");

        // update state
        claimable[user]       = amount;
        reservesAllocated     = newAllocated;

        emit ClaimableSet(user, amount);
    }

    /// @notice Users pull their tokens; frees up their allocation afterward
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        require(amount > 0, "Nothing to claim");

        // zero before external call
        claimable[msg.sender] = 0;
        unchecked { reservesAllocated -= amount; }

        require(token.transfer(msg.sender, amount), "Transfer failed");
        emit Claimed(msg.sender, amount);
    }

    /// @notice How many tokens this user may claim right now
    function getClaimableAmount(address user) external view returns (uint256) {
        return claimable[user];
    }

    /// @notice How many unlocked tokens are still unassigned
    function getUnallocatedReserves() external view returns (uint256) {
        uint256 unlocked = getUnlockedReserves();
        return unlocked > reservesAllocated
            ? unlocked - reservesAllocated
            : 0;
    }

    /// @notice Linear‐unlock schedule with cliff, using mulDiv for overflow‐safe math
    function getUnlockedReserves() public view returns (uint256) {
        // still in cliff
        if (block.timestamp <= startTime + cliffDuration) {
            return 0;
        }

        uint256 elapsed = block.timestamp - (startTime + cliffDuration);
        if (elapsed >= unlockDuration) {
            return totalReserves;
        }

        // safe multiply‐then‐divide to avoid 256‐bit overflow
        return Math.mulDiv(totalReserves, elapsed, unlockDuration);
    }
}
