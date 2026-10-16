// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title BaseToken
 * @notice ERC20 token with mint capabilities and pausable transfers
 * @dev Built for Base network with Ownable access control and Pausable for emergency stops
 */
contract BaseToken is ERC20, Ownable, Pausable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10 ** 18;

    event Minted(address indexed to, uint256 amount);

    /**
     * @notice Deploy the token with a name and symbol
     * @param _name Full token name
     * @param _symbol Token ticker symbol
     * @dev Mints 100M initial supply to the deployer
     */
    constructor(
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        _mint(msg.sender, 100_000_000 * 10 ** 18);
    }

    /**
     * @notice Mint new tokens
     * @dev Only callable by owner, respects MAX_SUPPLY cap
     * @param to Recipient address
     * @param amount Amount of tokens to mint (in wei)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "BaseToken: max supply exceeded");
        _mint(to, amount);
        emit Minted(to, amount);
    }

    /**
     * @notice Pause all token transfers
     * @dev Only callable by owner, emergency use
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause token transfers
     * @dev Only callable by owner
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Hook that ensures transfers respect pause state
     * @dev Overrides ERC20 _update with Pausable check
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override whenNotPaused {
        super._update(from, to, value);
    }
}
