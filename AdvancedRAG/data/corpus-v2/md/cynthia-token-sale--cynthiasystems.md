# cynthia-token-sale--cynthiasystems

- domain: fungible-tokens (token-sale)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/cynthiasystems/CynthiaToken @ 0f5e7572cea7599da027b909999d78c0c96a9dd7
- license: MIT
- targets: CynthiaTokenSale.sol, CynthiaToken.sol
- validation: 22 passing tests, 0 failing; statement coverage CynthiaTokenSale.sol 100.0 %, CynthiaToken.sol 100.0 %

## Contract: AttackContract.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./CynthiaTokenSale.sol";

/**
 * @title AttackContract
 * @dev This contract demonstrates a potential reentrancy attack on the CynthiaTokenSale contract.
 * It's designed for educational purposes to showcase vulnerabilities in smart contracts.
 * WARNING: This contract is for testing and demonstration only. Do not use in production.
 */
contract AttackContract {
    /// @notice The target CynthiaTokenSale contract instance
    CynthiaTokenSale public tokenSale;

    /**
     * @dev Constructor that sets the target CynthiaTokenSale contract address
     * @param _tokenSale The address of the CynthiaTokenSale contract to attack
     */
    constructor(address _tokenSale) {
        tokenSale = CynthiaTokenSale(_tokenSale);
    }

    /**
     * @dev Initiates the attack by calling the buyTokens function of the target contract
     * @notice This function should be called with 1 ether to start the attack
     */
    function attack() external payable {
        tokenSale.buyTokens{value: 1 ether}();
    }

    /**
     * @dev Fallback function to handle incoming ether
     * @notice This function is called when ether is sent to the contract
     * It attempts to recursively call buyTokens if the target contract still has balance
     */
    receive() external payable {
        if (address(tokenSale).balance >= 1 ether) {
            tokenSale.buyTokens{value: 1 ether}();
        }
    }
}
```

## Contract: CynthiaToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CynthiaToken
 * @dev Implementation of the Cynthia token ($CYNTHIA) with a fixed supply model.
 *
 * This contract creates an ERC20 token with a predetermined, immutable supply.
 * Once deployed, the total number of tokens remains constant, promoting
 * scarcity and potentially long-term value appreciation.
 *
 * Tokenomics:
 * - Fixed Total Supply: 100 million $CYNTHIA tokens
 * - No Minting: After initial minting, no new tokens can be created
 * - No Burning: The contract does not implement token burning, maintaining the fixed supply
 *
 * Benefits of this simplified, fixed-supply approach:
 * 1. Predictability: Users and investors can rely on a constant token supply.
 * 2. Scarcity: A capped supply can drive value through limited availability.
 * 3. Simplicity: Easy to understand tokenomics with no complex inflation or deflation mechanisms.
 * 4. Security: Reduced attack surface due to minimal functionality.
 * 5. Gas Efficiency: Simple operations lead to lower gas costs for transfers.
 * 6. Transparency: The monetary policy is clear and immutable.
 * 7. Fairness: All tokens are minted at deployment, ensuring a fair initial distribution.
 *
 * Use Cases:
 * This token is designed for straightforward value transfer and storage within the
 * Cynthia Systems ecosystem, particularly suited for stable, long-term token economics.
 */

/// @custom:security-contact cynthia@cynthiasystems.com
contract CynthiaToken is ERC20, Ownable {
    /**
     * @dev Sets the total supply of tokens.
     * The value is set to 100 million tokens, with 18 decimal places for division.
     * This ensures a large enough supply for wide distribution and precise transactions.
     */
    uint256 public constant TOTAL_SUPPLY = 100_000_000 * 10**18; // 100 million tokens with 18 decimals

    /**
     * @dev Creates `TOTAL_SUPPLY` tokens and assigns them to `initialOwner`.
     * This sets up the initial distribution of tokens.
     *
     * @param initialOwner The address that will receive the total initial supply.
     */
    constructor(address initialOwner)
        ERC20("CynthiaToken", "CYNTHIA")
        Ownable(initialOwner)
    {
        _mint(initialOwner, TOTAL_SUPPLY);
    }

    // Note: The absence of additional functions like mint() or burn() 
    // reinforces the fixed supply nature of this token.
}
```

## Contract: CynthiaTokenSale.sol (primary target)

```solidity
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
```

