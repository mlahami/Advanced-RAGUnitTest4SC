# flow-pay-split--edhovx

- domain: escrow-conditional-payments (payments)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/edhovx/flowpay @ 349380c86acf15ade2019d7a3aa2d2776547fc04
- license: MIT
- targets: FlowPaySplit.sol, MockUSDC.sol
- validation: 10 passing tests, 0 failing; statement coverage FlowPaySplit.sol 94.12 %, MockUSDC.sol 50.0 %

## Contract: FlowPaySplit.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title FlowPaySplit
 * @notice Multi-recipient USDC payment split for Arc.
 * @dev A funder creates a split with N recipients, funds it once, and each
 *      recipient claims their share. Claim pattern = 1 transfer per claim
 *      (gas optimized, no payout loop). Unclaimed funds can be pulled back
 *      by the funder after the expiry deadline.
 */
contract FlowPaySplit is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Recipient {
        address account;
        uint256 amount;
        bool claimed;
    }

    struct Split {
        uint256 id;
        address funder;
        string title;
        uint256 total;
        uint256 expiry; // timestamp after which unclaimed funds can be pulled back
        uint256 createdAt;
        uint256 fundedAt;
        uint256 claimedCount;
        uint256 claimedTotal;
        bool funded;
        bool refunded;
    }

    IERC20 public immutable usdc;
    uint256 public nextSplitId;
    mapping(uint256 => Split) public splits;
    mapping(uint256 => Recipient[]) public recipients;
    mapping(address => uint256[]) public splitsByFunder;
    mapping(address => uint256[]) public splitsByRecipient;

    event SplitCreated(
        uint256 indexed splitId,
        address indexed funder,
        uint256 total,
        uint256 expiry,
        uint256 recipientCount
    );
    event SplitFunded(uint256 indexed splitId, address indexed funder, uint256 total);
    event SplitClaimed(uint256 indexed splitId, uint256 indexed index, address indexed recipient, uint256 amount);
    event SplitRefunded(uint256 indexed splitId, address indexed funder, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error EmptyRecipients();
    error MismatchedArrays();
    error DuplicateRecipient();
    error InvalidDeadline();
    error SplitNotFound();
    error AlreadyFunded();
    error NotFunded();
    error AlreadyClaimed();
    error Unauthorized();
    error NotExpired();
    error AlreadyRefunded();
    error NothingToRefund();

    constructor(address _usdc) Ownable(msg.sender) {
        if (_usdc == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdc);
    }

    modifier onlyFunder(uint256 splitId) {
        if (splits[splitId].funder != msg.sender) revert Unauthorized();
        _;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Create a split with N recipients. Expiry must be in the future.
    function createSplit(
        address[] calldata accounts,
        uint256[] calldata amounts,
        string calldata title,
        uint256 expiry
    ) external returns (uint256 splitId) {
        if (accounts.length == 0) revert EmptyRecipients();
        if (accounts.length != amounts.length) revert MismatchedArrays();
        if (expiry <= block.timestamp) revert InvalidDeadline();

        uint256 total;
        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] == address(0)) revert ZeroAddress();
            if (amounts[i] == 0) revert ZeroAmount();
            for (uint256 j = 0; j < i; j++) {
                if (accounts[j] == accounts[i]) revert DuplicateRecipient();
            }
            total += amounts[i];
        }

        splitId = nextSplitId++;
        Split storage s = splits[splitId];
        s.id = splitId;
        s.funder = msg.sender;
        s.title = title;
        s.total = total;
        s.expiry = expiry;
        s.createdAt = block.timestamp;

        for (uint256 i = 0; i < accounts.length; i++) {
            recipients[splitId].push(Recipient({ account: accounts[i], amount: amounts[i], claimed: false }));
        }

        splitsByFunder[msg.sender].push(splitId);
        for (uint256 i = 0; i < accounts.length; i++) {
            splitsByRecipient[accounts[i]].push(splitId);
        }

        emit SplitCreated(splitId, msg.sender, total, expiry, accounts.length);
    }

    /// @notice Funder locks the total USDC into the contract.
    function fundSplit(uint256 splitId) external nonReentrant whenNotPaused onlyFunder(splitId) {
        Split storage s = splits[splitId];
        if (s.funder == address(0)) revert SplitNotFound();
        if (s.funded) revert AlreadyFunded();

        usdc.safeTransferFrom(msg.sender, address(this), s.total);
        s.funded = true;
        s.fundedAt = block.timestamp;

        emit SplitFunded(splitId, msg.sender, s.total);
    }

    /// @notice Recipient claims their own share (or anyone calls claimFor on their behalf).
    function claim(uint256 splitId, uint256 index) external nonReentrant whenNotPaused {
        Recipient storage r = recipients[splitId][index];
        if (r.account != msg.sender) revert Unauthorized();
        _payout(splitId, index, r);
    }

    function claimFor(uint256 splitId, uint256 index) external nonReentrant whenNotPaused {
        Recipient storage r = recipients[splitId][index];
        _payout(splitId, index, r);
    }

    function _payout(uint256 splitId, uint256 index, Recipient storage r) internal {
        Split storage s = splits[splitId];
        if (s.funder == address(0)) revert SplitNotFound();
        if (!s.funded) revert NotFunded();
        if (r.claimed) revert AlreadyClaimed();

        r.claimed = true;
        s.claimedCount += 1;
        s.claimedTotal += r.amount;

        usdc.safeTransfer(r.account, r.amount);
        emit SplitClaimed(splitId, index, r.account, r.amount);
    }

    /// @notice Funder pulls back unclaimed funds after expiry (dust = anything left).
    function refundUnclaimed(uint256 splitId) external nonReentrant onlyFunder(splitId) {
        Split storage s = splits[splitId];
        if (s.funder == address(0)) revert SplitNotFound();
        if (!s.funded) revert NotFunded();
        if (s.refunded) revert AlreadyRefunded();
        if (block.timestamp <= s.expiry) revert NotExpired();

        uint256 remaining = s.total - s.claimedTotal;
        if (remaining == 0) revert NothingToRefund();

        s.refunded = true;
        usdc.safeTransfer(msg.sender, remaining);
        emit SplitRefunded(splitId, msg.sender, remaining);
    }

    // ---------- Views ----------

    function getSplit(uint256 splitId) external view returns (Split memory) {
        return splits[splitId];
    }

    function getRecipient(uint256 splitId, uint256 index) external view returns (Recipient memory) {
        return recipients[splitId][index];
    }

    function getRecipients(uint256 splitId) external view returns (Recipient[] memory) {
        return recipients[splitId];
    }

    function getRecipientCount(uint256 splitId) external view returns (uint256) {
        return recipients[splitId].length;
    }

    function getSplitsByFunder(address funder) external view returns (uint256[] memory) {
        return splitsByFunder[funder];
    }

    function getSplitsByRecipient(address recipient) external view returns (uint256[] memory) {
        return splitsByRecipient[recipient];
    }
}
```

## Contract: MockUSDC.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
```

