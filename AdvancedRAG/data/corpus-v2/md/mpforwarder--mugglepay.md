# mpforwarder--mugglepay

- domain: escrow-conditional-payments (payment-forwarder)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/MugglePay/mugglepayment-contract @ 1a5a864bda8acfdeaf2f0c3dda3055eed0bd2c6a
- license: MIT
- targets: MPForwarder.sol, DestinationMock.sol, ERC20Mock.sol
- validation: 8 passing tests, 0 failing; statement coverage MPForwarder.sol 100.0 %, DestinationMock.sol 100.0 %, ERC20Mock.sol 100.0 %

## Contract: DestinationMock.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract DestinationMock {
    // Receive function to simulate a failed ETH transfer
    receive() external payable {
        revert();
    }
}
```

## Contract: ERC20Mock.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock is ERC20 {
    constructor(
        string memory name,
        string memory symbol,
        address initialAccount,
        uint256 initialBalance
    ) ERC20(name, symbol) {
        _mint(initialAccount, initialBalance);
    }
}
```

## Contract: MPForwarder.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MPForwarder {
  using SafeERC20 for IERC20;

  address public destination;

  event ETHFlushed(address indexed to, uint256 amount);
  event ERC20Flushed(address indexed token, address indexed to, uint256 amount);

  constructor(address _destination) {
    require(_destination != address(0), "Invalid destination address");
    destination = _destination;
  }

  receive() external payable {
    // Accept ETH deposits
  }

  fallback() external {
    // Fallback function to handle unexpected calls
  }

  function flushETH() external {
    uint256 balance = address(this).balance;
    require(balance > 0, "No ETH to flush");
    (bool success, ) = destination.call{ value: balance }("");
    require(success, "ETH transfer failed");
    emit ETHFlushed(destination, balance);
  }

  function flushERC20(address tokenContractAddress) external {
    require(tokenContractAddress != address(0), "Invalid token address");
    IERC20 tokenContract = IERC20(tokenContractAddress);
    uint256 forwarderBalance = tokenContract.balanceOf(address(this));
    require(forwarderBalance > 0, "No ERC20 tokens to flush");
    tokenContract.safeTransfer(destination, forwarderBalance);
    emit ERC20Flushed(tokenContractAddress, destination, forwarderBalance);
  }
}
```

## Tests: MPFowarder.js

```javascript
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const hre = require("hardhat");

