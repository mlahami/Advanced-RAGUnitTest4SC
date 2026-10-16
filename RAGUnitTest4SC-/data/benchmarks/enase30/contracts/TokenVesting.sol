// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title TokenVesting
 * @notice Cliff + linear vesting schedule for a single beneficiary.
 *         Supports multiple independent grants per address.
 * Complexity: Moderate
 */
contract TokenVesting {
    struct Grant {
        uint128 total;      // total tokens granted
        uint128 claimed;    // tokens already claimed
        uint64  start;      // vesting start timestamp
        uint64  cliff;      // cliff end timestamp
        uint64  end;        // vesting end timestamp
    }

    IERC20  public immutable token;
    address public           owner;

    // beneficiary => grant index => Grant
    mapping(address => Grant[]) public grants;

    event GrantCreated(address indexed beneficiary, uint256 index, uint128 total, uint64 start, uint64 cliff, uint64 end);
    event TokensClaimed(address indexed beneficiary, uint256 index, uint128 amount);
    event GrantRevoked(address indexed beneficiary, uint256 index, uint128 remaining);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _token) {
        token = IERC20(_token);
        owner = msg.sender;
    }

    // â”€â”€â”€ Owner actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function createGrant(
        address beneficiary,
        uint128 total,
        uint64  start,
        uint64  cliffDuration,
        uint64  vestingDuration
    ) external onlyOwner {
        require(beneficiary != address(0), "Zero address");
        require(total > 0, "Zero amount");
        require(vestingDuration > 0, "Zero duration");

        uint64 cliff = start + cliffDuration;
        uint64 end   = start + vestingDuration;
        require(end >= cliff, "End before cliff");

        grants[beneficiary].push(Grant({
            total:   total,
            claimed: 0,
            start:   start,
            cliff:   cliff,
            end:     end
        }));

        uint256 idx = grants[beneficiary].length - 1;
        emit GrantCreated(beneficiary, idx, total, start, cliff, end);
    }

    function revokeGrant(address beneficiary, uint256 index) external onlyOwner {
        Grant storage g = grants[beneficiary][index];
        uint128 vested     = _vestedAmount(g);
        uint128 unreleased = g.total - vested;
        g.total = vested; // cap at vested; beneficiary can still claim
        emit GrantRevoked(beneficiary, index, unreleased);
    }

    // â”€â”€â”€ Beneficiary actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function claim(uint256 index) external {
        Grant storage g = grants[msg.sender][index];
        uint128 claimableAmount = _vestedAmount(g) - g.claimed;
        require(claimableAmount > 0, "Nothing to claim");
        g.claimed += claimableAmount;
        require(token.transfer(msg.sender, claimableAmount), "Transfer failed");
        emit TokensClaimed(msg.sender, index, claimableAmount);
    }

    // â”€â”€â”€ Views â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function claimable(address beneficiary, uint256 index) external view returns (uint128) {
        Grant storage g = grants[beneficiary][index];
        return _vestedAmount(g) - g.claimed;
    }

    function grantCount(address beneficiary) external view returns (uint256) {
        return grants[beneficiary].length;
    }

    // â”€â”€â”€ Internal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function _vestedAmount(Grant storage g) internal view returns (uint128) {
        uint64 now_ = uint64(block.timestamp);
        if (now_ < g.cliff) return 0;
        if (now_ >= g.end)  return g.total;
        uint64 elapsed  = now_ - g.start;
        uint64 duration = g.end - g.start;
        return uint128((uint256(g.total) * elapsed) / duration);
    }
}

