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
