# head-soccer--borissv4646

- domain: games-lotteries (on-chain-game)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/BorisSV4646/footballGame @ c64758fe84206da2e705d1229d160a555fe76e6a
- license: Apache-2.0
- targets: HeadSoccer.sol, TestToken.sol
- validation: 8 passing tests, 0 failing; statement coverage HeadSoccer.sol 100.0 %, TestToken.sol 50.0 %

## Contract: HeadSoccer.sol (primary target)

```solidity
// SPDX-License-Identifier: Apache-2.0 license
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract HeadSoccerRubies is ERC20, AccessControl {
    /**
     * @dev The role of the wallet, which can trigger the start and finish functions of the game.
     */
    bytes32 public constant FRONTEND_WALLET = keccak256("FRONTEND_WALLET");

    /**
     * @dev The amount of the commission for the game - default 20%.
     */
    uint256 public commissions = 20;

    /**
     * @dev The number of rubies per token.
     */
    uint256 public conversion = 10;

    /**
     * @dev Addresses of tokens for which rubies can be exchanged.
     */
    address public immutable USDT;

    /**
     * @dev The address of the contract owner.
     */
    address internal immutable owner;

    /**
     * @dev Invalid token to exchange.
     */
    error NotValidToken(address token);

    /**
     * @dev There are not enough ERC20 tokens to exchange.
     */
    error NotEnoughERC20(uint256 balanceOf, uint256 amount);

    /**
     * @dev There are not enough rubies tokens to exchange.
     */
    error NotEnoughRubies(uint256 balanceOf, uint256 amount);

    /**
     * @dev The commission is too small or too large.
     */
    error NotRightCommission(uint256 newCommission);

    /**
     * @dev Check zero address usdt.
     */
    error ZeroAddress(address zeroAddress);

    /**
     * @dev An error occurs when the function does not call the frontend wallet.
     */
    error CallerNotFrontWallet(address caller);

    event ChangeERC20toRubies(uint256 amount, address token);
    event ChangeRubiesToERC20(uint256 amount, address token);
    event ChangeRubies(uint256 amount);
    event StartGameEvent(uint256 amount, address player1, address player2);
    event FinishGameEvent(address winner, uint256 rewars);

    /**
     * @dev The modifier checks whether the balance of rubies is sufficient for the operation.
     */
    modifier hasEnoughBalance(uint256 amount) {
        if (balanceOf(msg.sender) < amount) {
            revert NotEnoughRubies(balanceOf(msg.sender), amount);
        }
        _;
    }

    /**
     * @dev Initializes the contract setting the address provided by the deployer as the initial owner.
     * @param _frontWallet Wallet to start the game function and finish the game.
     */
    constructor(
        address _frontWallet,
        address _usdt
    ) ERC20("HeadSoccerRubies", "HSR") {
        owner = msg.sender;
        if (_usdt == address(0)) {
            revert ZeroAddress(_usdt);
        }
        USDT = _usdt;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(FRONTEND_WALLET, _frontWallet);
    }

    /**
     * @notice Before the exchange, it is necessary to give the specified contract permission to dispose of the token.
     * @dev The function of exchanging ERC20 tokens for rubies.
     * @param amount The number of tokens.
     */
    function changeERC20toRubie(uint256 amount) external {
        IERC20 token = IERC20(USDT);
        uint256 userBalance = token.balanceOf(msg.sender);
        uint256 normalizedAmount = amount / 1e12;
        if (userBalance < normalizedAmount) {
            revert NotEnoughERC20(userBalance, normalizedAmount);
        }
        require(
            token.transferFrom(msg.sender, address(this), normalizedAmount)
        );
        _mint(msg.sender, amount * conversion);
        emit ChangeERC20toRubies(amount, USDT);
    }

    /**
     * @dev The function of exchanging rubies for ERC20 tokens.
     * @param amount The number of tokens.
     */
    function changeRubieToERC20(
        uint256 amount
    ) external hasEnoughBalance(amount) {
        uint256 normalizedAmount = amount / 1e12;
        _burn(msg.sender, amount);
        require(
            IERC20(USDT).transfer(msg.sender, normalizedAmount / conversion)
        );
        emit ChangeRubiesToERC20(amount, USDT);
    }

    /**
     * @dev The function of sending the commission and the price of the items to the owner.
     * @param amount The number of tokens.
     */
    function sendMoneyToOwner(uint256 amount) internal {
        uint256 normalizedAmount = amount / 1e12;
        require(IERC20(USDT).transfer(owner, normalizedAmount / conversion));
    }

    /**
     * @dev The function of exchanging rubies for any other items.
     * @param amount The number of tokens.
     */
    function changeRubieToThings(
        uint256 amount
    ) public hasEnoughBalance(amount) {
        _burn(msg.sender, amount);
        sendMoneyToOwner(amount);
        emit ChangeRubies(amount);
    }

    /**
     * @dev The function should be called by the frontend (game) after two players enter the waiting room and press the play button.
     * @param amount The number of tokens.
     * @param player1 The address of the first player.
     * @param player2 The address of the second player.
     */
    function startGame(
        address player1,
        address player2,
        uint256 amount
    ) external onlyRole(FRONTEND_WALLET) {
        if (player1 == address(0)) {
            revert ZeroAddress(player1);
        }
        if (player2 == address(0)) {
            revert ZeroAddress(player2);
        }
        if (balanceOf(player1) < amount) {
            revert NotEnoughRubies(balanceOf(player1), amount);
        }
        if (balanceOf(player2) < amount) {
            revert NotEnoughRubies(balanceOf(player2), amount);
        }

        uint256 commissionForGame = (amount * commissions) / 100;

        _burn(player1, amount);
        _burn(player2, amount);

        sendMoneyToOwner(commissionForGame * 2);

        emit StartGameEvent(amount, player1, player2);
    }

    /**
     * @dev The function should be called by the frontend (game) after the end of the game and sends the rewards for the game.
     * @param winner The winner of the game.
     * @param rewars Awards to the winner.
     */
    function finishGame(
        address winner,
        uint256 rewars
    ) external onlyRole(FRONTEND_WALLET) {
        if (winner == address(0)) {
            revert ZeroAddress(winner);
        }
        _mint(winner, rewars);
        emit FinishGameEvent(winner, rewars);
    }

    /**
     * @dev A function for the owner to change the commission.
     * @param newCommission The amount of the new commission..
     */
    function changeCommission(
        uint256 newCommission
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newCommission <= 0 || newCommission >= 100) {
            revert NotRightCommission(newCommission);
        }
        commissions = newCommission;
    }

    /**
     * @dev The function changes the ratios for exchanging rubies for tokens.
     * @param newConversion The amount of the new commission.
     */
    function changeConversion(
        uint256 newConversion
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newConversion <= 0) {
            revert NotRightCommission(newConversion);
        }
        conversion = newConversion;
    }
}
```

