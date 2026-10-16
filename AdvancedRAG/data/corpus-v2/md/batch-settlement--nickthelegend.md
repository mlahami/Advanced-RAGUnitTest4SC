# batch-settlement--nickthelegend

- domain: rate-limiting (rate-limiting)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/nickthelegend/polaris-monad @ 03106bac2527c581de297bedc90cea34c0d47f79
- license: MIT
- targets: BatchSettlement.sol, MockUSDC.sol
- validation: 14 passing tests, 0 failing; statement coverage BatchSettlement.sol 95.0 %, MockUSDC.sol 40.0 %

## Contract: BatchSettlement.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BatchSettlement
 * @notice Pay every merchant owed money in one transaction, each with a memo.
 *
 * @dev Settlement is the part of a payments business that scales badly. Paying
 *      merchants one transaction at a time means one gas cost, one nonce and
 *      one failure mode per merchant per cycle; at a few hundred merchants that
 *      is the dominant operating cost and the dominant source of partial
 *      failure.
 *
 *      Tempo makes atomic batch payout native, with a protocol-level 32-byte
 *      memo on each leg. On an ordinary EVM chain the same shape has to be a
 *      contract, and this is it — deliberately mirroring Tempo's semantics so
 *      the keeper calls the same thing either way and a future move to Tempo is
 *      a config change rather than a rewrite.
 *
 *      Two properties matter and both are load-bearing:
 *
 *      Atomicity. Either every merchant is paid or none is. A partial batch is
 *      the worst outcome: the book says settled, some merchants are not, and
 *      reconciling which is which after the fact is manual work.
 *
 *      Memos. Each leg carries a reference the merchant can match to their own
 *      invoice from a block explorer, without trusting our dashboard. Emitting
 *      it as an indexed event topic is what makes that lookup cheap.
 */
