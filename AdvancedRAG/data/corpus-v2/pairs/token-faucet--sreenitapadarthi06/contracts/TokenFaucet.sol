// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Token.sol";

/**
 * @title TokenFaucet
 * @dev A rate-limited faucet for distributing AquaTokens.
 *      Enforces a 24-hour cooldown between claims per address and a
 *      lifetime maximum claim limit. Includes pause/unpause admin controls.
 *
 * Security:
 *  - Follows checks-effects-interactions pattern to prevent reentrancy.
 *  - All state mutations occur before external calls.
 *  - Solidity 0.8.x provides built-in overflow/underflow protection.
 */
contract TokenFaucet {
    // ────────────────────────── State ──────────────────────────

    /// @notice Reference to the AquaToken contract
    AquaToken public token;

    /// @notice Admin address (deployer) with exclusive pause control
    address public admin;

    /// @notice Whether the faucet is currently paused
    bool public paused;

    /// @notice Amount of tokens distributed per claim: 100 AQUA (18 decimals)
    uint256 public constant FAUCET_AMOUNT = 100 * 10 ** 18;

    /// @notice Cooldown period between claims: 24 hours
    uint256 public constant COOLDOWN_TIME = 24 hours;

    /// @notice Maximum lifetime claim per address: 1,000 AQUA (10 claims)
    uint256 public constant MAX_CLAIM_AMOUNT = 1_000 * 10 ** 18;

    /// @notice Timestamp of last claim per address
    mapping(address => uint256) public lastClaimAt;

    /// @notice Cumulative tokens claimed per address
    mapping(address => uint256) public totalClaimed;

    // ────────────────────────── Events ─────────────────────────

    /// @notice Emitted on every successful token claim
    event TokensClaimed(
        address indexed user,
        uint256 amount,
        uint256 timestamp
    );

    /// @notice Emitted when the pause state changes
    event FaucetPaused(bool paused);

    // ────────────────────────── Modifiers ──────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "TokenFaucet: caller is not the admin");
        _;
    }

    // ────────────────────────── Constructor ────────────────────

    /**
     * @notice Deploys the faucet, linking it to a deployed AquaToken.
     * @param _token Address of the AquaToken contract.
     */
    constructor(address _token) {
        require(_token != address(0), "TokenFaucet: token is zero address");
        token = AquaToken(_token);
        admin = msg.sender;
        paused = false;
    }

    // ────────────────────────── Public API ─────────────────────

    /**
     * @notice Claim tokens from the faucet.
     * @dev Checks-effects-interactions: state is updated before the external
     *      mint call to prevent reentrancy exploitation.
     *
     * Revert conditions:
     *  - Faucet is paused
     *  - Cooldown period has not elapsed
     *  - Lifetime claim limit reached
     *  - Minting would exceed token max supply
     */
    function requestTokens() external {
        // ── Checks ──
        require(!paused, "TokenFaucet: faucet is currently paused");
        require(
            block.timestamp >= lastClaimAt[msg.sender] + COOLDOWN_TIME,
            "TokenFaucet: cooldown period not elapsed"
        );
        require(
            totalClaimed[msg.sender] + FAUCET_AMOUNT <= MAX_CLAIM_AMOUNT,
            "TokenFaucet: lifetime claim limit reached"
        );

        // ── Effects ──
        lastClaimAt[msg.sender] = block.timestamp;
        totalClaimed[msg.sender] += FAUCET_AMOUNT;

        // ── Interactions ──
        token.mint(msg.sender, FAUCET_AMOUNT);

        emit TokensClaimed(msg.sender, FAUCET_AMOUNT, block.timestamp);
    }

    /**
     * @notice Check if an address can currently claim tokens.
     * @param user The address to check.
     * @return True if the address is eligible to claim right now.
     */
    function canClaim(address user) external view returns (bool) {
        if (paused) return false;
        if (block.timestamp < lastClaimAt[user] + COOLDOWN_TIME) return false;
        if (totalClaimed[user] + FAUCET_AMOUNT > MAX_CLAIM_AMOUNT) return false;
        return true;
    }

    /**
     * @notice Get the remaining lifetime claim allowance for an address.
     * @param user The address to query.
     * @return Remaining tokens (in base units) the address can still claim.
     */
    function remainingAllowance(address user) external view returns (uint256) {
        if (totalClaimed[user] >= MAX_CLAIM_AMOUNT) return 0;
        return MAX_CLAIM_AMOUNT - totalClaimed[user];
    }

    /**
     * @notice Check if the faucet is paused.
     * @return Current pause state.
     */
    function isPaused() external view returns (bool) {
        return paused;
    }

    // ────────────────────────── Admin ──────────────────────────

    /**
     * @notice Pause or unpause the faucet.
     * @param _paused New pause state.
     */
    function setPaused(bool _paused) external onlyAdmin {
        paused = _paused;
        emit FaucetPaused(_paused);
    }
}
