# game-treasury--mdantis-dev

- domain: multisig-treasury (treasury)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/mdantis-dev/SOLIDITY-Liminal-Games @ 09a7484ac7f92e054eedc087b2d03431968e435b
- license: MIT
- targets: GameTreasury.sol, LiminalToken.sol
- validation: 11 passing tests, 0 failing; statement coverage GameTreasury.sol 93.48 %, LiminalToken.sol 44.44 %

## Contract: GameTreasury.sol (primary target)

```solidity
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
```

## Contract: LiminalToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Liminal Token (LIM)
/// @notice ERC20 token with on-chain governance voting, pausing, and burn functionality for the Liminal Games ecosystem.
contract LiminalToken is ERC20Votes, Pausable, Ownable {
    
    /// @notice Deploys the LIM token, mints 400M tokens to the deployer, and enables governance voting support.
    constructor() ERC20("Liminal Token", "LIM") EIP712("Liminal Token", "1") Ownable(msg.sender) {
        _mint(msg.sender, 400_000_000 * 10 ** decimals());
    }

    /// @notice Pauses all token transfers. Only callable by the owner.
    function pause() public onlyOwner {
        _pause();
    }

    /// @notice Unpauses token transfers. Only callable by the owner.
    function unpause() public onlyOwner {
        _unpause();
    }

    /// @notice Transfers tokens to another address when not paused.
    function transfer(address to, uint256 amount) public override whenNotPaused returns (bool) {
        return super.transfer(to, amount);
    }

    /// @notice Transfers tokens from a sender to a recipient when not paused.
    function transferFrom(address from, address to, uint256 amount) public override whenNotPaused returns (bool) {
        return super.transferFrom(from, to, amount);
    }

    /// @notice Burns tokens from the caller's wallet.
    function burn(uint256 amount) public {
        _burn(msg.sender, amount);
    }

    /// @notice Burns tokens from another address using allowance.
    function burnFrom(address from, uint256 amount) public {
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
    }

    /// @notice Internal function to update vote tracking on transfers.
    function _update(address from, address to, uint256 value) internal override(ERC20Votes) {
        super._update(from, to, value);
    }
}
```

## Tests: GameTreasury.js

```javascript

