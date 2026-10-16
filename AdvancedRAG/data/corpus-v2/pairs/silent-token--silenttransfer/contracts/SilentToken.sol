// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Silent Token (SILENT)
/// @notice Product ERC-20 for SilentTransfer. Hard-capped at 1,000,000,000 tokens.
/// @dev No KYC / transfer whitelist. No mint above MAX_SUPPLY (1B whole tokens).
contract SilentToken is ERC20, Ownable {
    /// @notice Maximum total supply in whole tokens (1 billion). Scaled by decimals() in storage.
    uint256 public constant MAX_SUPPLY_WHOLE = 1_000_000_000;

    uint8 private immutable _decimals;
    uint256 public immutable maxSupply;

    error ZeroAddress();
    error ZeroAmount();
    error CapExceeded(uint256 attempted, uint256 maxSupply_);
    error InitialMintExceedsCap();

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address initialOwner,
        uint256 initialMint
    ) ERC20(name_, symbol_) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        _decimals = decimals_;
        maxSupply = MAX_SUPPLY_WHOLE * (10 ** uint256(decimals_));

        if (initialMint > maxSupply) revert InitialMintExceedsCap();
        if (initialMint > 0) {
            _mint(initialOwner, initialMint);
        }
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /// @notice Remaining mintable amount (0 when fully capped).
    function remainingMintable() public view returns (uint256) {
        return maxSupply - totalSupply();
    }

    /// @notice Owner mint — reverts if it would exceed the 1B hard cap.
    /// @dev When totalSupply == maxSupply, no further mint is possible.
    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 next = totalSupply() + amount;
        if (next > maxSupply) revert CapExceeded(next, maxSupply);
        _mint(to, amount);
    }

    /// @notice Owner faucet — same hard cap as mint.
    function faucet(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        uint256 next = totalSupply() + amount;
        if (next > maxSupply) revert CapExceeded(next, maxSupply);
        _mint(msg.sender, amount);
    }
}
