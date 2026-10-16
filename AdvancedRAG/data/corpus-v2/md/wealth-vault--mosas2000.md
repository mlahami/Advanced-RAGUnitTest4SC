# wealth-vault--mosas2000

- domain: staking-yield (yield-vault)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Mosas2000/W-Yield @ 1590d40fe73b7d55ce9de5ab98b228b867faea25
- license: MIT
- targets: WealthVault.sol, IWealthVault.sol, MockUSDC.sol
- validation: 18 passing tests, 0 failing; statement coverage WealthVault.sol 100.0 %, IWealthVault.sol 100.0 %, MockUSDC.sol 50.0 %

## Contract: IWealthVault.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IWealthVault
 * @notice W-Yield vault interface
 */
interface IWealthVault {
    event Deposit(address indexed user, uint256 usdcAmount, uint256 shares);
    event Withdraw(address indexed user, uint256 shares, uint256 usdcAmount);
    
    function deposit(uint256 amount) external returns (uint256 shares);
    function withdraw(uint256 shares) external returns (uint256 amount);
}
```

## Contract: MockUSDC.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    
    function decimals() public pure override returns (uint8) {
        return 6;
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Contract: WealthVault.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IWealthVault.sol";

contract WealthVault is ERC20, Ownable, ReentrancyGuard, IWealthVault {
    using SafeERC20 for IERC20;
    
    // State variables
    IERC20 public immutable usdc;
    uint256 public performanceFee; // basis points
    address public feeRecipient;
    
    // Constants
    uint256 public constant MIN_DEPOSIT = 1e6; // 1 USDC
    uint256 public constant MAX_DEPOSIT = 1000000e6; // 1M USDC
    uint256 public constant MAX_FEE = 1000; // 10%
    uint256 public constant BASIS_POINTS = 10000;
    
    // Events
    event FeeUpdated(uint256 newFee);
    event FeeRecipientUpdated(address newRecipient);
    
    /**
     * @notice Initialize W-Yield vault
     * @param _usdc USDC token address
     */
    constructor(address _usdc) ERC20("W-Yield USDC", "wUSDC") Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC");
        usdc = IERC20(_usdc);
        performanceFee = 200; // 2%
        feeRecipient = msg.sender;
    }
    
    /**
     * @notice Get total USDC in vault
     */
    function totalAssets() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
    
    /**
     * @notice Convert USDC to shares
     */
    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? assets : (assets * supply) / totalAssets();
    }
    
    /**
     * @notice Convert shares to USDC
     */
    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? shares : (shares * totalAssets()) / supply;
    }
    
    /**
     * @notice Deposit USDC to earn yield
     * @param amount USDC amount to deposit
     * @return shares wUSDC shares minted
     */
    function deposit(uint256 amount) external nonReentrant returns (uint256 shares) {
        require(amount >= MIN_DEPOSIT, "Below minimum");
        require(amount <= MAX_DEPOSIT, "Above maximum");
        
        shares = convertToShares(amount);
        require(shares > 0, "Zero shares");
        
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, shares);
        
        emit Deposit(msg.sender, amount, shares);
    }
    
    /**
     * @notice Withdraw USDC by burning shares
     * @param shares wUSDC shares to burn
     * @return amount USDC withdrawn
     */
    function withdraw(uint256 shares) external nonReentrant returns (uint256 amount) {
        require(shares > 0, "Zero shares");
        require(balanceOf(msg.sender) >= shares, "Insufficient balance");
        
        amount = convertToAssets(shares);
        require(amount > 0, "Zero amount");
        
        _burn(msg.sender, shares);
        usdc.safeTransfer(msg.sender, amount);
        
        emit Withdraw(msg.sender, shares, amount);
    }
    
    /**
     * @notice Update performance fee (max 10%)
     */
    function setPerformanceFee(uint256 _fee) external onlyOwner {
        require(_fee <= MAX_FEE, "Fee too high");
        performanceFee = _fee;
        emit FeeUpdated(_fee);
    }
    
    /**
     * @notice Update fee recipient
     */
    function setFeeRecipient(address _recipient) external onlyOwner {
        require(_recipient != address(0), "Invalid address");
        feeRecipient = _recipient;
        emit FeeRecipientUpdated(_recipient);
    }
}
```

