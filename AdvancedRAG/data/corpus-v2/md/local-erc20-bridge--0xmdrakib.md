# local-erc20-bridge--0xmdrakib

- domain: relayer-meta-transactions (bridge)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/0xmdrakib/XphereSwap @ 9653e46d61e0bc9263690ec754bfbf4a06ff7f8c
- license: MIT
- targets: LocalERC20Bridge.sol, LocalNativeBridge.sol, MintableERC20.sol
- validation: 10 passing tests, 0 failing; statement coverage LocalERC20Bridge.sol 84.0 %, LocalNativeBridge.sol 63.33 %, MintableERC20.sol 91.67 %

## Contract: LocalERC20Bridge.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILocalBridgeToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
}

contract LocalERC20Bridge {
    enum Mode {
        LockRelease,
        BurnMint
    }

    address public immutable token;
    uint32 public immutable localDomain;
    uint32 public immutable remoteDomain;
    Mode public immutable mode;
    address public owner;
    bool public paused;
    uint256 public outboundNonce;
    uint256 public inboundNonce;
    mapping(bytes32 => bool) public processedMessages;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event TransferRemote(
        bytes32 indexed messageId,
        uint256 indexed nonce,
        uint32 indexed destinationDomain,
        address sender,
        bytes32 recipient,
        uint256 amount
    );
    event ReceivedRemote(
        bytes32 indexed messageId,
        uint256 nonce,
        uint32 indexed originDomain,
        bytes32 indexed remoteSender,
        address recipient,
        uint256 amount
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "LocalERC20Bridge: not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "LocalERC20Bridge: paused");
        _;
    }

    constructor(address token_, uint32 localDomain_, uint32 remoteDomain_, Mode mode_, address owner_) {
        require(token_ != address(0), "LocalERC20Bridge: zero token");
        require(owner_ != address(0), "LocalERC20Bridge: zero owner");
        token = token_;
        localDomain = localDomain_;
        remoteDomain = remoteDomain_;
        mode = mode_;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "LocalERC20Bridge: zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function quoteGasPayment(uint32 destinationDomain) external view returns (uint256) {
        require(destinationDomain == remoteDomain, "LocalERC20Bridge: bad domain");
        return 0;
    }

    function transferRemote(
        uint32 destinationDomain,
        bytes32 recipient,
        uint256 amount
    ) external payable whenNotPaused returns (bytes32 messageId) {
        require(destinationDomain == remoteDomain, "LocalERC20Bridge: bad domain");
        require(amount > 0, "LocalERC20Bridge: zero amount");
        require(recipient != bytes32(0), "LocalERC20Bridge: zero recipient");

        if (mode == Mode.LockRelease) {
            require(
                ILocalBridgeToken(token).transferFrom(msg.sender, address(this), amount),
                "LocalERC20Bridge: lock failed"
            );
        } else {
            ILocalBridgeToken(token).burn(msg.sender, amount);
        }

        outboundNonce += 1;
        messageId = keccak256(
            abi.encodePacked(
                address(this),
                block.chainid,
                localDomain,
                destinationDomain,
                msg.sender,
                recipient,
                amount,
                outboundNonce
            )
        );
        emit TransferRemote(messageId, outboundNonce, destinationDomain, msg.sender, recipient, amount);
    }

    function receiveRemote(
        bytes32 messageId,
        bytes32 remoteSender,
        address recipient,
        uint256 amount
    ) external onlyOwner whenNotPaused {
        require(!processedMessages[messageId], "LocalERC20Bridge: already processed");
        require(recipient != address(0), "LocalERC20Bridge: zero recipient");
        require(amount > 0, "LocalERC20Bridge: zero amount");
        processedMessages[messageId] = true;

        if (mode == Mode.LockRelease) {
            require(ILocalBridgeToken(token).transfer(recipient, amount), "LocalERC20Bridge: release failed");
        } else {
            ILocalBridgeToken(token).mint(recipient, amount);
        }

        inboundNonce += 1;
        emit ReceivedRemote(messageId, inboundNonce, remoteDomain, remoteSender, recipient, amount);
    }
}
```

## Contract: LocalNativeBridge.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract LocalNativeBridge {
    uint32 public immutable localDomain;
    uint32 public immutable remoteDomain;
    address public owner;
    bool public paused;
    uint256 public outboundNonce;
    uint256 public inboundNonce;
    mapping(bytes32 => bool) public processedMessages;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event Funded(address indexed account, uint256 amount);
    event EmergencyWithdrawal(address indexed to, uint256 amount);
    event TransferRemote(
        bytes32 indexed messageId,
        uint256 indexed nonce,
        uint32 indexed destinationDomain,
        address sender,
        bytes32 recipient,
        uint256 amount
    );
    event ReceivedRemote(
        bytes32 indexed messageId,
        uint256 nonce,
        uint32 indexed originDomain,
        bytes32 indexed remoteSender,
        address recipient,
        uint256 amount
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "LocalNativeBridge: not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "LocalNativeBridge: paused");
        _;
    }

    constructor(uint32 localDomain_, uint32 remoteDomain_, address owner_) payable {
        require(owner_ != address(0), "LocalNativeBridge: zero owner");
        localDomain = localDomain_;
        remoteDomain = remoteDomain_;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
        if (msg.value > 0) emit Funded(msg.sender, msg.value);
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    function fund() external payable {
        emit Funded(msg.sender, msg.value);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "LocalNativeBridge: zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function emergencyWithdraw(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "LocalNativeBridge: zero recipient");
        require(address(this).balance >= amount, "LocalNativeBridge: insufficient liquidity");
        (bool ok, ) = to.call{ value: amount }("");
        require(ok, "LocalNativeBridge: withdraw failed");
        emit EmergencyWithdrawal(to, amount);
    }

    function quoteGasPayment(uint32 destinationDomain) external view returns (uint256) {
        require(destinationDomain == remoteDomain, "LocalNativeBridge: bad domain");
        return 0;
    }

    function transferRemote(
        uint32 destinationDomain,
        bytes32 recipient,
        uint256 amount
    ) external payable whenNotPaused returns (bytes32 messageId) {
        require(destinationDomain == remoteDomain, "LocalNativeBridge: bad domain");
        require(amount > 0, "LocalNativeBridge: zero amount");
        require(msg.value == amount, "LocalNativeBridge: amount/value mismatch");
        require(recipient != bytes32(0), "LocalNativeBridge: zero recipient");

        outboundNonce += 1;
        messageId = keccak256(
            abi.encodePacked(
                address(this),
                block.chainid,
                localDomain,
                destinationDomain,
                msg.sender,
                recipient,
                amount,
                outboundNonce
            )
        );
        emit TransferRemote(messageId, outboundNonce, destinationDomain, msg.sender, recipient, amount);
    }

    function receiveRemote(
        bytes32 messageId,
        bytes32 remoteSender,
        address payable recipient,
        uint256 amount
    ) external onlyOwner whenNotPaused {
        require(!processedMessages[messageId], "LocalNativeBridge: already processed");
        require(recipient != address(0), "LocalNativeBridge: zero recipient");
        require(amount > 0, "LocalNativeBridge: zero amount");
        require(address(this).balance >= amount, "LocalNativeBridge: insufficient liquidity");
        processedMessages[messageId] = true;

        (bool ok, ) = recipient.call{ value: amount }("");
        require(ok, "LocalNativeBridge: release failed");

        inboundNonce += 1;
        emit ReceivedRemote(messageId, inboundNonce, remoteDomain, remoteSender, recipient, amount);
    }
}
```