## Contract: TestToken.sol (dependency)

```solidity
// SPDX-License-Identifier: Apache-2.0 license
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract TestToken is ERC20, Ownable {
    constructor(
        uint256 _initialSupply,
        address _owner
    ) ERC20("TestToken", "TT") Ownable(_owner) {
        _mint(msg.sender, _initialSupply);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
```

## Tests: HeadSoccerTest.js

```javascript
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HeadSoccerRubies Deploy", function () {
  async function deployFixture() {
    const [owner, otherAccount1, otherAccount2] = await ethers.getSigners();

    const TestToken = await ethers.getContractFactory("TestToken");
    const tokenTest = await TestToken.deploy(ethers.parseEther("100"), owner);

    const HeadSoccerRubies = await ethers.getContractFactory(
      "HeadSoccerRubies"
    );
    const RubiesToken = await HeadSoccerRubies.deploy(
      otherAccount1,
      await tokenTest.getAddress()
    );
    const user1 = await RubiesToken.connect(otherAccount1);
    const user2 = await RubiesToken.connect(otherAccount2);

    return {
      owner,
      RubiesToken,
      otherAccount1,
      otherAccount2,
      user1,
      user2,
      tokenTest,
    };
  }

  describe("Deployment", function () {
    it("Should set the right owner and role", async function () {
      const { owner, RubiesToken, tokenTest, otherAccount1 } =
        await loadFixture(deployFixture);
      expect(await tokenTest.balanceOf(owner.address)).to.equal(
        ethers.parseEther("100")
      );
      const defaultRole =
        "0x0000000000000000000000000000000000000000000000000000000000000000";
      const frontRole = await RubiesToken.FRONTEND_WALLET();
      expect(await RubiesToken.hasRole(defaultRole, owner.address)).to.be.true;
      expect(await RubiesToken.hasRole(frontRole, otherAccount1.address)).to.be
        .true;
    });
  });

  describe("ChangeCommission", function () {
    it("Function changeCommission work right", async function () {
      const { RubiesToken } = await loadFixture(deployFixture);
      await RubiesToken.changeCommission(33);
      expect(await RubiesToken.commissions()).to.equal(33);
    });

    it("Function changeCommission to be revert", async function () {
      const { otherAccount1, RubiesToken } = await loadFixture(deployFixture);
      await expect(RubiesToken.changeCommission(101)).to.be.reverted;
      const user1 = await RubiesToken.connect(otherAccount1);
      await expect(user1.changeCommission(10)).to.be.reverted;
    });
  });

  describe("ChangeERC20toRubie and changeRubieToERC20", function () {
    it("Functions change work right", async function () {
      const { RubiesToken, tokenTest, owner } = await loadFixture(
        deployFixture
      );
      const tokenTestAddress = await tokenTest.getAddress();
      const tokenRubiesAddress = await RubiesToken.getAddress();

      await tokenTest.approve(tokenRubiesAddress, ethers.parseEther("10"));
      const changeTokens = await RubiesToken.changeERC20toRubie(
        ethers.parseEther("10")
      );

      await expect(changeTokens).to.changeTokenBalances(
        RubiesToken,
        [owner.address, tokenRubiesAddress],
        [ethers.parseEther("100"), 0]
      );
      await expect(changeTokens).to.changeTokenBalances(
        tokenTest,
        [owner.address, tokenRubiesAddress],
        [-10000000, 10000000]
      );

      await expect(changeTokens)
        .to.emit(RubiesToken, "ChangeERC20toRubies")
        .withArgs(ethers.parseEther("10"), tokenTestAddress);

      await expect(RubiesToken.changeRubieToERC20(ethers.parseEther("101"))).to
        .be.reverted;

      const changeTokensToRubie = await RubiesToken.changeRubieToERC20(
        ethers.parseEther("10")
      );

      await expect(changeTokensToRubie).to.changeTokenBalances(
        RubiesToken,
        [owner.address, tokenRubiesAddress],
        [-ethers.parseEther("10"), 0]
      );
      await expect(changeTokensToRubie).to.changeTokenBalances(
        tokenTest,
        [owner.address, tokenRubiesAddress],
        [1000000n, -1000000n]
      );

      await expect(changeTokensToRubie)
        .to.emit(RubiesToken, "ChangeRubiesToERC20")
        .withArgs(ethers.parseEther("10"), tokenTestAddress);
    });
  });

  describe("changeRubieToThings", function () {
    it("Function changeRubieToThings work right", async function () {
      const { owner, RubiesToken, tokenTest } = await loadFixture(
        deployFixture
      );

      await tokenTest.getAddress();
      const tokenRubiesAddress = await RubiesToken.getAddress();
      await tokenTest.approve(tokenRubiesAddress, ethers.parseEther("10"));
      await RubiesToken.changeERC20toRubie(ethers.parseEther("10"));

      await expect(RubiesToken.changeRubieToThings(ethers.parseEther("101"))).to
        .be.reverted;
      const changeRubies = await RubiesToken.changeRubieToThings(
        ethers.parseEther("50")
      );

      await expect(changeRubies).to.changeTokenBalances(
        RubiesToken,
        [tokenRubiesAddress, owner.address],
        [ethers.parseEther("0"), -ethers.parseEther("50")]
      );
      await expect(changeRubies).to.changeTokenBalances(
        tokenTest,
        [tokenRubiesAddress, owner.address],
        [-5000000n, 5000000n]
      );

      await expect(changeRubies)
        .to.emit(RubiesToken, "ChangeRubies")
        .withArgs(ethers.parseEther("50"));
    });
  });

  describe("startGame", function () {
    it("Function startGame work right", async function () {
      const { otherAccount2, tokenTest, owner, user1, user2, RubiesToken } =
        await loadFixture(deployFixture);

      await tokenTest.getAddress();
      const tokenRubiesAddress = await RubiesToken.getAddress();
      await tokenTest.approve(tokenRubiesAddress, ethers.parseEther("10"));
      await RubiesToken.changeERC20toRubie(ethers.parseEther("10"));
      await RubiesToken.transfer(
        otherAccount2.address,
        ethers.parseEther("20")
      );

      await expect(
        user2.startGame(
          owner.address,
          otherAccount2.address,
          ethers.parseEther("20")
        )
      ).to.be.reverted;

      const startGame = await user1.startGame(
        owner.address,
        otherAccount2.address,
        ethers.parseEther("20")
      );

      await expect(startGame).to.changeTokenBalances(
        RubiesToken,
        [otherAccount2.address, owner.address, tokenRubiesAddress],
        [-ethers.parseEther("20"), -ethers.parseEther("20"), 0]
      );
      await expect(startGame).to.changeTokenBalances(
        tokenTest,
        [otherAccount2.address, owner.address, tokenRubiesAddress],
        [0, 800000n, -800000n]
      );

      await expect(startGame)
        .to.emit(RubiesToken, "StartGameEvent")
        .withArgs(
          ethers.parseEther("20"),
          owner.address,
          otherAccount2.address
        );
    });
  });

  describe("finishGame", function () {
    it("Function finishGame work right", async function () {
      const { owner, RubiesToken, tokenTest, user2, user1 } = await loadFixture(
        deployFixture
      );
      const tokenRubiesAddress = await RubiesToken.getAddress();

      await expect(user2.finishGame(owner.address, ethers.parseEther("10"))).to
        .be.reverted;
      const finishGame = await user1.finishGame(
        owner.address,
        ethers.parseEther("50")
      );

      await expect(finishGame).to.changeTokenBalances(
        RubiesToken,
        [tokenRubiesAddress, owner.address],
        [ethers.parseEther("0"), ethers.parseEther("50")]
      );
      await expect(finishGame).to.changeTokenBalances(
        tokenTest,
        [tokenRubiesAddress, owner.address],
        [0, 0]
      );

      await expect(finishGame)
        .to.emit(RubiesToken, "FinishGameEvent")
        .withArgs(owner.address, ethers.parseEther("50"));
    });
  });

  describe("changeConversion", function () {
    it("Function changeConversion work right", async function () {
      const { owner, RubiesToken, tokenTest } = await loadFixture(
        deployFixture
      );
      const tokenRubiesAddress = await RubiesToken.getAddress();

      await RubiesToken.changeConversion(100);

      await expect(RubiesToken.changeConversion(0)).to.be.reverted;
      await tokenTest.approve(tokenRubiesAddress, ethers.parseEther("10"));
      const changeTokens = await RubiesToken.changeERC20toRubie(
        ethers.parseEther("10")
      );

      await expect(changeTokens).to.changeTokenBalances(
        RubiesToken,
        [tokenRubiesAddress, owner.address],
        [ethers.parseEther("0"), ethers.parseEther("1000")]
      );
      await expect(changeTokens).to.changeTokenBalances(
        tokenTest,
        [tokenRubiesAddress, owner.address],
        [10000000n, -10000000n]
      );
    });
  });
});
```
