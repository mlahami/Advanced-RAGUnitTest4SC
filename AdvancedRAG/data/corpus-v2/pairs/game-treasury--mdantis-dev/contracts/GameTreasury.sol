// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title Game Treasury
/// @notice Manages a controlled linear unlock of 75 million LIM tokens over a 6-month period, ensuring fairness and minimizing rug-pull risk. This treasury will be used for rewards, gifts, offers, publicity campaigns, and other promotional initiatives related to gameplay and community engagement.
contract GameTreasury is Ownable, AccessControl {
    using SafeERC20 for IERC20;
    bytes32 public constant POOL_LOADER_ROLE = keccak256("POOL_LOADER_ROLE");
    bytes32 public constant GAME_CONTRACT_ROLE = keccak256("GAME_CONTRACT_ROLE");

    IERC20 public immutable limToken;

    uint256 public immutable totalAllocation;
    uint256 public immutable upfrontUnlocked;
    uint256 public immutable startTimestamp; // Vesting start
    uint256 public immutable vestingDuration; // 6 months = 180 days

    uint256 public released;

    uint256 public gameFeeFunds; // Additional unlocked tokens not part of the 75M totalAllocation

    mapping(address => uint256) public liquidityPoolFees;
    mapping(address => uint256) public gameTreasuryFees;

    event TokensTransferred(address indexed to, uint256 amount);
    event FeeAdded(address indexed token, uint256 amount, string pool);
    event FeeCollected(address indexed token, uint256 amount, string pool, address to);

    constructor(address _limToken, uint256 _totalAllocation, uint256 _upfrontUnlocked, uint256 _vestingDuration) Ownable(msg.sender) {
        require(_limToken != address(0), "Invalid token");
        require(_totalAllocation > 0, "Total alocation must be greater than zero");
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        limToken = IERC20(_limToken);
        totalAllocation = _totalAllocation;
        upfrontUnlocked = _upfrontUnlocked;
        vestingDuration = _vestingDuration;
        startTimestamp = block.timestamp;
    }

    /// @notice Deposits totalAllocation of LIM tokens
    function receiveRewardTokens(uint256 amount) external onlyRole(POOL_LOADER_ROLE) {
        limToken.transferFrom(msg.sender, address(this), amount);
    }

    /// @notice Adds fully unlocked game fee tokens
    function receiveGameFeeTokens(uint256 amount) external onlyOwner {
        limToken.transferFrom(msg.sender, address(this), amount);
        gameFeeFunds += amount;
    }

    /// @notice Transfer tokens to an address using gameFeeFunds first, then vested tokens
    function transferTokens(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid address");
        require(amount > 0, "Amount must be greater than zero");
        uint256 usedGameFee = 0;
        uint256 usedReserve = 0;

        if (gameFeeFunds >= amount) {
            // Fully covered by gameFeeFunds
            gameFeeFunds -= amount;
            usedGameFee = amount;
        } else {
            // Use all gameFeeFunds first
            usedGameFee = gameFeeFunds;
            gameFeeFunds = 0;

            // Calculate remaining amount from vested reserves
            uint256 remaining = amount - usedGameFee;
            uint256 availableReserve = releasable(); // vested - released
            require(remaining <= availableReserve, "Insufficient unlocked tokens");
            released += remaining;
            usedReserve = remaining;
        }

        limToken.safeTransfer(to, amount);
        emit TokensTransferred(to, amount);
    }

    /// @notice Calculate how many tokens are vested and available for release
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < startTimestamp) return 0;
        uint256 elapsed = block.timestamp - startTimestamp;
        if (elapsed >= vestingDuration) return totalAllocation;
        return upfrontUnlocked + ((totalAllocation - upfrontUnlocked) * elapsed) / vestingDuration;
    }

    /// @notice Returns how many tokens can still be transferred
    function releasable() public view returns (uint256) {
        return vestedAmount() - released;
    }

    /// @notice Track token fees into liquidity pool and transfer tokens to this contract
    function addLiquidityFee(address tokenAddress, uint256 amount) external onlyRole(GAME_CONTRACT_ROLE) {
        require(tokenAddress != address(0), "Invalid token address");
        require(amount > 0, "Amount must be > 0");
        IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
        liquidityPoolFees[tokenAddress] += amount;
        emit FeeAdded(tokenAddress, amount, "liquidityPool");
    }

    /// @notice Track token fees into game treasury and transfer tokens to this contract
    function addGameFee(address tokenAddress, uint256 amount) external onlyRole(GAME_CONTRACT_ROLE) {
        require(tokenAddress != address(0), "Invalid token address");
        require(amount > 0, "Amount must be > 0");
        IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
        gameTreasuryFees[tokenAddress] += amount;
        emit FeeAdded(tokenAddress, amount, "gameTreasury");
    }

    /// @notice Collect accumulated game fees to an address.
    /// These fees will be converted to LIM tokens and added to the gameFeeFund for future use.
    function collectGameFees(address tokenAddress, address to) external onlyOwner {
        require(tokenAddress != address(0), "Invalid token address");
        require(to != address(0), "Invalid address");
        uint256 amount = gameTreasuryFees[tokenAddress];
        require(amount > 0, "No game fees");
        gameTreasuryFees[tokenAddress] = 0;
        IERC20(tokenAddress).safeTransfer(to, amount);
        emit FeeCollected(tokenAddress, amount, "gameTreasury", to);
    }

    /// @notice Collect accumulated liquidity fees to an address.
    /// These fees will be converted to ETH and LIM, then added to the protocol’s Uniswap V4 liquidity pool.
    function collectLiquidityFees(address tokenAddress, address to) external onlyOwner {
        require(tokenAddress != address(0), "Invalid token address");
        require(to != address(0), "Invalid address");
        uint256 amount = liquidityPoolFees[tokenAddress];
        require(amount > 0, "No liquidity fees");
        liquidityPoolFees[tokenAddress] = 0;
        IERC20(tokenAddress).safeTransfer(to, amount);
        emit FeeCollected(tokenAddress, amount, "liquidityPool", to);
    }

    /// @notice Manage loader role
    function grantLoaderRole(address account) external onlyOwner {
        grantRole(POOL_LOADER_ROLE, account);
    }

    function revokeLoaderRole(address account) external onlyOwner {
        revokeRole(POOL_LOADER_ROLE, account);
    }

    /// @notice Manage game contract role
    function grantGameContractRole(address account) external onlyOwner {
        grantRole(GAME_CONTRACT_ROLE, account);
    }

    function revokeGameContractRole(address account) external onlyOwner {
        revokeRole(GAME_CONTRACT_ROLE, account);
    }
}
