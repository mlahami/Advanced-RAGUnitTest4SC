
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/governance/utils/IVotes.sol";

/**
 * @title IAVGXToken
 * @dev Interface for the AVGX token contract
 */
interface IAVGXToken is IERC20, IERC20Permit, IVotes {
    event Minted(address indexed to, uint256 amount);
    event Burned(address indexed from, uint256 amount);
    event MaxSupplySet(uint256 maxSupply);

    error MaxSupplyExceeded();
    error MaxSupplyAlreadySet();

    /**
     * @dev Mints tokens to specified address
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external;

    /**
     * @dev Burns tokens from specified address with allowance check
     * @param from Address to burn tokens from
     * @param amount Amount of tokens to burn
     */
    function burnFrom(address from, uint256 amount) external;

    /**
     * @dev Sets maximum supply (can only be called once)
     * @param maxSupply Maximum supply limit
     */
    function setMaxSupply(uint256 maxSupply) external;

    /**
     * @dev Returns the maximum supply
     * @return Maximum supply limit
     */
    function maxSupplyAVGX() external view returns (uint256);

    /**
     * @dev Pauses all token transfers
     */
    function pause() external;

    /**
     * @dev Unpauses all token transfers
     */
    function unpause() external;
}
