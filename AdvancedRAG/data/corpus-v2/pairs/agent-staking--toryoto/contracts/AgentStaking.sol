// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentStaking
 * @notice USDC staking for registered AI agents — provides skin-in-the-game
 *         signal consumed by the discovery ranking algorithm.
 * @dev Separated from AgentIdentityRegistry (ERC-8004) by design.
 *      Unstaking requires a 7-day cooldown to prevent stake-and-dump attacks.
 */
contract AgentStaking is Ownable {
    using SafeERC20 for IERC20;

    struct UnstakeRequest {
        uint256 amount;
        uint256 availableAt;
    }

    IERC20 public immutable usdc;
    IERC721 public immutable registry;

    address public treasury;
    uint256 public constant COOLDOWN = 7 days;

    mapping(uint256 => uint256) public stakes;
    mapping(uint256 => UnstakeRequest) public unstakeRequests;

    event Staked(uint256 indexed agentId, address indexed staker, uint256 amount, uint256 totalStake);
    event UnstakeRequested(uint256 indexed agentId, uint256 amount, uint256 availableAt);
    event UnstakeCancelled(uint256 indexed agentId);
    event Unstaked(uint256 indexed agentId, address indexed staker, uint256 amount, uint256 totalStake);
    event Slashed(uint256 indexed agentId, uint256 amount, string reason);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    constructor(address _usdc, address _registry, address _treasury) Ownable(msg.sender) {
        require(_usdc != address(0), "AgentStaking: zero usdc");
        require(_registry != address(0), "AgentStaking: zero registry");
        require(_treasury != address(0), "AgentStaking: zero treasury");

        usdc = IERC20(_usdc);
        registry = IERC721(_registry);
        treasury = _treasury;
    }

    modifier onlyAgentOwner(uint256 agentId) {
        require(registry.ownerOf(agentId) == msg.sender, "AgentStaking: not agent owner");
        _;
    }

    /**
     * @notice Deposit USDC as stake for an agent. Caller must have approved
     *         this contract to spend `amount` of USDC beforehand.
     */
    function stake(uint256 agentId, uint256 amount) external onlyAgentOwner(agentId) {
        require(amount > 0, "AgentStaking: zero amount");

        stakes[agentId] += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(agentId, msg.sender, amount, stakes[agentId]);
    }

    /**
     * @notice Begin the unstake process. The staked amount remains locked for
     *         COOLDOWN seconds. A new request overwrites any pending one.
     */
    function requestUnstake(uint256 agentId, uint256 amount) external onlyAgentOwner(agentId) {
        require(amount > 0, "AgentStaking: zero amount");
        require(amount <= stakes[agentId], "AgentStaking: exceeds stake");

        uint256 availableAt = block.timestamp + COOLDOWN;
        unstakeRequests[agentId] = UnstakeRequest(amount, availableAt);

        emit UnstakeRequested(agentId, amount, availableAt);
    }

    /**
     * @notice Finalize a matured unstake request, returning USDC to the agent owner.
     */
    function executeUnstake(uint256 agentId) external onlyAgentOwner(agentId) {
        UnstakeRequest memory req = unstakeRequests[agentId];
        require(req.amount > 0, "AgentStaking: no request");
        require(block.timestamp >= req.availableAt, "AgentStaking: cooldown active");

        uint256 withdrawable = _min(req.amount, stakes[agentId]);
        delete unstakeRequests[agentId];

        if (withdrawable > 0) {
            stakes[agentId] -= withdrawable;
            usdc.safeTransfer(msg.sender, withdrawable);
        }

        emit Unstaked(agentId, msg.sender, withdrawable, stakes[agentId]);
    }

    /**
     * @notice Cancel a pending unstake request.
     */
    function cancelUnstake(uint256 agentId) external onlyAgentOwner(agentId) {
        require(unstakeRequests[agentId].amount > 0, "AgentStaking: no request");
        delete unstakeRequests[agentId];

        emit UnstakeCancelled(agentId);
    }

    /**
     * @notice Confiscate staked USDC from a malicious agent and send to treasury.
     *         Automatically shrinks any pending unstake request to prevent underflow.
     */
    function slash(uint256 agentId, uint256 amount, string calldata reason) external onlyOwner {
        require(amount > 0, "AgentStaking: zero amount");

        uint256 slashable = _min(amount, stakes[agentId]);
        require(slashable > 0, "AgentStaking: nothing to slash");

        stakes[agentId] -= slashable;

        UnstakeRequest storage req = unstakeRequests[agentId];
        if (req.amount > stakes[agentId]) {
            req.amount = stakes[agentId];
        }

        usdc.safeTransfer(treasury, slashable);

        emit Slashed(agentId, slashable, reason);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "AgentStaking: zero address");
        address old = treasury;
        treasury = newTreasury;

        emit TreasuryUpdated(old, newTreasury);
    }

    function getStake(uint256 agentId) external view returns (uint256) {
        return stakes[agentId];
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
