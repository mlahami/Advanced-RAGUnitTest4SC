// contracts/mocks/MockDOC.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @notice Fake DOC token for local testing only.
 *         Lets us mint tokens freely without needing the real RSK testnet.
 */
contract MockDOC is ERC20 {
    constructor() ERC20("Mock DOC", "mDOC") {
        // Mint 1 million tokens to deployer on creation
        _mint(msg.sender, 1_000_000 * 10 ** 18);
    }

    // Anyone can mint in tests — makes setup simple
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}