const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GameTreasury – Vesting & Fee Management", function () {
  async function deployFixture() {
    const [owner, user1, feeCollector, user2] = await ethers.getSigners();

    // Deploy token
    const Token = await ethers.getContractFactory("LiminalToken");
    const lim = await Token.deploy();
    await lim.waitForDeployment();

    // Deploy treasury
    const upfrontUnlocked = ethers.parseEther("5000000");
    const totalAllocation = ethers.parseEther("75000000");
    const vestingDuration = 6 * 30 * 24 * 60 * 60;       // 6 months
    const Treasury = await ethers.getContractFactory("GameTreasury");
    const treasury = await Treasury.deploy(await lim.getAddress(), totalAllocation, upfrontUnlocked, vestingDuration);
    await treasury.waitForDeployment();

    // Fund treasury with full 75M LIM
    await treasury.connect(owner).grantLoaderRole(owner.address);
    const fullAmount = ethers.parseUnits("75000000", 18);
    await lim.approve(treasury.target, fullAmount);
    await treasury.connect(owner).receiveRewardTokens(fullAmount);

    // test game fee pool
    const testGameFeeAmount = ethers.parseUnits("1000", 18);
    await lim.approve(treasury.target, testGameFeeAmount);
    await treasury.connect(owner).receiveGameFeeTokens(testGameFeeAmount);

    // Grant GAME_CONTRACT_ROLE to owner for testing
    await treasury.connect(owner).grantGameContractRole(owner.address);

    return { owner, user1, feeCollector, user2, lim, treasury };
  }

  it("should allow upfront transfer of 5M tokens", async () => {
    const { treasury, lim, owner, user1 } = await loadFixture(deployFixture);
    const upfront = ethers.parseUnits("5000000", 18);
    await expect(treasury.transferTokens(user1.address, upfront))
      .to.emit(treasury, "TokensTransferred")
      .withArgs(user1.address, upfront);
    expect(await lim.balanceOf(user1.address)).to.equal(upfront);
  });

  it("should prevent transfer beyond current releasable amount", async () => {
    const { treasury, user1 } = await loadFixture(deployFixture);
    const tooMuch = ethers.parseUnits("6000000", 18); // Only 5M vested initially
    await expect(treasury.transferTokens(user1.address, tooMuch)).to.be.revertedWith("Insufficient unlocked tokens");
  });

  it("should unlock tokens linearly over 6 months", async () => {
    const { treasury } = await loadFixture(deployFixture);
    const halfVesting = 90 * 24 * 60 * 60; // 90 days
    await time.increase(halfVesting);
    const releasable = await treasury.releasable();
    const expected = ethers.parseUnits("40000000", 18); // 5M + half of remaining 70M
    const diff = releasable - expected;
    expect(diff).to.be.lessThanOrEqual(ethers.parseUnits("33", 18)); // < 0.01 LIM
  });

  it("should allow GAME_CONTRACT_ROLE to add fees", async () => {
    const { treasury, lim, owner } = await loadFixture(deployFixture);
    const token = await lim.getAddress();
    const fee = ethers.parseUnits("500", 18);
    await lim.approve(treasury.target, fee * 2n);
    await treasury.addGameFee(token, fee);
    await treasury.addLiquidityFee(token, fee);
    expect(await treasury.gameTreasuryFees(token)).to.equal(fee);
    expect(await treasury.liquidityPoolFees(token)).to.equal(fee);
  });

  it("should allow owner to collect fees", async () => {
    const { treasury, lim, feeCollector, owner } = await loadFixture(deployFixture);
    const token = await lim.getAddress();
    const fee = ethers.parseUnits("1000", 18);
    await lim.approve(treasury.target, fee * 2n);
    await treasury.addGameFee(token, fee);
    await treasury.addLiquidityFee(token, fee);
    await expect(treasury.collectGameFees(token, feeCollector.address))
      .to.emit(treasury, "FeeCollected")
      .withArgs(token, fee, "gameTreasury", feeCollector.address);
    await expect(treasury.collectLiquidityFees(token, feeCollector.address))
      .to.emit(treasury, "FeeCollected")
      .withArgs(token, fee, "liquidityPool", feeCollector.address);
    expect(await lim.balanceOf(feeCollector.address)).to.equal(fee * 2n);
  });

  it("should restrict fee collection to owner only", async () => {
    const { treasury, user1, lim } = await loadFixture(deployFixture);
    const token = await lim.getAddress();
    await expect(treasury.connect(user1).collectGameFees(token, user1.address)).to.be.reverted;
    await expect(treasury.connect(user1).collectLiquidityFees(token, user1.address)).to.be.reverted;
  });

  it("should restrict fee adding to GAME_CONTRACT_ROLE", async () => {
    const { treasury, user1, lim } = await loadFixture(deployFixture);
    const token = await lim.getAddress();
    const amt = ethers.parseUnits("100", 18);
    await expect(treasury.connect(user1).addGameFee(token, amt)).to.be.reverted;
    await expect(treasury.connect(user1).addLiquidityFee(token, amt)).to.be.reverted;
  });

  it("should use gameFeeFunds first before touching vested tokens", async () => {
    const { treasury, lim, user1 } = await loadFixture(deployFixture);
    const feeAmount = ethers.parseUnits("1000", 18);
    await expect(treasury.transferTokens(user1.address, feeAmount))
      .to.emit(treasury, "TokensTransferred")
      .withArgs(user1.address, feeAmount);
    expect(await treasury.gameFeeFunds()).to.equal(0);
    expect(await treasury.released()).to.equal(0);
    expect(await lim.balanceOf(user1.address)).to.equal(feeAmount);
  });

  it("should use gameFeeFunds and then fall back to vested tokens", async () => {
    const { treasury, lim, user1 } = await loadFixture(deployFixture);
    const upfront = ethers.parseUnits("5000000", 18);
    const feeAmount = ethers.parseUnits("1000", 18);
    const combined = feeAmount + upfront;
    await expect(treasury.transferTokens(user1.address, combined))
      .to.emit(treasury, "TokensTransferred")
      .withArgs(user1.address, combined);
    expect(await treasury.gameFeeFunds()).to.equal(0);
    expect(await treasury.released()).to.equal(upfront);
    expect(await lim.balanceOf(user1.address)).to.equal(combined);
  });

  it("should revert if transfer exceeds gameFeeFunds + releasable", async () => {
    const { treasury, user1 } = await loadFixture(deployFixture);
    const tooMuch = ethers.parseUnits("6000001", 18); // 5M upfront + 1000 fee + 1 extra
    await expect(treasury.transferTokens(user1.address, tooMuch)).to.be.revertedWith("Insufficient unlocked tokens");
  });

  it("should allow owner to transfer full vested amount over time", async () => {
    const { treasury, lim, user1 } = await loadFixture(deployFixture);
    const upfront = ethers.parseUnits("5000000", 18);
    const total = ethers.parseUnits("75000000", 18);
    await expect(treasury.transferTokens(user1.address, upfront)).to.emit(treasury, "TokensTransferred").withArgs(user1.address, upfront);
    await time.increase(90 * 24 * 60 * 60);
    const halfUnlocked = await treasury.releasable();
    await expect(treasury.transferTokens(user1.address, halfUnlocked)).to.emit(treasury, "TokensTransferred").withArgs(user1.address, halfUnlocked);
    await time.increase(90 * 24 * 60 * 60);
    const finalUnlocked = await treasury.releasable();
    await expect(treasury.transferTokens(user1.address, finalUnlocked)).to.emit(treasury, "TokensTransferred").withArgs(user1.address, finalUnlocked);
    const userBalance = await lim.balanceOf(user1.address);
    expect(userBalance).to.equal(total + ethers.parseUnits("1000", 18)); // +1000 from gameFeeFunds
  });
});
```