## Tests: WealthVault.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("WealthVault - W-Yield", function () {
    let vault, usdc, owner, user1, user2;
    
    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();
        
        // Deploy MockUSDC
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdc = await MockUSDC.deploy();
        
        // Deploy WealthVault
        const WealthVault = await ethers.getContractFactory("WealthVault");
        vault = await WealthVault.deploy(usdc.target);
    });
    
    describe("Deployment", function () {
        it("Should set correct name and symbol", async function () {
            expect(await vault.name()).to.equal("W-Yield USDC");
            expect(await vault.symbol()).to.equal("wUSDC");
        });
        
        it("Should set correct USDC address", async function () {
            expect(await vault.usdc()).to.equal(usdc.target);
        });
        
        it("Should set owner as fee recipient", async function () {
            expect(await vault.feeRecipient()).to.equal(owner.address);
        });
    });
    
    describe("Deposit", function () {
        it("Should deposit USDC and mint shares", async function () {
            const amount = ethers.parseUnits("100", 6);
            
            await usdc.mint(user1.address, amount);
            await usdc.connect(user1).approve(vault.target, amount);
            
            await vault.connect(user1).deposit(amount);
            expect(await vault.balanceOf(user1.address)).to.equal(amount);
        });
        
        it("Should revert if below minimum", async function () {
            const small = ethers.parseUnits("0.5", 6);
            await usdc.mint(user1.address, small);
            await usdc.connect(user1).approve(vault.target, small);
            
            await expect(
                vault.connect(user1).deposit(small)
            ).to.be.revertedWith("Below minimum");
        });
        
        it("Should emit Deposit event", async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(user1.address, amount);
            await usdc.connect(user1).approve(vault.target, amount);
            
            await expect(vault.connect(user1).deposit(amount))
                .to.emit(vault, "Deposit")
                .withArgs(user1.address, amount, amount);
        });
    });
    
    describe("Withdraw", function () {
        beforeEach(async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(user1.address, amount);
            await usdc.connect(user1).approve(vault.target, amount);
            await vault.connect(user1).deposit(amount);
        });
        
        it("Should withdraw USDC and burn shares", async function () {
            const shares = await vault.balanceOf(user1.address);
            
            await expect(vault.connect(user1).withdraw(shares))
                .to.emit(vault, "Withdraw");
            
            expect(await vault.balanceOf(user1.address)).to.equal(0);
        });
        
        it("Should revert if insufficient balance", async function () {
            const tooMany = ethers.parseUnits("200", 6);
            
            await expect(
                vault.connect(user1).withdraw(tooMany)
            ).to.be.revertedWith("Insufficient balance");
        });
        
        it("Should revert on zero shares", async function () {
            await expect(
                vault.connect(user1).withdraw(0)
            ).to.be.revertedWith("Zero shares");
        });
    });
    
    describe("Admin Functions", function () {
        it("Should update performance fee", async function () {
            await vault.setPerformanceFee(300);
            expect(await vault.performanceFee()).to.equal(300);
        });
        
        it("Should revert fee above max", async function () {
            await expect(
                vault.setPerformanceFee(1500)
            ).to.be.revertedWith("Fee too high");
        });
        
        it("Should update fee recipient", async function () {
            await vault.setFeeRecipient(user1.address);
            expect(await vault.feeRecipient()).to.equal(user1.address);
        });
        
        it("Should prevent non-owner admin calls", async function () {
            await expect(
                vault.connect(user1).setPerformanceFee(300)
            ).to.be.reverted;
        });
        
        it("Should emit FeeUpdated event", async function () {
            await expect(vault.setPerformanceFee(300))
                .to.emit(vault, "FeeUpdated")
                .withArgs(300);
        });
        
        it("Should emit FeeRecipientUpdated event", async function () {
            await expect(vault.setFeeRecipient(user1.address))
                .to.emit(vault, "FeeRecipientUpdated")
                .withArgs(user1.address);
        });
    });
    
    describe("View Functions", function () {
        it("Should return correct totalAssets", async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(user1.address, amount);
            await usdc.connect(user1).approve(vault.target, amount);
            await vault.connect(user1).deposit(amount);
            
            expect(await vault.totalAssets()).to.equal(amount);
        });
        
        it("Should convert assets to shares correctly", async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(user1.address, amount);
            await usdc.connect(user1).approve(vault.target, amount);
            await vault.connect(user1).deposit(amount);
            
            expect(await vault.convertToShares(amount)).to.equal(amount);
        });
        
        it("Should convert shares to assets correctly", async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(user1.address, amount);
            await usdc.connect(user1).approve(vault.target, amount);
            await vault.connect(user1).deposit(amount);
            
            const shares = await vault.balanceOf(user1.address);
            expect(await vault.convertToAssets(shares)).to.equal(amount);
        });
    });
});
```
