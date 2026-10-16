// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PartialRefund is ERC20, ERC20Permit, Ownable, ReentrancyGuard {
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10 ** 18; //ERC20 contract by default uses 18 decimal places for token balances.

    //token amounts are usually in the smallest unit of the token. So, 1_000_000 * 10**18 represents 1,000,000 tokens with 18 decimal places or 1 million * 10^18 smallest unit of token.

    constructor()
        ERC20("DeeVee", "DV")
        ERC20Permit("DeeVee")
        Ownable(msg.sender)
    {}

    function mintTokensToAddress(
        address recipient,
        uint256 amount
    ) external onlyOwner {
        _mint(recipient, amount);
    }

    // Token Sale Function
    function buyTokens() external payable nonReentrant {
        uint256 amount = msg.value * 1000; // This calculates the amount in token smallest units
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds maximum supply");
        _mint(msg.sender, amount); // This mints the tokens in smallest units
    }

    // View function to see how much Ether can be withdrawn
    function withdrawableEther() public view returns (uint256) {
        uint256 requiredEtherForSellBack = (totalSupply() * 5) / 10000;
        if (address(this).balance > requiredEtherForSellBack) {
            return address(this).balance - requiredEtherForSellBack;
        } else {
            return 0;
        }
    }

    // Withdraw Ether from Contract
    function withdrawFunds(uint256 amount) external onlyOwner {
        uint256 maxWithdrawable = withdrawableEther();
        require(amount <= maxWithdrawable, "Amount exceeds withdrawable limit");
        payable(owner()).transfer(amount);
    }

    // Partial Refund Function
    function sellBack(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than zero");

        uint256 etherAmount = (amount * 0.5 ether) / 1000;
        require(
            address(this).balance >= etherAmount,
            "Contract does not have enough ether"
        );

        _burn(msg.sender, amount);
        payable(msg.sender).transfer(etherAmount);
    }

    // Function to receive Ether. msg.data must be empty
    receive() external payable {}
}