## Tests: FlowPaySplit.js

```javascript
const { expect } = require("chai");
const hre = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { ethers } = require("ethers");

describe("FlowPaySplit", function () {
  async function deployFixture() {
    const [owner, funder, alice, bob, carol] = await hre.ethers.getSigners();
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    const Split = await hre.ethers.getContractFactory("FlowPaySplit");
    const split = await Split.deploy(await usdc.getAddress());

    await usdc.mint(funder.address, ethers.parseUnits("100000", 6));
    await usdc
      .connect(funder)
      .approve(await split.getAddress(), ethers.MaxUint256);

    return { usdc, split, owner, funder, alice, bob, carol };
  }

  async function createSplit(f, { accounts, amounts, expiry = 3600n } = {}) {
    const now = BigInt(await time.latest());
    return f.split
      .connect(f.funder)
      .createSplit(
        accounts || [f.alice.address, f.bob.address],
        amounts || [ethers.parseUnits("600", 6), ethers.parseUnits("400", 6)],
        "Revenue share Q3",
        now + expiry,
      );
  }

  it("should create a split with recipients", async function () {
    const f = await deployFixture();
    await expect(createSplit(f))
      .to.emit(f.split, "SplitCreated")
      .withArgs(0, f.funder.address, ethers.parseUnits("1000", 6), anyValue, 2);

    const s = await f.split.getSplit(0);
    expect(s.total).to.equal(ethers.parseUnits("1000", 6));
    expect(s.funder).to.equal(f.funder.address);
    expect(await f.split.getRecipientCount(0)).to.equal(2);
    const r = await f.split.getRecipient(0, 0);
    expect(r.account).to.equal(f.alice.address);
    expect(r.amount).to.equal(ethers.parseUnits("600", 6));
  });

  it("should reject invalid inputs", async function () {
    const f = await deployFixture();
    await expect(
      f.split.connect(f.funder).createSplit([], [], "x", 3600n),
    ).to.be.revertedWithCustomError(f.split, "EmptyRecipients");

    const now = BigInt(await time.latest());
    await expect(
      f.split
        .connect(f.funder)
        .createSplit(
          [f.alice.address],
          [ethers.parseUnits("100", 6), ethers.parseUnits("100", 6)],
          "x",
          now + 3600n,
        ),
    ).to.be.revertedWithCustomError(f.split, "MismatchedArrays");

    await expect(
      f.split
        .connect(f.funder)
        .createSplit(
          [f.alice.address, f.alice.address],
          [ethers.parseUnits("100", 6), ethers.parseUnits("100", 6)],
          "x",
          now + 3600n,
        ),
    ).to.be.revertedWithCustomError(f.split, "DuplicateRecipient");

    await expect(
      f.split.connect(f.funder).createSplit([f.alice.address], [100], "x", now),
    ).to.be.revertedWithCustomError(f.split, "InvalidDeadline");
  });

  it("should fund a split", async function () {
    const f = await deployFixture();
    await createSplit(f);
    await expect(f.split.connect(f.funder).fundSplit(0))
      .to.emit(f.split, "SplitFunded")
      .withArgs(0, f.funder.address, ethers.parseUnits("1000", 6));
    expect(await f.usdc.balanceOf(await f.split.getAddress())).to.equal(
      ethers.parseUnits("1000", 6),
    );
  });

  it("should reject double funding", async function () {
    const f = await deployFixture();
    await createSplit(f);
    await f.split.connect(f.funder).fundSplit(0);
    await expect(
      f.split.connect(f.funder).fundSplit(0),
    ).to.be.revertedWithCustomError(f.split, "AlreadyFunded");
  });

  it("should let each recipient claim their share once", async function () {
    const f = await deployFixture();
    await createSplit(f);
    await f.split.connect(f.funder).fundSplit(0);

    await expect(f.split.connect(f.alice).claim(0, 0))
      .to.emit(f.split, "SplitClaimed")
      .withArgs(0, 0, f.alice.address, ethers.parseUnits("600", 6));
    expect(await f.usdc.balanceOf(f.alice.address)).to.equal(
      ethers.parseUnits("600", 6),
    );

    await f.split.connect(f.bob).claim(0, 1);
    expect(await f.usdc.balanceOf(f.bob.address)).to.equal(
      ethers.parseUnits("400", 6),
    );

    const s = await f.split.getSplit(0);
    expect(s.claimedCount).to.equal(2);
    expect(s.claimedTotal).to.equal(ethers.parseUnits("1000", 6));

    // double claim reverts
    await expect(
      f.split.connect(f.alice).claim(0, 0),
    ).to.be.revertedWithCustomError(f.split, "AlreadyClaimed");
  });

  it("should reject claiming before funding or for others' slots", async function () {
    const f = await deployFixture();
    await createSplit(f);
    // not funded yet
    await expect(
      f.split.connect(f.alice).claim(0, 0),
    ).to.be.revertedWithCustomError(f.split, "NotFunded");
    await f.split.connect(f.funder).fundSplit(0);
    // wrong slot
    await expect(
      f.split.connect(f.alice).claim(0, 1),
    ).to.be.revertedWithCustomError(f.split, "Unauthorized");
  });

  it("should allow claimFor to pay out on a recipient's behalf", async function () {
    const f = await deployFixture();
    await createSplit(f);
    await f.split.connect(f.funder).fundSplit(0);
    await expect(f.split.connect(f.carol).claimFor(0, 1))
      .to.emit(f.split, "SplitClaimed")
      .withArgs(0, 1, f.bob.address, ethers.parseUnits("400", 6));
    expect(await f.usdc.balanceOf(f.bob.address)).to.equal(
      ethers.parseUnits("400", 6),
    );
  });

  it("should refund unclaimed funds to the funder after expiry", async function () {
    const f = await deployFixture();
    await createSplit(f);
    await f.split.connect(f.funder).fundSplit(0);
    await f.split.connect(f.alice).claim(0, 0);

    await time.increase(7200);
    await expect(f.split.connect(f.funder).refundUnclaimed(0))
      .to.emit(f.split, "SplitRefunded")
      .withArgs(0, f.funder.address, ethers.parseUnits("400", 6));

    expect(await f.usdc.balanceOf(f.funder.address)).to.equal(
      ethers.parseUnits("100000", 6) - ethers.parseUnits("600", 6),
    );
    expect((await f.split.getSplit(0)).refunded).to.equal(true);
  });

  it("should reject refund before expiry and double refund", async function () {
    const f = await deployFixture();
    await createSplit(f);
    await f.split.connect(f.funder).fundSplit(0);
    await expect(
      f.split.connect(f.funder).refundUnclaimed(0),
    ).to.be.revertedWithCustomError(f.split, "NotExpired");

    await time.increase(7200);
    await f.split.connect(f.funder).refundUnclaimed(0);
    await expect(
      f.split.connect(f.funder).refundUnclaimed(0),
    ).to.be.revertedWithCustomError(f.split, "AlreadyRefunded");
  });

  it("should list splits by funder and recipient", async function () {
    const f = await deployFixture();
    await createSplit(f);
    await createSplit(f, {
      accounts: [f.alice.address, f.carol.address],
      amounts: [100, 200],
    });
    expect(await f.split.getSplitsByFunder(f.funder.address)).to.deep.equal([
      0n,
      1n,
    ]);
    const aliceSplits = await f.split.getSplitsByRecipient(f.alice.address);
    expect(aliceSplits.length).to.equal(2);
  });
});
```