contract BatchSettlement is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable stablecoin;

    /// Bounded so a batch cannot be built that will not fit in a block.
    uint256 public constant MAX_BATCH = 250;

    /// Settlers allowed to draw on this contract's balance. The keeper.
    mapping(address => bool) public isSettler;

    /// Guards against a retried batch paying twice.
    mapping(bytes32 => bool) public batchExecuted;

    uint256 public totalSettled;
    uint256 public batchCount;

    event BatchSettled(
        bytes32 indexed batchId,
        uint256 recipients,
        uint256 totalAmount,
        address indexed settler
    );
    event MerchantPaid(
        bytes32 indexed batchId,
        address indexed merchant,
        uint256 amount,
        bytes32 indexed memo
    );
    event SettlerSet(address indexed settler, bool allowed);
    event Funded(address indexed from, uint256 amount);

    error NotSettler();
    error EmptyBatch();
    error BatchTooLarge(uint256 size);
    error LengthMismatch();
    error BatchAlreadyExecuted(bytes32 batchId);
    error ZeroRecipient(uint256 index);
    error ZeroAmount(uint256 index);
    error InsufficientBalance(uint256 have, uint256 need);

    modifier onlySettler() {
        if (!isSettler[msg.sender]) revert NotSettler();
        _;
    }

    constructor(address initialOwner, IERC20 _stablecoin) Ownable(initialOwner) {
        stablecoin = _stablecoin;
    }

    function setSettler(address settler, bool allowed) external onlyOwner {
        isSettler[settler] = allowed;
        emit SettlerSet(settler, allowed);
    }

    /// @notice Top up the balance this contract pays merchants from.
    function fund(uint256 amount) external {
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    function withdraw(uint256 amount, address to) external onlyOwner {
        stablecoin.safeTransfer(to, amount);
    }

    /**
     * @notice Pay many merchants at once, atomically.
     *
     * @param batchId  Caller-chosen id. A repeat reverts rather than paying
     *                 twice, so a keeper retrying an ambiguous transaction is
     *                 safe.
     * @param memos    One per recipient. A merchant's own invoice reference,
     *                 indexed so they can find their leg without our help.
     *
     * @dev The balance is checked once up front rather than letting a transfer
     *      revert partway. Both revert, but failing early makes the reason
     *      legible: "the pool was short by X" instead of an ERC-20 error from
     *      inside a loop at an index nobody can interpret.
     */
    function settleBatch(
        bytes32 batchId,
        address[] calldata merchants,
        uint256[] calldata amounts,
        bytes32[] calldata memos
    ) external onlySettler nonReentrant returns (uint256 totalAmount) {
        uint256 n = merchants.length;
        if (n == 0) revert EmptyBatch();
        if (n > MAX_BATCH) revert BatchTooLarge(n);
        if (amounts.length != n || memos.length != n) revert LengthMismatch();
        if (batchExecuted[batchId]) revert BatchAlreadyExecuted(batchId);

        for (uint256 i = 0; i < n; i++) {
            if (merchants[i] == address(0)) revert ZeroRecipient(i);
            if (amounts[i] == 0) revert ZeroAmount(i);
            totalAmount += amounts[i];
        }

        uint256 balance = stablecoin.balanceOf(address(this));
        if (balance < totalAmount) revert InsufficientBalance(balance, totalAmount);

        batchExecuted[batchId] = true;
        batchCount += 1;
        totalSettled += totalAmount;

        for (uint256 i = 0; i < n; i++) {
            stablecoin.safeTransfer(merchants[i], amounts[i]);
            emit MerchantPaid(batchId, merchants[i], amounts[i], memos[i]);
        }

        emit BatchSettled(batchId, n, totalAmount, msg.sender);
    }

    /// @notice Whether a batch would succeed, without sending it.
    function canSettle(bytes32 batchId, uint256[] calldata amounts)
        external
        view
        returns (bool ok, uint256 required, uint256 available)
    {
        for (uint256 i = 0; i < amounts.length; i++) {
            required += amounts[i];
        }
        available = stablecoin.balanceOf(address(this));
        ok = !batchExecuted[batchId] && available >= required && amounts.length <= MAX_BATCH;
    }
}
```

## Contract: MockUSDC.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Six-decimal test stablecoin for Base Sepolia, with an open faucet so
 *         a demo borrower can fund themselves without a deployer round trip.
 */
contract MockUSDC is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1_000e6;

    mapping(address => uint256) public lastFaucetAt;

    error FaucetCooldown();

    constructor() ERC20("Polaris USD", "pUSDC") {
        _mint(msg.sender, 10_000_000e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Claim test USDC. Rate-limited so one address cannot drain it.
    function faucet() external {
        if (block.timestamp < lastFaucetAt[msg.sender] + 1 hours) revert FaucetCooldown();
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Tests: BatchSettlement.guards.test.js

```javascript
/**
 * Input validation and accounting for BatchSettlement.
 *
 * The happy path is covered in BatchSettlement.test.js. What is covered here is
 * the set of ways a keeper can build a malformed batch, because the keeper is
 * an automated caller: a batch assembled from a bad database row will be sent
 * without a human ever looking at it, and the only thing standing between that
 * and a wrong payout is these reverts.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

const U = (n) => BigInt(Math.round(n * 1e6));
const memo = (s) => ethers.encodeBytes32String(s);

describe("BatchSettlement guards", () => {
  let usdc, batch, owner, keeper, m1, m2, outsider;

  beforeEach(async () => {
    [owner, keeper, m1, m2, outsider] = await ethers.getSigners();
    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    batch = await (
      await ethers.getContractFactory("BatchSettlement")
    ).deploy(owner.address, await usdc.getAddress());
    await batch.setSettler(keeper.address, true);
    await usdc.approve(await batch.getAddress(), U(1_000_000));
    await batch.fund(U(10_000));
  });

  describe("malformed batches", () => {
    it("rejects an empty batch rather than emitting a settlement of nothing", async () => {
      await expect(
        batch.connect(keeper).settleBatch(memo("empty"), [], [], [])
      ).to.be.revertedWithCustomError(batch, "EmptyBatch");
    });

    it("names the offending index on a zero amount", async () => {
      await expect(
        batch
          .connect(keeper)
          .settleBatch(
            memo("z"),
            [m1.address, m2.address],
            [U(5), 0n],
            [memo("A"), memo("B")]
          )
      )
        .to.be.revertedWithCustomError(batch, "ZeroAmount")
        .withArgs(1);
    });

    it("rejects a memo array of the wrong length", async () => {
      // The amounts line up but the memos do not, so a merchant would be paid
      // against somebody else's invoice reference.
      await expect(
        batch
          .connect(keeper)
          .settleBatch(
            memo("mm"),
            [m1.address, m2.address],
            [U(1), U(2)],
            [memo("only-one")]
          )
      ).to.be.revertedWithCustomError(batch, "LengthMismatch");
    });

    it("rejects a batch larger than one block can carry", async () => {
      const n = Number(await batch.MAX_BATCH()) + 1;
      const wallets = Array.from({ length: n }, (_, i) =>
        ethers.getAddress("0x" + (i + 1).toString(16).padStart(40, "0"))
      );
      await expect(
        batch
          .connect(keeper)
          .settleBatch(
            memo("huge"),
            wallets,
            wallets.map(() => 1n),
            wallets.map(() => memo("x"))
          )
      )
        .to.be.revertedWithCustomError(batch, "BatchTooLarge")
        .withArgs(n);
    });

    it("reports the shortfall in the revert, so the keeper knows how much to top up", async () => {
      const pot = await usdc.balanceOf(await batch.getAddress());
      await expect(
        batch.connect(keeper).settleBatch(memo("short"), [m1.address], [pot + 1n], [memo("A")])
      )
        .to.be.revertedWithCustomError(batch, "InsufficientBalance")
        .withArgs(pot, pot + 1n);
    });
  });

  describe("accounting", () => {
    it("moves exactly the batch total out of the pot, and no more", async () => {
      const potBefore = await usdc.balanceOf(await batch.getAddress());
      const amounts = [U(100), U(250.5)];

      await batch
        .connect(keeper)
        .settleBatch(memo("acct"), [m1.address, m2.address], amounts, [memo("A"), memo("B")]);

      const total = amounts.reduce((a, b) => a + b, 0n);
      expect(await usdc.balanceOf(await batch.getAddress())).to.equal(potBefore - total);
    });

    it("emits BatchSettled with the recipient count, total and the settler that ran it", async () => {
      await expect(
        batch
          .connect(keeper)
          .settleBatch(
            memo("evt"),
            [m1.address, m2.address],
            [U(3), U(7)],
            [memo("A"), memo("B")]
          )
      )
        .to.emit(batch, "BatchSettled")
        .withArgs(memo("evt"), 2, U(10), keeper.address);
    });

    it("returns the batch total to the caller, so a keeper can reconcile without a log read", async () => {
      const total = await batch
        .connect(keeper)
        .settleBatch.staticCall(memo("ret"), [m1.address], [U(42)], [memo("A")]);
      expect(total).to.equal(U(42));
    });

    it("scopes the replay guard to the batch id, so a later batch is unaffected", async () => {
      await batch.connect(keeper).settleBatch(memo("first"), [m1.address], [U(10)], [memo("A")]);
      await expect(
        batch.connect(keeper).settleBatch(memo("second"), [m1.address], [U(10)], [memo("A")])
      ).to.not.be.reverted;
      expect(await batch.batchExecuted(memo("first"))).to.equal(true);
      expect(await batch.batchExecuted(memo("second"))).to.equal(true);
    });

    it("canSettle turns false once the id has been used, so a retry is caught before sending", async () => {
      const amounts = [U(10)];
      expect((await batch.canSettle(memo("dup"), amounts))[0]).to.equal(true);
      await batch.connect(keeper).settleBatch(memo("dup"), [m1.address], amounts, [memo("A")]);
      expect((await batch.canSettle(memo("dup"), amounts))[0]).to.equal(false);
    });
  });

  describe("access control", () => {
    it("rejects a settler whose permission has been revoked", async () => {
      await batch.setSettler(keeper.address, false);
      await expect(
        batch.connect(keeper).settleBatch(memo("revoked"), [m1.address], [U(1)], [memo("A")])
      ).to.be.revertedWithCustomError(batch, "NotSettler");
    });

    it("refuses to let a non-owner appoint themselves settler", async () => {
      await expect(
        batch.connect(outsider).setSettler(outsider.address, true)
      ).to.be.revertedWithCustomError(batch, "OwnableUnauthorizedAccount");
    });

    it("refuses to let a non-owner drain the pot", async () => {
      await expect(
        batch.connect(outsider).withdraw(U(1), outsider.address)
      ).to.be.revertedWithCustomError(batch, "OwnableUnauthorizedAccount");
    });

    it("lets anyone top up the pot, since funding can only add value", async () => {
      await usdc.mint(outsider.address, U(500));
      await usdc.connect(outsider).approve(await batch.getAddress(), U(500));
      const before = await usdc.balanceOf(await batch.getAddress());
      await expect(batch.connect(outsider).fund(U(500)))
        .to.emit(batch, "Funded")
        .withArgs(outsider.address, U(500));
      expect(await usdc.balanceOf(await batch.getAddress())).to.equal(before + U(500));
    });
  });
});
```
