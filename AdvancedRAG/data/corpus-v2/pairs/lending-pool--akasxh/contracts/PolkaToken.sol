// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PolkaToken
 * @notice ERC-20 governance token for the PolkaLend protocol.
 *         Used for fee discounts, governance voting, and liquidity mining rewards.
 */
contract PolkaToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 100_000_000 ether; // 100 M

    constructor() ERC20("PolkaLend Token", "PLEND") Ownable(msg.sender) {
        // Mint initial supply to deployer (treasury)
        _mint(msg.sender, 10_000_000 ether); // 10 M initial
    }

    /**
     * @notice Mint new tokens (capped at MAX_SUPPLY). Owner-only.
     */
    function mint(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "PolkaToken: cap exceeded");
        _mint(to, amount);
    }
}
