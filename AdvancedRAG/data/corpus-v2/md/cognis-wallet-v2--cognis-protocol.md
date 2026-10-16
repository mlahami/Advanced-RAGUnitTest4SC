# cognis-wallet-v2--cognis-protocol

- domain: multisig-treasury (treasury)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/cognis-protocol/cognis-contracts @ b979bc804bbf69d625b69eddb15bf1bd54c50b5a
- license: Apache-2.0
- targets: CognisWalletV2.sol, CognisTokenV2.sol
- validation: 19 passing tests, 0 failing; statement coverage CognisWalletV2.sol 100.0 %, CognisTokenV2.sol 100.0 %

## Contract: CognisTokenV2.sol (dependency)

```solidity
// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/**
 * @title CognisTokenV2 ($CGOX)
 * @notice Plain, non-upgradeable, ownerless ERC-20 for the Cognis Protocol network.
 *
 * Design rules (v2), deliberately boring:
 *  - Fixed supply. The entire MAX_SUPPLY is minted once, in the constructor.
 *    There is no `mint` function; total supply can only ever go down (via burn).
 *  - No fee on transfer, no burn on transfer, no rebase, no reflection.
 *    `transfer(x)` moves exactly `x`. v1 charged 1% on every transfer, which
 *    silently broke escrow accounting and is incompatible with most AMMs and
 *    aggregators. That behaviour is removed here; the 1% burn + 1% treasury fee
 *    now lives in the settlement layer (CognisTribunalV2) where it is explicit.
 *  - No pause, no blacklist, no allowlist, no transfer hooks, no proxy.
 *  - `burn` / `burnFrom` are inherited from ERC20Burnable and are open to every
 *    holder. CognisTribunalV2 uses `burn` to destroy the protocol fee.
 *  - `permit` (EIP-2612) is supported so agents can approve without holding ETH.
 *
 * Ownership: there is none. The contract inherits no access-control module, has
 * no `owner`, no admin function and no privileged address of any kind. Once
 * deployed its behaviour is fixed forever: nobody can mint, pause, freeze,
 * blacklist, upgrade, rescue or otherwise touch anyone's balance. Any future
 * extension has to be a separate contract that holders opt into by approving it.
 *
 * Distribution (minted at deployment, no lockup logic inside the token):
 *   55%  Network Growth Reserve      -> multi-sig
 *   25%  Liquidity & Operations      -> multi-sig
 *   20%  Founder                     -> CognisFounderVesting (linear vesting)
 *
 * This is a utility token for a peer-to-peer agent network. It is not a share,
 * it carries no claim on anyone's assets or revenue, and no return of any kind
 * is offered or implied.
 */
contract CognisTokenV2 is ERC20, ERC20Burnable, ERC20Permit {
    /// @notice Total supply minted at deployment. Never increases.
    uint256 public constant MAX_SUPPLY = 1_000_000_000e18;

    /// @notice 55% of MAX_SUPPLY.
    uint256 public constant RESERVE_ALLOCATION = 550_000_000e18;
    /// @notice 25% of MAX_SUPPLY.
    uint256 public constant OPERATIONS_ALLOCATION = 250_000_000e18;
    /// @notice 20% of MAX_SUPPLY. RESERVE + OPERATIONS + FOUNDER == MAX_SUPPLY.
    uint256 public constant FOUNDER_ALLOCATION = 200_000_000e18;

    /// @notice Network Growth Reserve holder recorded at deployment (informational).
    address public immutable reserve;
    /// @notice Liquidity & Operations holder recorded at deployment (informational).
    address public immutable operations;
    /// @notice Founder vesting contract recorded at deployment (informational).
    address public immutable founderVesting;

    error ZeroAddress();
    error DuplicateAllocationTarget();

    event AllocationMinted(
        address indexed reserve,
        address indexed operations,
        address indexed founderVesting,
        uint256 reserveAmount,
        uint256 operationsAmount,
        uint256 founderAmount
    );

    /**
     * @param reserve_        Network Growth Reserve recipient (multi-sig).
     * @param operations_     Liquidity & Operations recipient (multi-sig).
     * @param founderVesting_ Founder vesting contract (see CognisFounderVesting).
     */
    constructor(address reserve_, address operations_, address founderVesting_)
        ERC20("Cognis Protocol", "CGOX")
        ERC20Permit("Cognis Protocol")
    {
        if (reserve_ == address(0) || operations_ == address(0) || founderVesting_ == address(0)) {
            revert ZeroAddress();
        }
        if (reserve_ == operations_ || reserve_ == founderVesting_ || operations_ == founderVesting_) {
            revert DuplicateAllocationTarget();
        }

        reserve = reserve_;
        operations = operations_;
        founderVesting = founderVesting_;

        // The three constants are literals that sum to exactly MAX_SUPPLY,
        // so the whole supply exists after these three mints and never changes.
        _mint(reserve_, RESERVE_ALLOCATION);
        _mint(operations_, OPERATIONS_ALLOCATION);
        _mint(founderVesting_, FOUNDER_ALLOCATION);

        emit AllocationMinted(
            reserve_, operations_, founderVesting_, RESERVE_ALLOCATION, OPERATIONS_ALLOCATION, FOUNDER_ALLOCATION
        );
    }
}
```

