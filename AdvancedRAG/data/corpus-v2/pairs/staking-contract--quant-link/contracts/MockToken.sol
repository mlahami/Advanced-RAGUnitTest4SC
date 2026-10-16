// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockToken
 * @author Quantlink Team
 * @notice An ERC20 token implementation for the Quantlink staking platform
 * @dev A professional ERC20 token contract for testing and demonstrating the staking functionality
 *
 * This contract implements a standard ERC20 token with additional minting capabilities
 * restricted to the contract owner. It is designed to be used with the StakingContract
 * for demonstration and testing purposes.
 *
 * The token includes:
 * - Standard ERC20 functionality (transfer, approve, transferFrom, etc.)
 * - Minting capability restricted to the contract owner
 * - Initial supply minted to the deployer
 *
 * Security considerations:
 * - Uses OpenZeppelin's ERC20 implementation for security and standard compliance
 * - Implements Ownable for privileged functions like minting
 */
contract MockToken is ERC20, Ownable {
    /**
     * @notice Initializes the token with a name, symbol, and initial supply
     * @dev Constructor that creates the token and mints the initial supply to the deployer
     *
     * The constructor:
     * 1. Initializes the ERC20 token with the provided name and symbol
     * 2. Sets the deployer as the owner of the contract
     * 3. Mints the initial supply to the deployer, adjusted for the token's decimals
     *
     * @param name The name of the token (e.g., "Quantlink Token")
     * @param symbol The symbol of the token (e.g., "QNTL")
     * @param initialSupply The initial supply of tokens to mint (in whole tokens, not wei)
     */
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) Ownable(msg.sender) {
        require(initialSupply > 0, "Initial supply must be greater than zero");
        require(bytes(name).length > 0, "Token name cannot be empty");
        require(bytes(symbol).length > 0, "Token symbol cannot be empty");

        // Mint the initial supply to the deployer, adjusted for decimals
        // For example, if initialSupply is 1000 and decimals is 18, this will mint 1000 * 10^18 tokens
        _mint(msg.sender, initialSupply * 10 ** decimals());
    }

    /**
     * @notice Creates new tokens and assigns them to the specified address
     * @dev Mints new tokens, increasing the total supply
     *
     * This function:
     * 1. Verifies that only the owner can mint tokens
     * 2. Mints the specified amount of tokens to the specified address
     * 3. Returns true to indicate success
     *
     * Requirements:
     * - Can only be called by the contract owner
     * - The recipient address cannot be the zero address (enforced by _mint)
     *
     * @param to The address that will receive the minted tokens
     * @param amount The amount of tokens to mint (in wei, not adjusted for decimals)
     * @return A boolean that indicates if the operation was successful
     */
    function mint(address to, uint256 amount) public onlyOwner returns (bool) {
        require(to != address(0), "Cannot mint to the zero address");
        require(amount > 0, "Amount must be greater than zero");

        _mint(to, amount);
        return true;
    }

    /**
     * @notice Returns the number of decimals used by the token
     * @dev Overrides the ERC20 decimals function to provide additional documentation
     *
     * The token uses 18 decimals for compatibility with Ethereum standards and to allow
     * for fractional token amounts with high precision.
     *
     * @return The number of decimals used by the token (18)
     */
    function decimals() public view virtual override returns (uint8) {
        return 18;
    }
}
