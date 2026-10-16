// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Six-decimal mintable ERC20 mirroring USDC's shape. Test suite only —
///         never deployed to a public network (Sepolia uses Circle's USDC).
contract TestUSDC is ERC20 {
    constructor() ERC20("Test USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
