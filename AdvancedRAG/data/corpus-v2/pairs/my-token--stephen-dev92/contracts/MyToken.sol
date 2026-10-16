// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MyToken
/// @notice A simple ERC-20 token with mint (owner-only) and burn (anyone, their own balance).
/// @dev Built on OpenZeppelin's audited ERC20 and Ownable implementations rather than
///      writing the token logic from scratch — this is the standard, professional approach.
contract MyToken is ERC20, Ownable {
    /// @param initialSupply Number of whole tokens minted to the deployer at launch (18 decimals applied automatically).
    constructor(uint256 initialSupply)
        ERC20("MyToken", "MTK")
        Ownable(msg.sender)
    {
        _mint(msg.sender, initialSupply * 10 ** decimals());
    }

    /// @notice Create new tokens. Only the contract owner can call this.
    /// @param to Address to receive the new tokens.
    /// @param amount Number of whole tokens to mint (18 decimals applied automatically).
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount * 10 ** decimals());
    }

    /// @notice Destroy tokens from your own balance, reducing total supply.
    /// @param amount Number of whole tokens to burn (18 decimals applied automatically).
    function burn(uint256 amount) external {
        _burn(msg.sender, amount * 10 ** decimals());
    }
}
