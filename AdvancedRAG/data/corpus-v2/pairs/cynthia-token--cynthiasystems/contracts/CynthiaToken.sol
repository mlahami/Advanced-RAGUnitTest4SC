// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CynthiaToken
 * @dev Implementation of the Cynthia token ($CYNTHIA) with a fixed supply model.
 *
 * This contract creates an ERC20 token with a predetermined, immutable supply.
 * Once deployed, the total number of tokens remains constant, promoting
 * scarcity and potentially long-term value appreciation.
 *
 * Tokenomics:
 * - Fixed Total Supply: 100 million $CYNTHIA tokens
 * - No Minting: After initial minting, no new tokens can be created
 * - No Burning: The contract does not implement token burning, maintaining the fixed supply
 *
 * Benefits of this simplified, fixed-supply approach:
 * 1. Predictability: Users and investors can rely on a constant token supply.
 * 2. Scarcity: A capped supply can drive value through limited availability.
 * 3. Simplicity: Easy to understand tokenomics with no complex inflation or deflation mechanisms.
 * 4. Security: Reduced attack surface due to minimal functionality.
 * 5. Gas Efficiency: Simple operations lead to lower gas costs for transfers.
 * 6. Transparency: The monetary policy is clear and immutable.
 * 7. Fairness: All tokens are minted at deployment, ensuring a fair initial distribution.
 *
 * Use Cases:
 * This token is designed for straightforward value transfer and storage within the
 * Cynthia Systems ecosystem, particularly suited for stable, long-term token economics.
 */

/// @custom:security-contact cynthia@cynthiasystems.com
contract CynthiaToken is ERC20, Ownable {
    /**
     * @dev Sets the total supply of tokens.
     * The value is set to 100 million tokens, with 18 decimal places for division.
     * This ensures a large enough supply for wide distribution and precise transactions.
     */
    uint256 public constant TOTAL_SUPPLY = 100_000_000 * 10**18; // 100 million tokens with 18 decimals

    /**
     * @dev Creates `TOTAL_SUPPLY` tokens and assigns them to `initialOwner`.
     * This sets up the initial distribution of tokens.
     *
     * @param initialOwner The address that will receive the total initial supply.
     */
    constructor(address initialOwner)
        ERC20("CynthiaToken", "CYNTHIA")
        Ownable(initialOwner)
    {
        _mint(initialOwner, TOTAL_SUPPLY);
    }

    // Note: The absence of additional functions like mint() or burn() 
    // reinforces the fixed supply nature of this token.
}