## Tests: CynthiaTokenSale.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CynthiaTokenSale", function () {
  let CynthiaToken, cynthiaToken, CynthiaTokenSale, cynthiaTokenSale, AttackContract;
  let owner, addr1, addr2, addrs;

  beforeEach(async function () {
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

    CynthiaToken = await ethers.getContractFactory("CynthiaToken");
    cynthiaToken = await CynthiaToken.deploy(owner.address);

    CynthiaTokenSale = await ethers.getContractFactory("CynthiaTokenSale");
    cynthiaTokenSale = await CynthiaTokenSale.deploy(await cynthiaToken.getAddress());

    await cynthiaToken.transfer(await cynthiaTokenSale.getAddress(), ethers.parseEther("500000"));

    AttackContract = await ethers.getContractFactory("AttackContract");
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await cynthiaTokenSale.owner()).to.equal(owner.address);
    });

    it("Should set the correct token address", async function () {
      const tokenAddress = await cynthiaToken.getAddress();
      expect(await cynthiaTokenSale.cynthiaToken()).to.equal(tokenAddress);
    });

    it("Should have the correct token balance", async function () {
      expect(await cynthiaTokenSale.getContractTokenBalance()).to.equal(ethers.parseEther("500000"));
    });
  });

  describe("buyTokens", function () {
    it("Should allow purchase of tokens", async function () {
      const purchaseAmount = ethers.parseEther("1"); // 1 ETH
      const expectedTokens = ethers.parseEther("1"); // 1 CYNTHIA token
  
      await expect(() => cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount }))
        .to.changeEtherBalances([addr1, cynthiaTokenSale], [-purchaseAmount, purchaseAmount]);
  
      expect(await cynthiaToken.balanceOf(addr1.address)).to.equal(expectedTokens);
    });
  
    it("Should allow fractional token purchases", async function () {
      const purchaseAmount = ethers.parseEther("0.5"); // 0.5 ETH
      const expectedTokens = ethers.parseEther("0.5"); // 0.5 CYNTHIA token
  
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount });
      expect(await cynthiaToken.balanceOf(addr1.address)).to.equal(expectedTokens);
    });
  
    it("Should emit TokensPurchased event", async function () {
      const purchaseAmount = ethers.parseEther("1");
      const expectedTokens = ethers.parseEther("1");
  
      await expect(cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount }))
        .to.emit(cynthiaTokenSale, "TokensPurchased")
        .withArgs(addr1.address, expectedTokens);
    });
  
    it("Should revert if payment is insufficient", async function () {
      const purchaseAmount = ethers.parseEther("0"); // 0 ETH
  
      await expect(cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount }))
        .to.be.revertedWith("Insufficient payment");
    });
  
    it("Should revert if contract doesn't have enough tokens", async function () {
      // Deploy a new sale contract with a very small balance
      const smallBalance = ethers.parseEther("0.1"); // 0.1 CYNTHIA
      const newSaleContract = await CynthiaTokenSale.deploy(await cynthiaToken.getAddress());
      await cynthiaToken.transfer(await newSaleContract.getAddress(), smallBalance);
    
      const purchaseAmount = ethers.parseEther("1"); // Try to buy 1 CYNTHIA
    
      await expect(newSaleContract.connect(addr1).buyTokens({ value: purchaseAmount }))
        .to.be.revertedWith("Not enough tokens in contract");
    });
    
    it("Should handle multiple purchases correctly", async function () {
      const purchaseAmount = ethers.parseEther("0.5");
      const expectedTokens = ethers.parseEther("1"); // 0.5 + 0.5 = 1 CYNTHIA
    
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount });
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount });
    
      const balance = await cynthiaToken.balanceOf(addr1.address);
      expect(balance).to.equal(expectedTokens);
    });
  });

  describe("withdrawEther", function () {
    it("Should allow the owner to withdraw all ETH", async function () {
      // First, let's buy some tokens to ensure there's ETH in the contract
      const purchaseAmount = ethers.parseEther("1");
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount });
  
      const initialOwnerBalance = await ethers.provider.getBalance(owner.address);
      const contractBalance = await ethers.provider.getBalance(await cynthiaTokenSale.getAddress());
  
      const tx = await cynthiaTokenSale.connect(owner).withdrawEther();
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
  
      const finalOwnerBalance = await ethers.provider.getBalance(owner.address);
      const finalContractBalance = await ethers.provider.getBalance(await cynthiaTokenSale.getAddress());
  
      expect(finalOwnerBalance).to.equal(initialOwnerBalance + contractBalance - gasCost);
      expect(finalContractBalance).to.equal(0);
    });
  
    it("Should emit EtherWithdrawn event", async function () {
      const purchaseAmount = ethers.parseEther("1");
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount });
  
      await expect(cynthiaTokenSale.connect(owner).withdrawEther())
        .to.emit(cynthiaTokenSale, "EtherWithdrawn")
        .withArgs(owner.address, purchaseAmount);
    });
  
    it("Should revert if called by non-owner", async function () {
      await expect(cynthiaTokenSale.connect(addr1).withdrawEther())
        .to.be.revertedWithCustomError(cynthiaTokenSale, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });
  
    it("Should not revert if contract balance is zero", async function () {
      // Ensure contract has zero balance
      const contractBalance = await ethers.provider.getBalance(await cynthiaTokenSale.getAddress());
      if (contractBalance > 0) {
        await cynthiaTokenSale.connect(owner).withdrawEther();
      }
  
      // Attempt to withdraw again
      await expect(cynthiaTokenSale.connect(owner).withdrawEther()).to.not.be.reverted;
    });
  
    it("Should update contract balance to zero after withdrawal", async function () {
      const purchaseAmount = ethers.parseEther("1");
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount });
  
      await cynthiaTokenSale.connect(owner).withdrawEther();
  
      const finalContractBalance = await ethers.provider.getBalance(await cynthiaTokenSale.getAddress());
      expect(finalContractBalance).to.equal(0);
    });
  });

  describe("getContractTokenBalance", function () {
    it("Should return the correct initial balance", async function () {
      const expectedBalance = ethers.parseEther("500000");
      const balance = await cynthiaTokenSale.getContractTokenBalance();
      expect(balance).to.equal(expectedBalance);
    });
  
    it("Should update after token purchase", async function () {
      const initialBalance = await cynthiaTokenSale.getContractTokenBalance();
      const purchaseAmount = ethers.parseEther("1");
      
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount });
      
      const finalBalance = await cynthiaTokenSale.getContractTokenBalance();
      expect(finalBalance).to.equal(initialBalance - purchaseAmount);
    });
  
    it("Should be callable by non-owner", async function () {
      await expect(cynthiaTokenSale.connect(addr1).getContractTokenBalance()).to.not.be.reverted;
    });
  
    it("Should return correct balance after multiple transactions", async function () {
      const initialBalance = await cynthiaTokenSale.getContractTokenBalance();
      const purchaseAmount1 = ethers.parseEther("1");
      const purchaseAmount2 = ethers.parseEther("2");
  
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount1 });
      await cynthiaTokenSale.connect(addr2).buyTokens({ value: purchaseAmount2 });
  
      const finalBalance = await cynthiaTokenSale.getContractTokenBalance();
      expect(finalBalance).to.equal(initialBalance - purchaseAmount1 - purchaseAmount2);
    });
  
    it("Should not be affected by contract's ETH balance", async function () {
      const initialTokenBalance = await cynthiaTokenSale.getContractTokenBalance();
      const purchaseAmount = ethers.parseEther("1");
  
      // Buy tokens to increase the contract's ETH balance
      await cynthiaTokenSale.connect(addr1).buyTokens({ value: purchaseAmount });
  
      const finalTokenBalance = await cynthiaTokenSale.getContractTokenBalance();
      expect(finalTokenBalance).to.equal(initialTokenBalance - purchaseAmount);
    });
  });

  describe("Reentrancy Protection", function () {
    let attackContract;
  
    beforeEach(async function () {
      // Deploy the attack contract
      const AttackContract = await ethers.getContractFactory("AttackContract");
      attackContract = await AttackContract.deploy(await cynthiaTokenSale.getAddress());
    });
  
    it("Should prevent reentrancy attacks", async function () {
      const initialAttackerBalance = await cynthiaToken.balanceOf(await attackContract.getAddress());
      const initialContractBalance = await cynthiaTokenSale.getContractTokenBalance();
      const attackValue = ethers.parseEther("1");
  
      await attackContract.attack({ value: attackValue });
  
      const finalAttackerBalance = await cynthiaToken.balanceOf(await attackContract.getAddress());
      const finalContractBalance = await cynthiaTokenSale.getContractTokenBalance();
  
      // The attacker should receive tokens for one transaction only
      expect(finalAttackerBalance).to.equal(initialAttackerBalance + attackValue);
  
      // The contract balance should only decrease by the amount of one transaction
      expect(finalContractBalance).to.equal(initialContractBalance - attackValue);
    });
  
    it("Should emit TokensPurchased event only once per attack attempt", async function () {
      const attackValue = ethers.parseEther("1");
  
      await expect(attackContract.attack({ value: attackValue }))
        .to.emit(cynthiaTokenSale, "TokensPurchased")
        .withArgs(await attackContract.getAddress(), attackValue);
  
      // Check that the event is emitted only once
      const receipt = await ethers.provider.getTransactionReceipt((await attackContract.attack({ value: attackValue })).hash);
      const events = await cynthiaTokenSale.queryFilter(cynthiaTokenSale.filters.TokensPurchased(), receipt.blockNumber, receipt.blockNumber);
      expect(events.length).to.equal(1);
    });
  
    it("Should not deplete more tokens than expected in an attack", async function () {
      const initialSaleBalance = await cynthiaTokenSale.getContractTokenBalance();
      const attackValue = ethers.parseEther("5"); // Trying to buy 5 tokens
      const expectedPurchase = ethers.parseEther("1"); // But should only get 1 token per transaction
    
      await attackContract.attack({ value: attackValue });
    
      const finalSaleBalance = await cynthiaTokenSale.getContractTokenBalance();
      expect(initialSaleBalance - finalSaleBalance).to.equal(expectedPurchase);
    
      // Verify the attacker's token balance
      const attackerBalance = await cynthiaToken.balanceOf(await attackContract.getAddress());
      expect(attackerBalance).to.equal(expectedPurchase);
    });
  });
});
```
