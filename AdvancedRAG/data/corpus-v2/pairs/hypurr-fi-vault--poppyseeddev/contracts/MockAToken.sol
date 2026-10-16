// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockAToken
 * @notice Mock implementation of HypurrFi's hyToken (aToken equivalent)
 * @dev Receipt token minted when users supply assets to the pool
 * Only the pool contract can mint/burn these tokens
 */
contract MockAToken is ERC20, Ownable {
    address public immutable underlyingAsset;
    address public immutable pool;

    /**
     * @notice Constructor
     * @param name Token name (e.g., "HypurrFi USDC")
     * @param symbol Token symbol (e.g., "hyUSDC")
     * @param underlyingAsset_ Address of the underlying asset
     * @param pool_ Address of the pool contract
     */
    constructor(
        string memory name,
        string memory symbol,
        address underlyingAsset_,
        address pool_
    ) ERC20(name, symbol) Ownable(msg.sender) {
        underlyingAsset = underlyingAsset_;
        pool = pool_;
    }

    /**
     * @notice Mint aTokens to an address
     * @dev Only callable by the pool
     * @param account Address to mint to
     * @param amount Amount to mint
     */
    function mint(address account, uint256 amount) external onlyOwner {
        require(msg.sender == pool, "Only pool can mint");
        _mint(account, amount);
    }

    /**
     * @notice Burn aTokens from an address
     * @dev Only callable by the pool
     * @param account Address to burn from
     * @param amount Amount to burn
     */
    function burn(address account, uint256 amount) external onlyOwner {
        require(msg.sender == pool, "Only pool can burn");
        _burn(account, amount);
    }

    /**
     * @notice Get the underlying asset address
     * @return Address of the underlying asset
     */
    function UNDERLYING_ASSET_ADDRESS() external view returns (address) {
        return underlyingAsset;
    }

    /**
     * @notice Get the pool address
     * @return Address of the pool
     */
    function POOL() external view returns (address) {
        return pool;
    }

    /**
     * @notice Returns the scaled balance of the user
     * @dev For simplicity, we return the regular balance (1:1 ratio)
     * @param user Address of the user
     * @return The scaled balance
     */
    function scaledBalanceOf(address user) external view returns (uint256) {
        return balanceOf(user);
    }
}