## Contract: CognisWalletV2.sol (primary target)

```solidity
// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title CognisWalletV2
 * @notice Spending wallet for an autonomous agent (the owner's "digital twin").
 *
 * The agent spends $CGOX on its own up to a rolling daily limit. Anything above
 * the limit needs an explicit approval from the owner, which is the on-chain
 * half of a human-in-the-loop confirmation in the client.
 *
 * The limit logic is unchanged from v1. What changed:
 *   - transfers go through {SafeERC20}, so tokens that return no value or
 *     return false are handled correctly instead of silently succeeding;
 *   - ownership is {Ownable2Step}, so a typo in a hand-over cannot brick the
 *     wallet, and the owner is set explicitly at deployment instead of being
 *     whoever sent the deployment transaction;
 *   - every state change emits an event (including owner withdrawals), and
 *     approvals can be revoked;
 *   - reverts use custom errors.
 *
 * Over-limit approvals (v2 hardening). v1 keyed an approval by
 * `keccak256(to, amount)` alone and stored it as a boolean with no expiry. Two
 * consequences: an approval the owner forgot about stayed armed indefinitely,
 * and re-approving the same pair was indistinguishable from the first approval,
 * so a stale confirmation could authorise a much later payment. Here every
 * approval gets its own `nonce` (part of the key) and expires after
 * {APPROVAL_VALIDITY}. It is consumed on first use through
 * {agentSpendApproved}, which names the nonce explicitly, so an approval can
 * never be reused, guessed or confused with another one.
 *
 * Note on the daily window: `dayStart` is reset to the timestamp of the first
 * spend after 24h have elapsed, so the window rolls with usage rather than
 * being aligned to calendar days. This matches v1 behaviour exactly.
 */
contract CognisWalletV2 is Ownable2Step {
    using SafeERC20 for IERC20;

    /// @notice How long an over-limit approval stays usable after it is issued.
    uint256 public constant APPROVAL_VALIDITY = 1 hours;

    /// @notice Asset the agent is allowed to spend.
    IERC20 public immutable token;

    /// @notice Address the digital twin signs with.
    address public agent;
    /// @notice Amount the agent may spend per 24h window without approval.
    uint256 public dailyLimit;
    /// @notice Amount already spent inside the current window.
    uint256 public spentToday;
    /// @notice Start of the current 24h window.
    uint256 public dayStart;
    /// @notice Number of over-limit approvals ever issued; the last one's nonce.
    uint256 public approvalNonce;

    /// @notice Expiry of a single-use owner approval: keccak256(to, amount, nonce) => unix time (0 = none).
    mapping(bytes32 approvalKey => uint256 expiresAt) public approvedOverLimit;

    error ZeroAddress();
    error InvalidAmount();
    error NotAuthorized();
    error OverDailyLimit();
    error UnknownApproval();
    error ApprovalExpired();

    event AgentSpent(address indexed to, uint256 amount, bool overLimit);
    event AgentChanged(address indexed previousAgent, address indexed newAgent);
    event LimitChanged(uint256 previousLimit, uint256 newLimit);
    event OverLimitApproved(
        bytes32 indexed approvalKey, address indexed to, uint256 amount, uint256 nonce, uint256 expiresAt
    );
    event OverLimitRevoked(bytes32 indexed approvalKey, address indexed to, uint256 amount, uint256 nonce);
    event OverLimitConsumed(bytes32 indexed approvalKey, address indexed to, uint256 amount, uint256 nonce);
    event OwnerWithdrawal(address indexed to, uint256 amount);

    constructor(address token_, address agent_, uint256 dailyLimit_, address initialOwner) Ownable(initialOwner) {
        if (token_ == address(0) || agent_ == address(0) || initialOwner == address(0)) revert ZeroAddress();
        token = IERC20(token_);
        agent = agent_;
        dailyLimit = dailyLimit_;
        dayStart = block.timestamp;

        emit AgentChanged(address(0), agent_);
        emit LimitChanged(0, dailyLimit_);
    }

    modifier onlyAgentOrOwner() {
        if (msg.sender != agent && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    /// @notice Key used to record and look up one over-limit approval.
    function approvalKey(address to, uint256 amount, uint256 nonce) public pure returns (bytes32) {
        return keccak256(abi.encode(to, amount, nonce));
    }

    function setDailyLimit(uint256 newLimit) external onlyOwner {
        emit LimitChanged(dailyLimit, newLimit);
        dailyLimit = newLimit;
    }

    function setAgent(address newAgent) external onlyOwner {
        if (newAgent == address(0)) revert ZeroAddress();
        emit AgentChanged(agent, newAgent);
        agent = newAgent;
    }

    /**
     * @notice Approve one spend above the daily limit.
     * @dev Consumed on first use and valid for {APPROVAL_VALIDITY}. The returned
     *      nonce is also readable as {approvalNonce} and is carried by the
     *      {OverLimitApproved} event; the agent must quote it in
     *      {agentSpendApproved}.
     */
    function approveOverLimit(address to, uint256 amount)
        external
        onlyOwner
        returns (bytes32 key, uint256 nonce, uint256 expiresAt)
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        nonce = ++approvalNonce;
        expiresAt = block.timestamp + APPROVAL_VALIDITY;
        key = approvalKey(to, amount, nonce);
        approvedOverLimit[key] = expiresAt;

        emit OverLimitApproved(key, to, amount, nonce, expiresAt);
    }

    /// @notice Withdraw an unused over-limit approval before it is spent.
    function revokeOverLimit(address to, uint256 amount, uint256 nonce) external onlyOwner {
        bytes32 key = approvalKey(to, amount, nonce);
        if (approvedOverLimit[key] == 0) revert UnknownApproval();
        delete approvedOverLimit[key];
        emit OverLimitRevoked(key, to, amount, nonce);
    }

    /**
     * @notice Autonomous spend by the agent, inside the daily limit.
     * @dev Unattended. Anything that does not fit in the remaining allowance is
     *      rejected; use {agentSpendApproved} with an owner approval instead.
     */
    function agentSpend(address to, uint256 amount) external onlyAgentOrOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        _rollDay();
        if (spentToday + amount > dailyLimit) revert OverDailyLimit();

        _spend(to, amount, false);
    }

    /**
     * @notice Spend against a specific owner approval, above the daily limit.
     * @dev The approval is single use and expires; the amount still counts
     *      towards the day's total so it cannot be used to reset the window.
     */
    function agentSpendApproved(address to, uint256 amount, uint256 nonce) external onlyAgentOrOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        bytes32 key = approvalKey(to, amount, nonce);
        uint256 expiresAt = approvedOverLimit[key];
        if (expiresAt == 0) revert UnknownApproval();
        if (block.timestamp > expiresAt) revert ApprovalExpired();
        delete approvedOverLimit[key]; // single use

        _rollDay();
        _spend(to, amount, true);

        emit OverLimitConsumed(key, to, amount, nonce);
    }

    /// @notice The owner can always move funds out, with no limit.
    function ownerWithdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, amount);
        emit OwnerWithdrawal(to, amount);
    }

    /// @notice How much the agent may still spend unattended in this window.
    function remainingToday() external view returns (uint256) {
        if (block.timestamp >= dayStart + 1 days) return dailyLimit;
        return spentToday >= dailyLimit ? 0 : dailyLimit - spentToday;
    }

    /// @notice Seconds left on an approval, or 0 if it is unknown, spent or expired.
    function approvalTimeLeft(address to, uint256 amount, uint256 nonce) external view returns (uint256) {
        uint256 expiresAt = approvedOverLimit[approvalKey(to, amount, nonce)];
        if (expiresAt <= block.timestamp) return 0;
        return expiresAt - block.timestamp;
    }

    function _spend(address to, uint256 amount, bool overLimit) private {
        spentToday += amount;
        token.safeTransfer(to, amount);
        emit AgentSpent(to, amount, overLimit);
    }

    function _rollDay() private {
        if (block.timestamp >= dayStart + 1 days) {
            dayStart = block.timestamp;
            spentToday = 0;
        }
    }
}
```