describe("MPForwarder", function () {
  async function deployMPForwarderFixture() {
    const [owner, otherAccount] = await hre.ethers.getSigners();
    const destination = otherAccount.address;

    const MPForwarder = await hre.ethers.getContractFactory("MPForwarder");
    const mpForwarder = await MPForwarder.deploy(destination);

    return { mpForwarder, destination, owner };
  }

  async function deployNoDestinationMPForwarderFixture() {
    const [owner] = await hre.ethers.getSigners();
    const destination = hre.ethers.ZeroAddress;

    const MPForwarder = await hre.ethers.getContractFactory("MPForwarder");
    const mpForwarder = await MPForwarder.deploy(destination);

    return { mpForwarder, destination, owner };
  }

  async function deployRevertingDestinationForwarderFixture() {
    const [owner] = await hre.ethers.getSigners();

    const DestinationMock = await hre.ethers.getContractFactory(
      "DestinationMock"
    );
    const destinationMock = await DestinationMock.deploy();
    const destinationMockAddress = await destinationMock.getAddress();

    const MPForwarder = await hre.ethers.getContractFactory("MPForwarder");
    const mpForwarder = await MPForwarder.deploy(destinationMockAddress);

    return { mpForwarder, destination: destinationMockAddress, owner };
  }

  describe("deploy", function () {
    it("should set the right destination", async function () {
      const { mpForwarder, destination } = await loadFixture(
        deployMPForwarderFixture
      );

      expect(await mpForwarder.destination()).to.equal(destination);
    });

    it("should revert if the destination is the zero address", async function () {
      await expect(deployNoDestinationMPForwarderFixture()).to.be.revertedWith(
        "Invalid destination address"
      );
    });
  });

  describe("flushETH", function () {
    it("should flush ETH to the destination and emit ETHFlushed event", async function () {
      const { mpForwarder, destination, owner } = await loadFixture(
        deployMPForwarderFixture
      );

      const mpForwarderAddress = await mpForwarder.getAddress();

      // Send some ETH to the contract
      await owner.sendTransaction({
        to: mpForwarderAddress,
        value: hre.ethers.parseEther("1"),
      });

      // Check initial balances
      const initialContractBalance = await hre.ethers.provider.getBalance(
        mpForwarderAddress
      );
      const initialDestinationBalance = await hre.ethers.provider.getBalance(
        destination
      );

      // Flush ETH
      await expect(mpForwarder.flushETH())
        .to.emit(mpForwarder, "ETHFlushed")
        .withArgs(destination, initialContractBalance);

      // Check final balances
      const finalContractBalance = await hre.ethers.provider.getBalance(
        mpForwarderAddress
      );
      const finalDestinationBalance = await hre.ethers.provider.getBalance(
        destination
      );

      expect(finalContractBalance).to.equal(0);
      expect(finalDestinationBalance).to.equal(
        initialDestinationBalance + initialContractBalance
      );
    });

    it("should revert if there's no ETH to flush", async function () {
      const { mpForwarder } = await loadFixture(deployMPForwarderFixture);

      const mpForwarderAddress = await mpForwarder.getAddress();

      const initialContractBalance = await hre.ethers.provider.getBalance(
        mpForwarderAddress
      );

      expect(initialContractBalance).to.equal(0);

      await expect(mpForwarder.flushETH()).to.be.revertedWith(
        "No ETH to flush"
      );
    });

    it("should revert if ETH transfer fails", async function () {
      const { mpForwarder, owner } = await loadFixture(
        deployRevertingDestinationForwarderFixture
      );

      const mpForwarderAddress = await mpForwarder.getAddress();

      // Send some ETH to the contract
      await owner.sendTransaction({
        to: mpForwarderAddress,
        value: hre.ethers.parseEther("1"),
      });

      // Flush ETH
      await expect(mpForwarder.flushETH()).to.be.revertedWith(
        "ETH transfer failed"
      );
    });
  });

  describe("flushERC20", function () {
    it("should flush ERC20 tokens to the destination and emit ERC20Flushed event", async function () {
      const { mpForwarder, destination, owner } = await loadFixture(
        deployMPForwarderFixture
      );

      const mpForwarderAddress = await mpForwarder.getAddress();

      // Deploy an ERC20 token
      const ERC20Mock = await hre.ethers.getContractFactory("ERC20Mock");
      const erc20Mock = await ERC20Mock.deploy(
        "Tether USD",
        "USDT",
        owner.address,
        hre.ethers.parseEther("1000")
      );
      const erc20MockAddress = await erc20Mock.getAddress();

      // Transfer some tokens to the MPForwarder contract
      await erc20Mock.transfer(
        mpForwarderAddress,
        hre.ethers.parseEther("100")
      );

      // Check initial balances
      const initialContractBalance = await erc20Mock.balanceOf(
        mpForwarderAddress
      );
      const initialDestinationBalance = await erc20Mock.balanceOf(destination);

      // Flush ERC20 tokens
      await expect(mpForwarder.flushERC20(erc20MockAddress))
        .to.emit(mpForwarder, "ERC20Flushed")
        .withArgs(erc20MockAddress, destination, initialContractBalance);

      // Check final balances
      const finalContractBalance = await erc20Mock.balanceOf(
        mpForwarderAddress
      );
      const finalDestinationBalance = await erc20Mock.balanceOf(destination);

      expect(finalContractBalance).to.equal(0);
      expect(finalDestinationBalance).to.equal(
        initialDestinationBalance + initialContractBalance
      );
    });

    it("should revert if the token address is the zero address", async function () {
      const { mpForwarder } = await loadFixture(deployMPForwarderFixture);

      await expect(
        mpForwarder.flushERC20(hre.ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid token address");
    });

    it("should revert if there are no tokens to flush", async function () {
      const { mpForwarder, owner } = await loadFixture(
        deployMPForwarderFixture
      );

      // Deploy an ERC20 token
      const ERC20Mock = await hre.ethers.getContractFactory("ERC20Mock");
      const erc20Mock = await ERC20Mock.deploy(
        "Tether USD",
        "USDT",
        owner.address,
        hre.ethers.parseEther("1000")
      );
      const erc20MockAddress = await erc20Mock.getAddress();

      await expect(mpForwarder.flushERC20(erc20MockAddress)).to.be.revertedWith(
        "No ERC20 tokens to flush"
      );
    });
  });
});
```
