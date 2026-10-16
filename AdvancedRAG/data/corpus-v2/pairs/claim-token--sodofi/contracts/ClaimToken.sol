// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ClaimToken
 * @dev ERC-20 token that allows users to claim 10 tokens once per address
 */
contract ClaimToken is ERC20, Ownable, ReentrancyGuard {
    // Fixed claim amount - 10 tokens
    uint256 public constant CLAIM_AMOUNT = 10 * 10**18; // 10 tokens
    
    // Maximum total supply
    uint256 public constant MAX_TOTAL_SUPPLY = 1000000 * 10**18; // 1M tokens
    
    // Mapping to track if an address has already claimed
    mapping(address => bool) public hasClaimed;
    
    // Events
    event TokensClaimed(address indexed claimer, uint256 amount);
    
    constructor(
        string memory name,
        string memory symbol,
        address initialOwner
    ) ERC20(name, symbol) Ownable(initialOwner) {
        // Mint initial supply to owner
        _mint(initialOwner, 10000 * 10**18); // 10,000 tokens to owner
    }
    
    /**
     * @dev Allows users to claim 10 tokens (once per address)
     */
    function claimTokens() external nonReentrant {
        require(!hasClaimed[msg.sender], "Address has already claimed tokens");
        require(
            totalSupply() + CLAIM_AMOUNT <= MAX_TOTAL_SUPPLY,
            "Would exceed maximum total supply"
        );
        
        // Mark address as having claimed
        hasClaimed[msg.sender] = true;
        
        // Mint tokens to claimer
        _mint(msg.sender, CLAIM_AMOUNT);
        
        emit TokensClaimed(msg.sender, CLAIM_AMOUNT);
    }
    
    /**
     * @dev Check if an address can claim tokens
     * @param claimer The address to check
     * @return canClaim Whether the address can claim
     */
    function canClaimTokens(address claimer) external view returns (bool canClaim) {
        return !hasClaimed[claimer];
    }
    
    /**
     * @dev Get the claim amount
     * @return The claim amount (always 10 tokens)
     */
    function getClaimAmount() external pure returns (uint256) {
        return CLAIM_AMOUNT;
    }
    
    /**
     * @dev Owner can mint additional tokens (for airdrops, etc.)
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint
     */
    function ownerMint(address to, uint256 amount) external onlyOwner {
        require(
            totalSupply() + amount <= MAX_TOTAL_SUPPLY,
            "Would exceed maximum total supply"
        );
        _mint(to, amount);
    }
    
    /**
     * @dev Get remaining supply that can be minted
     * @return The remaining mintable supply
     */
    function getRemainingSupply() external view returns (uint256) {
        return MAX_TOTAL_SUPPLY - totalSupply();
    }
} 