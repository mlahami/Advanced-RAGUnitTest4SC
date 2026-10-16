// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CynthiaTokenSale
 * @dev Implements a token sale mechanism for CynthiaToken ($CYNTHIA).
 * This contract allows users to buy $CYNTHIA tokens at a fixed rate of 1 $ETH per token.
 * Features:
 * - Supports fractional token purchases down to 18 decimal places.
 * - Implements reentrancy protection for security.
 * - Allows contract owner to withdraw accumulated ETH.
 * - Provides a function to check the contract's current $CYNTHIA token balance.
 * - Emits events for token purchases and ETH withdrawals.
 * - Uses OpenZeppelin's IERC20, Ownable, and ReentrancyGuard contracts for standard functionality and security.
 */
contract CynthiaTokenSale is Ownable, ReentrancyGuard {
    /// @notice The $CYNTHIA token contract
    IERC20 public cynthiaToken;
    uint256 public constant CYNTHIA_DECIMALS = 18;
    uint256 public constant CYNTHIA_TO_WEI = 10**CYNTHIA_DECIMALS;


    /// @notice Emitted when tokens are purchased
    /// @param buyer The address of the token buyer
    /// @param amount The number of tokens purchased
    event TokensPurchased(address buyer, uint256 amount);

    /// @notice Emitted when Ether is withdrawn from the contract
    /// @param to The address receiving the withdrawn Ether
    /// @param amount The amount of Ether withdrawn
    event EtherWithdrawn(address indexed to, uint256 amount);

    /**
     * @dev Initializes the CynthiaTokenSale contract.
     * @param _token The address of the $CYNTHIA token contract
     * @notice Sets the $CYNTHIA token contract address and initializes the contract owner.
     * @dev Inherits from Ownable, setting msg.sender as the initial owner.
     * @dev Performs a check to ensure the provided token address is not the zero address.
     * @dev This function is called only once when the contract is deployed.
     */
    constructor(IERC20 _token) Ownable(msg.sender) {
        require(address(_token) != address(0), "Token address cannot be zero");
        cynthiaToken = _token;
    }

    /**
     * @notice Allows users to buy $CYNTHIA tokens using $ETH
     * @dev Tokens are priced at 1 $ETH per token, with support for fractional purchases
     * @dev Uses nonReentrant modifier to prevent reentrancy attacks
     * @dev Calculates token amount based on sent $ETH, accounting for 18 decimal places
     * @dev Requires:
     *      - The calculated token amount is greater than 0
     *      - The contract has sufficient tokens to fulfill the purchase
     *      - The token transfer to the buyer is successful
     * @dev Emits a TokensPurchased event upon successful purchase
     * @dev If requirements are not met, the function will revert and ETH will be returned
     */
    function buyTokens() public payable nonReentrant {
        uint256 tokenAmount = (msg.value * CYNTHIA_TO_WEI) / 1 ether;
        require(tokenAmount > 0, "Insufficient payment");
        require(cynthiaToken.balanceOf(address(this)) >= tokenAmount, "Not enough tokens in contract");
        require(cynthiaToken.transfer(msg.sender, tokenAmount), "Transfer failed");
        emit TokensPurchased(msg.sender, tokenAmount);
    }

    /**
     * @notice Allows the owner to withdraw all accumulated ETH from the contract
     * @dev Only callable by the contract owner due to the onlyOwner modifier
     * @dev Transfers the entire ETH balance of the contract to the owner's address
     * @dev Emits an EtherWithdrawn event with the owner's address and the withdrawn amount
     * @dev If the transfer fails, the function will revert
     * @dev Be cautious when calling this function as it will withdraw all ETH at once
     * @dev Ensure that this doesn't interfere with any ongoing operations or expected contract behavior
     */
    function withdrawEther() public onlyOwner {
        uint256 amount = address(this).balance;
        payable(owner()).transfer(amount);
        emit EtherWithdrawn(owner(), amount);
    }

    /**
     * @notice Returns the current $CYNTHIA token balance of the contract
     * @dev Uses the ERC20 balanceOf function to query the contract's token balance
     * @dev This is a view function, meaning it doesn't modify the contract state
     * @dev Can be called by anyone, as it's a public function
     * @dev The returned balance includes all 18 decimal places of precision
     * @dev Useful for checking available tokens before purchases or for general monitoring
     * @return uint256 The number of $CYNTHIA tokens held by the contract, in its smallest unit (18 decimal places)
     */
    function getContractTokenBalance() public view returns (uint256) {
        return cynthiaToken.balanceOf(address(this));
    }
}