## Tests: CognisWalletV2.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const LIMIT = ethers.parseEther("50");
const FUNDING = ethers.parseEther("1000");
const HOUR = 60 * 60;

async function deployWalletFixture() {
  const [deployer, owner, agent, payee, outsider, ops, founder] = await ethers.getSigners();

  const token = await (await ethers.getContractFactory("CognisTokenV2")).deploy(
    deployer.address,
    ops.address,
    founder.address
  );
  const wallet = await (await ethers.getContractFactory("CognisWalletV2")).deploy(
    await token.getAddress(),
    agent.address,
    LIMIT,
    owner.address
  );

  await token.connect(deployer).transfer(await wallet.getAddress(), FUNDING);
  return { token, wallet, deployer, owner, agent, payee, outsider };
}

/** Issues an over-limit approval and returns the nonce it was given. */
async function approve(wallet, owner, to, amount) {
  await wallet.connect(owner).approveOverLimit(to, amount);
  return wallet.approvalNonce();
}

describe("CognisWalletV2", function () {
  describe("deployment", function () {
    it("stores the configuration and sets the owner explicitly", async function () {
      const { wallet, token, owner, agent } = await loadFixture(deployWalletFixture);
      expect(await wallet.token()).to.equal(await token.getAddress());
      expect(await wallet.agent()).to.equal(agent.address);
      expect(await wallet.dailyLimit()).to.equal(LIMIT);
      expect(await wallet.owner()).to.equal(owner.address);
      expect(await wallet.spentToday()).to.equal(0n);
      expect(await wallet.remainingToday()).to.equal(LIMIT);
      expect(await wallet.approvalNonce()).to.equal(0n);
      expect(await wallet.APPROVAL_VALIDITY()).to.equal(BigInt(HOUR));
    });

    it("rejects zero addresses", async function () {
      const { wallet, token, agent, owner } = await loadFixture(deployWalletFixture);
      const factory = await ethers.getContractFactory("CognisWalletV2");
      await expect(
        factory.deploy(ethers.ZeroAddress, agent.address, LIMIT, owner.address)
      ).to.be.revertedWithCustomError(wallet, "ZeroAddress");
      await expect(
        factory.deploy(await token.getAddress(), ethers.ZeroAddress, LIMIT, owner.address)
      ).to.be.revertedWithCustomError(wallet, "ZeroAddress");
    });
  });

  describe("daily limit", function () {
    it("lets the agent spend inside the limit", async function () {
      const { wallet, token, agent, payee } = await loadFixture(deployWalletFixture);
      const amount = ethers.parseEther("30");

      await expect(wallet.connect(agent).agentSpend(payee.address, amount))
        .to.emit(wallet, "AgentSpent")
        .withArgs(payee.address, amount, false);

      expect(await token.balanceOf(payee.address)).to.equal(amount);
      expect(await wallet.spentToday()).to.equal(amount);
      expect(await wallet.remainingToday()).to.equal(LIMIT - amount);
    });

    it("reverts above the limit without an owner approval", async function () {
      const { wallet, agent, payee } = await loadFixture(deployWalletFixture);
      await wallet.connect(agent).agentSpend(payee.address, ethers.parseEther("40"));
      await expect(
        wallet.connect(agent).agentSpend(payee.address, ethers.parseEther("20"))
      ).to.be.revertedWithCustomError(wallet, "OverDailyLimit");
    });

    it("resets the counter after 24 hours", async function () {
      const { wallet, agent, payee } = await loadFixture(deployWalletFixture);
      await wallet.connect(agent).agentSpend(payee.address, ethers.parseEther("45"));

      await time.increase(24 * 60 * 60 + 1);
      expect(await wallet.remainingToday()).to.equal(LIMIT);

      await wallet.connect(agent).agentSpend(payee.address, ethers.parseEther("30"));
      expect(await wallet.spentToday()).to.equal(ethers.parseEther("30"));
    });
  });

  describe("over-limit approvals (nonce + expiry)", function () {
    it("accepts an over-limit spend once, against its own nonce", async function () {
      const { wallet, token, owner, agent, payee } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("20");

      await wallet.connect(agent).agentSpend(payee.address, ethers.parseEther("40"));

      const tx = wallet.connect(owner).approveOverLimit(payee.address, big);
      await expect(tx).to.emit(wallet, "OverLimitApproved");
      const nonce = await wallet.approvalNonce();
      expect(nonce).to.equal(1n);
      expect(await wallet.approvedOverLimit(await wallet.approvalKey(payee.address, big, nonce))).to.be.greaterThan(0n);
      expect(await wallet.approvalTimeLeft(payee.address, big, nonce)).to.be.greaterThan(0n);

      await expect(wallet.connect(agent).agentSpendApproved(payee.address, big, nonce))
        .to.emit(wallet, "AgentSpent")
        .withArgs(payee.address, big, true);

      expect(await token.balanceOf(payee.address)).to.equal(ethers.parseEther("60"));
      expect(await wallet.spentToday()).to.equal(ethers.parseEther("60"));
    });

    it("cannot be replayed: the approval is consumed on first use", async function () {
      const { wallet, owner, agent, payee } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("60");
      const nonce = await approve(wallet, owner, payee.address, big);

      await wallet.connect(agent).agentSpendApproved(payee.address, big, nonce);
      expect(await wallet.approvedOverLimit(await wallet.approvalKey(payee.address, big, nonce))).to.equal(0n);
      expect(await wallet.approvalTimeLeft(payee.address, big, nonce)).to.equal(0n);

      await expect(
        wallet.connect(agent).agentSpendApproved(payee.address, big, nonce)
      ).to.be.revertedWithCustomError(wallet, "UnknownApproval");
    });

    it("expires one hour after it was issued", async function () {
      const { wallet, owner, agent, payee } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("60");
      const nonce = await approve(wallet, owner, payee.address, big);

      await time.increase(HOUR + 1);
      expect(await wallet.approvalTimeLeft(payee.address, big, nonce)).to.equal(0n);
      await expect(
        wallet.connect(agent).agentSpendApproved(payee.address, big, nonce)
      ).to.be.revertedWithCustomError(wallet, "ApprovalExpired");
    });

    it("is still usable just before it expires", async function () {
      const { wallet, owner, agent, payee } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("60");
      const nonce = await approve(wallet, owner, payee.address, big);

      await time.increase(HOUR - 60);
      await expect(wallet.connect(agent).agentSpendApproved(payee.address, big, nonce)).to.emit(wallet, "AgentSpent");
    });

    it("gives every approval a fresh nonce, so an old one cannot stand in for a new one", async function () {
      const { wallet, owner, agent, payee } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("60");

      const first = await approve(wallet, owner, payee.address, big);
      const second = await approve(wallet, owner, payee.address, big);
      expect(second).to.equal(first + 1n);

      await wallet.connect(agent).agentSpendApproved(payee.address, big, first);
      await wallet.connect(agent).agentSpendApproved(payee.address, big, second);
      await expect(
        wallet.connect(agent).agentSpendApproved(payee.address, big, second + 1n)
      ).to.be.revertedWithCustomError(wallet, "UnknownApproval");
    });

    it("matches the approval to the exact recipient, amount and nonce", async function () {
      const { wallet, owner, agent, payee, outsider } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("60");
      const nonce = await approve(wallet, owner, payee.address, big);

      for (const call of [
        () => wallet.connect(agent).agentSpendApproved(outsider.address, big, nonce),
        () => wallet.connect(agent).agentSpendApproved(payee.address, big + 1n, nonce),
        () => wallet.connect(agent).agentSpendApproved(payee.address, big, nonce + 1n)
      ]) {
        await expect(call()).to.be.revertedWithCustomError(wallet, "UnknownApproval");
      }

      expect(await wallet.approvedOverLimit(await wallet.approvalKey(payee.address, big, nonce))).to.be.greaterThan(0n);
    });

    it("does not let the unattended path spend an approval", async function () {
      const { wallet, owner, agent, payee } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("60");
      await approve(wallet, owner, payee.address, big);

      await expect(wallet.connect(agent).agentSpend(payee.address, big)).to.be.revertedWithCustomError(
        wallet,
        "OverDailyLimit"
      );
    });

    it("lets the owner revoke an unused approval", async function () {
      const { wallet, owner, agent, payee } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("60");
      const nonce = await approve(wallet, owner, payee.address, big);

      await expect(wallet.connect(owner).revokeOverLimit(payee.address, big, nonce)).to.emit(
        wallet,
        "OverLimitRevoked"
      );
      await expect(
        wallet.connect(agent).agentSpendApproved(payee.address, big, nonce)
      ).to.be.revertedWithCustomError(wallet, "UnknownApproval");
      await expect(
        wallet.connect(owner).revokeOverLimit(payee.address, big, nonce)
      ).to.be.revertedWithCustomError(wallet, "UnknownApproval");
    });

    it("counts an over-limit spend towards the same daily window", async function () {
      const { wallet, owner, agent, payee } = await loadFixture(deployWalletFixture);
      const big = ethers.parseEther("60");
      const nonce = await approve(wallet, owner, payee.address, big);

      await wallet.connect(agent).agentSpendApproved(payee.address, big, nonce);
      expect(await wallet.spentToday()).to.equal(big);
      expect(await wallet.remainingToday()).to.equal(0n);
    });
  });

  describe("access control", function () {
    it("blocks strangers and bad parameters", async function () {
      const { wallet, agent, payee, outsider } = await loadFixture(deployWalletFixture);
      await expect(
        wallet.connect(outsider).agentSpend(payee.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(wallet, "NotAuthorized");
      await expect(
        wallet.connect(outsider).agentSpendApproved(payee.address, ethers.parseEther("1"), 1n)
      ).to.be.revertedWithCustomError(wallet, "NotAuthorized");
      await expect(wallet.connect(agent).agentSpend(ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(
        wallet,
        "ZeroAddress"
      );
      await expect(wallet.connect(agent).agentSpend(payee.address, 0)).to.be.revertedWithCustomError(
        wallet,
        "InvalidAmount"
      );
      await expect(
        wallet.connect(agent).agentSpendApproved(ethers.ZeroAddress, 1n, 1n)
      ).to.be.revertedWithCustomError(wallet, "ZeroAddress");
      await expect(wallet.connect(agent).agentSpendApproved(payee.address, 0, 1n)).to.be.revertedWithCustomError(
        wallet,
        "InvalidAmount"
      );
    });

    it("lets the owner spend through the same entry point", async function () {
      const { wallet, token, owner, payee } = await loadFixture(deployWalletFixture);
      await wallet.connect(owner).agentSpend(payee.address, ethers.parseEther("10"));
      expect(await token.balanceOf(payee.address)).to.equal(ethers.parseEther("10"));
    });

    it("lets the owner withdraw without any limit and logs it", async function () {
      const { wallet, token, owner, outsider, payee } = await loadFixture(deployWalletFixture);
      await expect(wallet.connect(owner).ownerWithdraw(payee.address, FUNDING))
        .to.emit(wallet, "OwnerWithdrawal")
        .withArgs(payee.address, FUNDING);
      expect(await token.balanceOf(payee.address)).to.equal(FUNDING);

      await expect(wallet.connect(outsider).ownerWithdraw(outsider.address, 1n)).to.be.revertedWithCustomError(
        wallet,
        "OwnableUnauthorizedAccount"
      );
    });

    it("keeps agent, limit and approval changes to the owner", async function () {
      const { wallet, owner, agent, outsider } = await loadFixture(deployWalletFixture);

      await expect(wallet.connect(outsider).setAgent(outsider.address)).to.be.revertedWithCustomError(
        wallet,
        "OwnableUnauthorizedAccount"
      );
      await expect(wallet.connect(outsider).setDailyLimit(1n)).to.be.revertedWithCustomError(
        wallet,
        "OwnableUnauthorizedAccount"
      );
      await expect(wallet.connect(outsider).approveOverLimit(outsider.address, 1n)).to.be.revertedWithCustomError(
        wallet,
        "OwnableUnauthorizedAccount"
      );
      await expect(wallet.connect(outsider).revokeOverLimit(outsider.address, 1n, 1n)).to.be.revertedWithCustomError(
        wallet,
        "OwnableUnauthorizedAccount"
      );

      await expect(wallet.connect(owner).setAgent(outsider.address))
        .to.emit(wallet, "AgentChanged")
        .withArgs(agent.address, outsider.address);
      await expect(wallet.connect(owner).setDailyLimit(ethers.parseEther("5")))
        .to.emit(wallet, "LimitChanged")
        .withArgs(LIMIT, ethers.parseEther("5"));

      expect(await wallet.agent()).to.equal(outsider.address);
      expect(await wallet.dailyLimit()).to.equal(ethers.parseEther("5"));
    });

    it("hands ownership over in two steps", async function () {
      const { wallet, owner, outsider } = await loadFixture(deployWalletFixture);
      await wallet.connect(owner).transferOwnership(outsider.address);
      expect(await wallet.owner()).to.equal(owner.address);
      await wallet.connect(outsider).acceptOwnership();
      expect(await wallet.owner()).to.equal(outsider.address);
    });
  });
});
```
