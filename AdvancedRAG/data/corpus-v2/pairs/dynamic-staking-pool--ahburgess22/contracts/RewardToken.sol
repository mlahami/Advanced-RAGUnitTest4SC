// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Importing OpenZeppelin contracts for ERC20 functionality, caps, and ownership control
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RewardToken
 * @dev ERC20 token with a capped supply, restricted minting by staking contract, and ownership control.
 */
contract RewardToken is ERC20, ERC20Capped, Ownable {
    // Address of the authorized staking contract
    address private _stakingContract;

    /**
     * @dev Constructor to initialize the RewardToken with name, symbol, and capped supply.
     * @param maxSupply The maximum supply of the token (scaled by 10^18 for decimals).
     */
    constructor(uint256 maxSupply) ERC20("Reward Token", "RTK") ERC20Capped(maxSupply) Ownable(msg.sender) { }

    /**
     * @dev Internal function to handle token updates during transfers.
     * @param from The address transferring tokens.
     * @param to The address receiving tokens.
     * @param amount The amount of tokens being transferred.
     */
    function _update(address from, address to, uint256 amount) internal virtual override(ERC20, ERC20Capped) {
        super._update(from, to, amount); // Calls parent implementation
    }

    /**
     * @dev Public wrapper for testing internal _update functionality.
     * @param from The address transferring tokens.
     * @param to The address receiving tokens.
     * @param amount The amount of tokens being transferred.
     */
    function testUpdate(address from, address to, uint256 amount) public {
        _update(from, to, amount);
    }

    /**
     * @dev Mints new tokens.
     * @param to The address receiving the minted tokens.
     * @param amount The amount of tokens to mint.
     * Requirements:
     * - Only the staking contract can call this function.
     * - Total supply must not exceed the cap.
     */
    function mint(address to, uint256 amount) public onlyAuthorized {
        require(totalSupply() + amount <= cap(), "RTK: ERC20 cap exceeded.");
        _mint(to, amount);
    }

    function setAuthorizedStaker(address stakingContract) public onlyOwner {
        _stakingContract = stakingContract;
    }

    modifier onlyAuthorized() {
        require(
            msg.sender == owner() || msg.sender == _stakingContract,
            "RTK: Unauthorized"
        );
        _;
    }

    
}