# airdrop--ramirohr

- domain: airdrop-merkle (airdrop)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/RamiroHR/Airdrop_ERC20_tokens @ bfd3f1b38d57fc8d43fd82de40a6d386cf0ee485
- license: MIT
- targets: Airdrop.sol, Token.sol
- validation: 4 passing tests, 0 failing; statement coverage Airdrop.sol 88.89 %, Token.sol 100.0 %

## Contract: Airdrop.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

contract Airdrop is ReentrancyGuard, Ownable {
    // state variables decalarations
    IERC20 public immutable token; //of type Interface-ERC20 with methods: .transfer(), .balance(), .approuve(), etc
    mapping(address => uint256) public airdropAmounts; //to store address:airdrop_amount
    mapping(address => uint256) public claimedAmounts; //to track address:claimed_amounts

    // Events
    event AirdropSet(address user, uint256 amount);
    event TokensClaimed(address user, uint256 amount);

    // Constructor executes once at deploy
    constructor(address _token) Ownable(msg.sender) {
        require(_token != address(0), "Invalid token address");
        token = IERC20(_token); // cast address to interface (with methods)
    }

    // set airdrop amount for a user - owner only
    function setAirdropAmount(address user, uint256 amount) public onlyOwner {
        require(user != address(0), "Invalid user address");
        airdropAmounts[user] += amount;
        emit AirdropSet(user, amount);
    }

    // for user to claim theiir airdrop
    function claimAll() public nonReentrant {
        address user = msg.sender;
        uint256 availableAmount = airdropAmounts[user] - claimedAmounts[user];

        require(availableAmount > 0, "No tokens available to claim");

        // Update claimed amount, then transfer (reversible if transfer fails)
        claimedAmounts[user] += availableAmount;
        require(token.transfer(user, availableAmount), "Token transfer failed");

        emit TokensClaimed(user, availableAmount);
    }

    function hasAirdrop(address user) public view returns (bool) {
        return airdropAmounts[user] > 0;
    }
}
```

## Contract: Token.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';

contract DevToken is ERC20, Ownable {
  constructor() ERC20("DevToken","DEV") Ownable(msg.sender) {
    _mint(msg.sender, 1000000 * 10**decimals());
  }

  function mint(address to, uint256 amount) external onlyOwner {
    require(to != address(0), "Cannot mint to zero address");
    require(amount > 0, "Amount must be greater than zero");
    _mint(to, amount);
  }
}
```

## Tests: Airdrop.js

```javascript
/* eslint-disable node/no-unpublished-require */
const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('Airdrop', function () {
  let token, airdrop, owner, user1, user2;

  beforeEach(async function () {
    // get accounts
    [owner, user1, user2] = await ethers.getSigners();

    // deploy token contract
    const Token = await ethers.getContractFactory('DevToken');
    token = await Token.deploy();

    // deploy airdrop
    const Airdrop = await ethers.getContractFactory('Airdrop');
    airdrop = await Airdrop.deploy(await token.getAddress());

    // Mint some tokens to he airdrop contract
    await token.mint(await airdrop.getAddress(), ethers.parseEther('1000000'));
  });

  // TODO:
  // describe('Test deployment and Ownability') {
  //   it('Should set the right owner for Token') {}
  //   it('Should set the right owner for Airdrop') {}
  //   it('Should mint initial tokens (1M) to the owner - Token.sol contract') {}
  //   it('Should not assign tokens to another user during token.sol deployment') {}
  //   it('Should have minted some tokens to the airdrop address - custom amount for tests') {}
  //   it('Should fai to deploy airdrop with custom message if token address is address(0)')
  // }

  // describe('Owner functionalitites') {
  //   it('Should assign the expected airdrop amount to user') {}
  //   it('Should fail to assign airdrop to adress(0) with custom message') {}
  //   it('Should not allow non-owner to asing airdropt to anothe user' {} //Move here
  // }

  describe('Basic Functionality', function () {
    it('Should allow users to claim  their airdrop', async function () {
      // owner asign airdrop to user
      const airdropAmount = ethers.parseEther('100');
      await airdrop.connect(owner).setAirdropAmount(user1.address, airdropAmount);

      // user claim their token
      await airdrop.connect(user1).claimAll();

      // verify receives the tokens claimed
      expect(await token.balanceOf(user1.address)).to.equal(airdropAmount);

      // verify the token amount is tracked correctly
      expect(await airdrop.claimedAmounts(user1.address)).to.equal(airdropAmount);
    });

    it('Should prevent claiming when no airdrop is asigned', async function () {
      // logic without any previous token asignement by the owner
      await expect(airdrop.connect(user1).claimAll()).to.be.revertedWith('No tokens available to claim');
    });

    it('Should prevent claiming twice', async function () {
      // asing airdrop
      const airdropAmount = ethers.parseEther('50');
      await airdrop.connect(owner).setAirdropAmount(user1.address, airdropAmount);

      // user1 claim once
      await airdrop.connect(user1).claimAll();

      // verify second claim try fails
      await expect(airdrop.connect(user1).claimAll()).to.be.revertedWith('No tokens available to claim');
    });

    // it('Should prevent claiming more than what it was assigned') {}
    // it('Should test reentrancy') {} // ?? check how to do this ?
    // it('Should verify user with airdrop return true for hasAirdrop function') {}
    // it('Should verify user with NO airdrop return false for hasAirdrop function') {}

    it('Should not allow non-owner to asing airdropt to anothe user', async function () {
      // verify non-owner asignement fails
      await expect(
        airdrop.connect(user1).setAirdropAmount(user2.address, ethers.parseEther('200'))
      ).to.be.revertedWithCustomError(airdrop, 'OwnableUnauthorizedAccount');
    });
  });
});
```