## Contract: MintableERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MintableERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    address public owner;
    bool public paused;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    modifier onlyOwner() {
        require(msg.sender == owner, "MintableERC20: not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "MintableERC20: paused");
        _;
    }

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address owner_) {
        require(owner_ != address(0), "MintableERC20: zero owner");
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "MintableERC20: zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "MintableERC20: zero mint");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(address from, uint256 amount) external onlyOwner {
        require(balanceOf[from] >= amount, "MintableERC20: burn exceeds balance");
        unchecked {
            balanceOf[from] -= amount;
            totalSupply -= amount;
        }
        emit Transfer(from, address(0), amount);
    }

    function approve(address spender, uint256 amount) external whenNotPaused returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external whenNotPaused returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external whenNotPaused returns (bool) {
        if (from != msg.sender && allowance[from][msg.sender] != type(uint256).max) {
            require(allowance[from][msg.sender] >= amount, "MintableERC20: allowance");
            unchecked {
                allowance[from][msg.sender] -= amount;
            }
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "MintableERC20: zero transfer");
        require(balanceOf[from] >= amount, "MintableERC20: balance");
        unchecked {
            balanceOf[from] -= amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}
```

## Tests: bridge.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

const DOMAIN_ETHEREUM = 31338;
const DOMAIN_XPHERE = 31337;

function addressToBytes32(address) {
  return `0x${"0".repeat(24)}${address.slice(2)}`;
}

function transferRemoteMessageId(bridge, receipt) {
  const event = receipt?.logs
    .map((log) => {
      try {
        return bridge.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed?.name === "TransferRemote");

  expect(event).to.not.equal(undefined);
  return event .args.messageId;
}

async function deployBridgeFixture() {
  const [owner, user, other] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("MintableERC20");
  const collateral = (await Token.deploy("Local USDC", "USDC", 6, owner.address));
  await collateral.waitForDeployment();
  const synthetic = (await Token.deploy("Local xUSDC", "xUSDC", 6, owner.address));
  await synthetic.waitForDeployment();

  const Bridge = await ethers.getContractFactory("LocalERC20Bridge");
  const collateralBridge = (await Bridge.deploy(
    await collateral.getAddress(),
    DOMAIN_ETHEREUM,
    DOMAIN_XPHERE,
    0,
    owner.address,
  ));
  await collateralBridge.waitForDeployment();
  const syntheticBridge = (await Bridge.deploy(
    await synthetic.getAddress(),
    DOMAIN_XPHERE,
    DOMAIN_ETHEREUM,
    1,
    owner.address,
  ));
  await syntheticBridge.waitForDeployment();

  await collateral.mint(user.address, ethers.parseUnits("1000", 6));
  await synthetic.transferOwnership(await syntheticBridge.getAddress());

  return { owner, user, other, collateral, synthetic, collateralBridge, syntheticBridge };
}

async function deployNativeBridgeFixture() {
  const [owner, user, other] = await ethers.getSigners();
  const Bridge = await ethers.getContractFactory("LocalNativeBridge");
  const ethereumBridge = (await Bridge.deploy(DOMAIN_ETHEREUM, DOMAIN_XPHERE, owner.address, {
    value: ethers.parseEther("25"),
  }));
  await ethereumBridge.waitForDeployment();
  const xphereBridge = (await Bridge.deploy(DOMAIN_XPHERE, DOMAIN_ETHEREUM, owner.address, {
    value: ethers.parseEther("25"),
  }));
  await xphereBridge.waitForDeployment();
  return { owner, user, other, ethereumBridge, xphereBridge };
}

describe("LocalERC20Bridge", function () {
  it("locks collateral and mints synthetic with replay protection", async function () {
    const { user, collateral, synthetic, collateralBridge, syntheticBridge } = await deployBridgeFixture();
    const amount = ethers.parseUnits("25", 6);
    const recipient = addressToBytes32(user.address);

    await collateral.connect(user).approve(await collateralBridge.getAddress(), amount);
    const tx = await collateralBridge.connect(user).transferRemote(DOMAIN_XPHERE, recipient, amount);
    const receipt = await tx.wait();
    const event = receipt?.logs
      .map((log) => {
        try {
          return collateralBridge.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "TransferRemote");

    expect(event).to.not.equal(undefined);
    const messageId = event .args.messageId;
    expect(await collateral.balanceOf(await collateralBridge.getAddress())).to.equal(amount);

    await syntheticBridge.receiveRemote(messageId, addressToBytes32(user.address), user.address, amount);
    expect(await synthetic.balanceOf(user.address)).to.equal(amount);

    await expect(
      syntheticBridge.receiveRemote(messageId, addressToBytes32(user.address), user.address, amount),
    ).to.be.revertedWith("LocalERC20Bridge: already processed");
  });

  it("burns synthetic and releases collateral", async function () {
    const { user, collateral, synthetic, collateralBridge, syntheticBridge } = await deployBridgeFixture();
    const amount = ethers.parseUnits("40", 6);
    const messageId = ethers.keccak256(ethers.toUtf8Bytes("inbound synthetic seed"));

    await collateral.mint(await collateralBridge.getAddress(), amount);
    await syntheticBridge.receiveRemote(messageId, addressToBytes32(user.address), user.address, amount);
    expect(await synthetic.balanceOf(user.address)).to.equal(amount);

    await synthetic.connect(user).approve(await syntheticBridge.getAddress(), amount);
    await syntheticBridge.connect(user).transferRemote(DOMAIN_ETHEREUM, addressToBytes32(user.address), amount);
    expect(await synthetic.balanceOf(user.address)).to.equal(0);

    const releaseMessageId = ethers.keccak256(ethers.toUtf8Bytes("release collateral"));
    const before = await collateral.balanceOf(user.address);
    await collateralBridge.receiveRemote(releaseMessageId, addressToBytes32(user.address), user.address, amount);
    expect(await collateral.balanceOf(user.address)).to.equal(before + amount);
  });

  it("enforces owner-only receive and pause controls", async function () {
    const { user, other, collateral, collateralBridge } = await deployBridgeFixture();
    const amount = ethers.parseUnits("5", 6);

    await expect(
      collateralBridge.connect(other).receiveRemote(
        ethers.keccak256(ethers.toUtf8Bytes("unauthorized")),
        addressToBytes32(user.address),
        user.address,
        amount,
      ),
    ).to.be.revertedWith("LocalERC20Bridge: not owner");

    await collateralBridge.pause();
    await collateral.connect(user).approve(await collateralBridge.getAddress(), amount);
    await expect(
      collateralBridge.connect(user).transferRemote(DOMAIN_XPHERE, addressToBytes32(user.address), amount),
    ).to.be.revertedWith("LocalERC20Bridge: paused");

    await collateralBridge.unpause();
    await collateralBridge.connect(user).transferRemote(DOMAIN_XPHERE, addressToBytes32(user.address), amount);
  });

  it("includes the bridge address in message IDs to avoid redeploy collisions", async function () {
    const { owner, user, collateral, collateralBridge } = await deployBridgeFixture();
    const Bridge = await ethers.getContractFactory("LocalERC20Bridge");
    const secondBridge = (await Bridge.deploy(
      await collateral.getAddress(),
      DOMAIN_ETHEREUM,
      DOMAIN_XPHERE,
      0,
      owner.address,
    ));
    await secondBridge.waitForDeployment();

    const amount = ethers.parseUnits("5", 6);
    const recipient = addressToBytes32(user.address);
    await collateral.connect(user).approve(await collateralBridge.getAddress(), amount);
    await collateral.connect(user).approve(await secondBridge.getAddress(), amount);

    const firstReceipt = await (await collateralBridge.connect(user).transferRemote(DOMAIN_XPHERE, recipient, amount)).wait();
    const secondReceipt = await (await secondBridge.connect(user).transferRemote(DOMAIN_XPHERE, recipient, amount)).wait();

    expect(transferRemoteMessageId(collateralBridge, firstReceipt)).to.not.equal(
      transferRemoteMessageId(secondBridge, secondReceipt),
    );
  });

  it("rejects invalid domains, zero recipients, and zero amounts", async function () {
    const { user, collateralBridge } = await deployBridgeFixture();

    await expect(
      collateralBridge.connect(user).transferRemote(1, addressToBytes32(user.address), ethers.parseUnits("1", 6)),
    ).to.be.revertedWith("LocalERC20Bridge: bad domain");

    await expect(
      collateralBridge.connect(user).transferRemote(DOMAIN_XPHERE, ethers.ZeroHash, ethers.parseUnits("1", 6)),
    ).to.be.revertedWith("LocalERC20Bridge: zero recipient");

    await expect(
      collateralBridge.connect(user).transferRemote(DOMAIN_XPHERE, addressToBytes32(user.address), 0),
    ).to.be.revertedWith("LocalERC20Bridge: zero amount");
  });
});

describe("LocalNativeBridge", function () {
  it("locks native collateral and releases native liquidity with replay protection", async function () {
    const { user, ethereumBridge, xphereBridge } = await deployNativeBridgeFixture();
    const amount = ethers.parseEther("1.25");
    const recipient = addressToBytes32(user.address);
    const beforeSourceBridge = await ethers.provider.getBalance(await ethereumBridge.getAddress());

    const tx = await ethereumBridge.connect(user).transferRemote(DOMAIN_XPHERE, recipient, amount, { value: amount });
    const receipt = await tx.wait();
    const event = receipt?.logs
      .map((log) => {
        try {
          return ethereumBridge.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "TransferRemote");

    expect(event).to.not.equal(undefined);
    const messageId = event .args.messageId;
    expect(await ethers.provider.getBalance(await ethereumBridge.getAddress())).to.equal(beforeSourceBridge + amount);

    const beforeRecipient = await ethers.provider.getBalance(user.address);
    await xphereBridge.receiveRemote(messageId, addressToBytes32(user.address), user.address, amount);
    expect(await ethers.provider.getBalance(user.address)).to.equal(beforeRecipient + amount);

    await expect(
      xphereBridge.receiveRemote(messageId, addressToBytes32(user.address), user.address, amount),
    ).to.be.revertedWith("LocalNativeBridge: already processed");
  });

  it("bridges native value in the reverse direction", async function () {
    const { user, ethereumBridge, xphereBridge } = await deployNativeBridgeFixture();
    const amount = ethers.parseEther("0.5");

    const tx = await xphereBridge
      .connect(user)
      .transferRemote(DOMAIN_ETHEREUM, addressToBytes32(user.address), amount, { value: amount });
    const receipt = await tx.wait();
    const event = receipt?.logs
      .map((log) => {
        try {
          return xphereBridge.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "TransferRemote");
    const messageId = event .args.messageId;

    const beforeRecipient = await ethers.provider.getBalance(user.address);
    await ethereumBridge.receiveRemote(messageId, addressToBytes32(user.address), user.address, amount);
    expect(await ethers.provider.getBalance(user.address)).to.equal(beforeRecipient + amount);
  });

  it("enforces native owner-only receive and pause controls", async function () {
    const { user, other, ethereumBridge } = await deployNativeBridgeFixture();
    const amount = ethers.parseEther("0.1");

    await expect(
      ethereumBridge
        .connect(other)
        .receiveRemote(ethers.keccak256(ethers.toUtf8Bytes("unauthorized-native")), addressToBytes32(user.address), user.address, amount),
    ).to.be.revertedWith("LocalNativeBridge: not owner");

    await ethereumBridge.pause();
    await expect(
      ethereumBridge.connect(user).transferRemote(DOMAIN_XPHERE, addressToBytes32(user.address), amount, { value: amount }),
    ).to.be.revertedWith("LocalNativeBridge: paused");
  });

  it("includes the native bridge address in message IDs to avoid redeploy collisions", async function () {
    const { owner, user, ethereumBridge } = await deployNativeBridgeFixture();
    const Bridge = await ethers.getContractFactory("LocalNativeBridge");
    const secondBridge = (await Bridge.deploy(DOMAIN_ETHEREUM, DOMAIN_XPHERE, owner.address, {
      value: ethers.parseEther("25"),
    }));
    await secondBridge.waitForDeployment();

    const amount = ethers.parseEther("0.1");
    const recipient = addressToBytes32(user.address);
    const firstReceipt = await (
      await ethereumBridge.connect(user).transferRemote(DOMAIN_XPHERE, recipient, amount, { value: amount })
    ).wait();
    const secondReceipt = await (
      await secondBridge.connect(user).transferRemote(DOMAIN_XPHERE, recipient, amount, { value: amount })
    ).wait();

    expect(transferRemoteMessageId(ethereumBridge, firstReceipt)).to.not.equal(
      transferRemoteMessageId(secondBridge, secondReceipt),
    );
  });

  it("rejects bad native bridge inputs", async function () {
    const { user, ethereumBridge } = await deployNativeBridgeFixture();
    const amount = ethers.parseEther("0.1");

    await expect(
      ethereumBridge.connect(user).transferRemote(1, addressToBytes32(user.address), amount, { value: amount }),
    ).to.be.revertedWith("LocalNativeBridge: bad domain");

    await expect(
      ethereumBridge.connect(user).transferRemote(DOMAIN_XPHERE, ethers.ZeroHash, amount, { value: amount }),
    ).to.be.revertedWith("LocalNativeBridge: zero recipient");

    await expect(
      ethereumBridge.connect(user).transferRemote(DOMAIN_XPHERE, addressToBytes32(user.address), amount, { value: 0 }),
    ).to.be.revertedWith("LocalNativeBridge: amount/value mismatch");
  });
});
```
