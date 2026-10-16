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
