// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title A mock Dai token for testing and development purposes.
/// @notice This contract is a simplified version of the Dai stablecoin, intended for use in development environments.
/// @dev Inherits from OpenZeppelin's ERC20 and Ownable contracts.
contract MockDai is ERC20, Ownable {
    /// @dev Initializes the contract with an initial supply of tokens and assigns them to the deployer.
    /// @param initialSupply The amount of tokens to mint upon deployment.
    constructor(uint256 initialSupply) ERC20("Mock Dai Stablecoin", "mDAI") Ownable(msg.sender) {
        _mint(msg.sender, initialSupply);
    }

    /// @notice Allows users to buy mock Dai tokens by sending Ether to the contract.
    /// @dev Mints new mock Dai tokens based on the amount of Ether sent and the predefined conversion rate.
    function buyMockDai() external payable {
        require(msg.value > 0, "You need to send ether to buy MockDai");
        uint256 amountToMint = msg.value * 1000; // Conversion rate: 1 Ether = 1000 mDAI.
        _mint(msg.sender, amountToMint);
    }

    /// @notice Allows users to sell their mock Dai tokens back to the contract in exchange for Ether.
    /// @dev Burns the mock Dai tokens and transfers Ether to the user based on the predefined conversion rate.
    /// @param amount The amount of mock Dai tokens to sell.
    function sellMockDai(uint256 amount) external {
        require(amount > 1, "You must sell at least 1 mDAI");
        require(balanceOf(msg.sender) >= amount, "You don't have enough mDAI to sell");
        uint256 etherAmount = amount / 1000; // Conversion rate: 1000 mDAI = 1 Ether.
        _burn(msg.sender, amount);
        payable(msg.sender).transfer(etherAmount);
    }

    /// @notice Allows the contract owner to mint new mock Dai tokens to a specified address.
    /// @param to The address to receive the newly minted tokens.
    /// @param amount The amount of tokens to mint.
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    /// @notice Allows the contract owner to burn mock Dai tokens from a specified address.
    /// @param from The address from which the tokens will be burned.
    /// @param amount The amount of tokens to burn.
    function burn(address from, uint256 amount) public onlyOwner {
        _burn(from, amount);
    }

    /// @dev Allows the contract to receive Ether directly without calling a function.
    receive() external payable {}
}
