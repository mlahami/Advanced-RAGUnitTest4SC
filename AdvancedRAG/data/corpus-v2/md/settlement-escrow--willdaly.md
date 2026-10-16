# settlement-escrow--willdaly

- domain: escrow-conditional-payments (escrow)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/willdaly/agentpay @ 6fa8efac36c616b657328ae5ac614aad8e52e411
- license: MIT
- targets: SettlementEscrow.sol, AgentPayToken.sol
- validation: 15 passing tests, 0 failing; statement coverage SettlementEscrow.sol 100.0 %, AgentPayToken.sol 50.0 %

## Contract: AgentPayToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/// @title AgentPayToken (APT)
/// @notice The single ERC-20 of the AgentPay platform. Testnet only; valueless.
/// @dev Triple duty:
///      1. Governance voting weight via {ERC20Votes} (checkpointed balances +
///         delegation) — consumed by `PolicyGovernor`.
///      2. Provider staking collateral — consumed by `ProviderStaking`.
///      3. The unit AI agents spend for services — moved by `AgentWallet`.
///      Fixed supply is minted to the deployer at construction for demo
///      distribution. There is NO open mint; the only post-deploy minting is
///      {faucet}, which is explicitly a demo convenience (see its NatSpec) and
///      would be removed for any non-testnet deployment.
contract AgentPayToken is ERC20, ERC20Permit, ERC20Votes {
    /// @notice Per-call cap on the demo faucet, in wei (18 decimals).
    uint256 public constant FAUCET_AMOUNT = 1_000 ether;

    /// @param initialSupply Fixed supply (wei) minted to `initialHolder`.
    /// @param initialHolder Recipient of the initial supply (the deployer/treasury).
    constructor(uint256 initialSupply, address initialHolder)
        ERC20("AgentPay Token", "APT")
        ERC20Permit("AgentPay Token")
    {
        _mint(initialHolder, initialSupply);
    }

    /// @notice DEMO ONLY. Mints {FAUCET_AMOUNT} APT to the caller so testnet
    ///         demo participants (agents, providers) can self-fund without the
    ///         deployer distributing manually.
    /// @dev This function breaks the fixed-supply invariant and MUST be removed
    ///      before any deployment that is not a valueless testnet demo. It is
    ///      documented as a deliberate, disclosed testnet affordance.
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    // --- Required multiple-inheritance overrides (ERC20Votes + Nonces) ---

    /// @inheritdoc ERC20
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    /// @inheritdoc Nonces
    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
```

## Contract: IPolicyParameters.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IPolicyParameters
/// @notice Live, on-chain global risk parameters for the AgentPay control plane.
/// @dev THE ARCHITECTURAL CENTERPIECE. Consumer contracts (e.g. {AgentWallet},
///      {ProviderStaking}) hold a reference to a single `IPolicyParameters`
///      implementation and read these values *at transaction time* — never
///      caching them. The implementation is `PolicyGovernor`, a token-weighted
///      DAO whose passed proposals mutate these values in place. The effect: a
///      governance vote changes system-wide behavior with NO redeploy and NO
///      migration. This governance boundary is inherited from the Module 7
///      midterm's `MarketplaceGovernor` pattern and is the property the
///      governance lifecycle test asserts.
interface IPolicyParameters {
    /// @notice Maximum USD value (8-decimal fixed point, matching Chainlink
    ///         USD feeds) permitted for any single agent spend, globally.
    function maxPerTxUsd() external view returns (uint256);

    /// @notice Default rolling daily budget in USD (8-decimal fixed point)
    ///         applied to an agent wallet that has not set a stricter local one.
    function defaultDailyBudgetUsd() external view returns (uint256);

    /// @notice Slashing penalty in basis points (1e4 = 100%) applied to a
    ///         provider's stake on a successful governance slash.
    function slashBps() external view returns (uint256);

    /// @notice Seconds a staked amount remains locked after an unstake request,
    ///         and the settlement dispute window length. One value, two uses.
    function disputeWindow() external view returns (uint256);

    /// @notice Destination for slashed collateral and protocol fees.
    function treasury() external view returns (address);

    /// @notice Minimum APT (in wei, 18 decimals) a provider must have staked
    ///         for its services to be spendable against.
    function providerMinStake() external view returns (uint256);

    /// @notice Emergency system-wide stop. When true, all agent spends revert.
    function globalPause() external view returns (bool);
}
```

## Contract: ISettlementEscrow.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ISettlementEscrow
/// @notice Sink AgentWallet pays into. Pull-over-push: a spend credits the
///         provider's balance here; the provider later withdraw()s. A provider
///         that reverts on receipt can never block an agent's spend.
/// @dev Concrete implementation (`SettlementEscrow`) arrives in M3. The wallet
///      transfers APT to the escrow and then calls {credit} to record the claim,
///      so the escrow's token balance and its internal ledger stay in lockstep.
interface ISettlementEscrow {
    /// @notice Record that `amount` APT (already transferred to this escrow) is
    ///         owed to `provider` for `serviceId`.
    /// @dev MUST be called only after the tokens have been transferred in, and
    ///      only by an authorized payer (an AgentWallet from the known factory).
    function credit(address provider, uint256 serviceId, uint256 amount) external;
}
```

## Contract: IWalletAuthorizer.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IWalletAuthorizer
/// @notice Minimal provenance oracle: answers "did I create this wallet?". The
///         settlement escrow uses it to accept `credit` calls only from genuine
///         {AgentWallet}s, never from arbitrary addresses.
/// @dev {AgentWalletFactory} implements this via its `isWallet` mapping.
interface IWalletAuthorizer {
    function isWallet(address account) external view returns (bool);
}
```

## Contract: MockPolicyParameters.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IPolicyParameters} from "./IPolicyParameters.sol";

/// @notice Test double for the live governance parameter store. Every parameter
///         is independently settable so tests can drive each policy path. The
///         real implementation is `PolicyGovernor` (M4).
contract MockPolicyParameters is IPolicyParameters {
    uint256 public maxPerTxUsd;
    uint256 public defaultDailyBudgetUsd;
    uint256 public slashBps;
    uint256 public disputeWindow;
    address public treasury;
    uint256 public providerMinStake;
    bool public globalPause;

    constructor(
        uint256 _maxPerTxUsd,
        uint256 _defaultDailyBudgetUsd,
        uint256 _providerMinStake
    ) {
        maxPerTxUsd = _maxPerTxUsd;
        defaultDailyBudgetUsd = _defaultDailyBudgetUsd;
        providerMinStake = _providerMinStake;
        slashBps = 1000; // 10%
        disputeWindow = 1 days;
        treasury = msg.sender;
    }

    function setMaxPerTxUsd(uint256 v) external {
        maxPerTxUsd = v;
    }

    function setDefaultDailyBudgetUsd(uint256 v) external {
        defaultDailyBudgetUsd = v;
    }

    function setProviderMinStake(uint256 v) external {
        providerMinStake = v;
    }

    function setGlobalPause(bool v) external {
        globalPause = v;
    }

    function setTreasury(address v) external {
        treasury = v;
    }

    function setSlashBps(uint256 v) external {
        slashBps = v;
    }

    function setDisputeWindow(uint256 v) external {
        disputeWindow = v;
    }
}
```

## Contract: MockWalletAuthorizer.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IWalletAuthorizer} from "./IWalletAuthorizer.sol";

/// @notice Test double for wallet provenance. Lets escrow tests authorize an
///         arbitrary address (an EOA standing in for an AgentWallet) as a payer.
contract MockWalletAuthorizer is IWalletAuthorizer {
    mapping(address => bool) public authorized;

    function setWallet(address account, bool ok) external {
        authorized[account] = ok;
    }

    function isWallet(address account) external view returns (bool) {
        return authorized[account];
    }
}
```

## Contract: ReentrantAttacker.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ITokenReceiveHook} from "./ReentrantToken.sol";

interface IWithdrawable {
    function withdraw() external returns (uint256);
}

/// @notice Provider mock that attempts to re-enter SettlementEscrow.withdraw()
///         from a token-receive hook. The escrow's nonReentrant guard must make
///         the re-entrant call revert, so the whole withdraw reverts.
contract ReentrantAttacker is ITokenReceiveHook {
    IWithdrawable public immutable escrow;
    bool public reentered;

    constructor(IWithdrawable _escrow) {
        escrow = _escrow;
    }

    function attack() external {
        escrow.withdraw();
    }

    function onTokensReceived() external {
        // Re-enter exactly once; the guard should make this revert and bubble up.
        if (!reentered) {
            reentered = true;
            escrow.withdraw();
        }
    }
}
```

## Contract: ReentrantToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Hook target invoked by {ReentrantToken} on receipt of a transfer.
interface ITokenReceiveHook {
    function onTokensReceived() external;
}

/// @notice A malicious, ERC-777-style ERC-20 that calls a hook on a designated
///         recipient during every transfer TO that recipient. Used to prove the
///         SettlementEscrow's `withdraw` is safe against a reentrant token
///         callback: the recipient's hook tries to re-enter `withdraw`, and the
///         nonReentrant guard (plus checks-effects-interactions) blocks it.
///
///         Plain ERC-20s (like the real APT) have no such callback; this mock
///         exists only to exercise the guard under the worst case.
contract ReentrantToken is ERC20 {
    address public hookTarget;
    bool private _inHook;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Arm the hook: transfers to `target` will call its receive hook.
    function setHookTarget(address target) external {
        hookTarget = target;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (to == hookTarget && hookTarget != address(0) && !_inHook) {
            _inHook = true;
            ITokenReceiveHook(hookTarget).onTokensReceived();
            _inHook = false;
        }
    }
}
```

## Contract: RevertingReceiver.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice A hostile provider that reverts on any plain call or ETH transfer.
///         Used to prove that a spend still succeeds when the provider is
///         uncooperative — because pull-over-push settlement never calls the
///         provider during a spend (it only credits the escrow ledger).
contract RevertingReceiver {
    error Nope();

    fallback() external payable {
        revert Nope();
    }

    receive() external payable {
        revert Nope();
    }
}
```

## Contract: SettlementEscrow.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ISettlementEscrow} from "./ISettlementEscrow.sol";
import {IPolicyParameters} from "./IPolicyParameters.sol";
import {IWalletAuthorizer} from "./IWalletAuthorizer.sol";

/// @title SettlementEscrow
/// @notice Pull-over-push settlement sink for agent spends (lineage: the midterm
///         `ModelMarketplace` pull-payment flow). AgentWallet transfers APT here
///         and calls {credit}; providers later {withdraw}. A provider that would
///         revert on receipt can never block an agent's spend, because a spend
///         performs no call to the provider.
/// @dev Two settlement modes, selected by the LIVE `disputeWindow`:
///      - window == 0: the credit is immediately withdrawable (fast settlement).
///      - window  > 0: the credit becomes a time-locked {Payment} that anyone can
///        {release} once the window elapses. The delay gives governance a chance
///        to slash the provider's stake (in `ProviderStaking`) before funds are
///        withdrawable. Automated payment clawback / dispute arbitration is
///        deliberately out of scope; governance staking-slash is the recourse.
///
///      {withdraw} follows checks-effects-interactions and is `nonReentrant`.
///      Only wallets vouched for by the {IWalletAuthorizer} (the factory) may
///      {credit}, so the internal ledger cannot be inflated by arbitrary callers.
contract SettlementEscrow is ISettlementEscrow, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Payment {
        address provider;
        bool released;
        uint256 serviceId;
        address payer;
        uint256 amount;
        uint256 releaseAt;
    }

    IERC20 public immutable token; // APT
    IPolicyParameters public immutable policy; // live economic parameters

    /// @notice Vouches for genuine payers (the factory on the home chain; an
    ///         {AllowlistAuthorizer} naming the router on a remote chain).
    /// @dev Set exactly once by the owner right after deployment, then effectively
    ///      immutable. This is an initializer, not a live admin lever: it exists
    ///      because the escrow and its authorizer are mutually dependent at
    ///      construction, and a one-time setter breaks that cycle without
    ///      resorting to CREATE-address prediction.
    IWalletAuthorizer public authorizer;

    /// @notice Balance each provider can pull right now.
    mapping(address => uint256) public withdrawable;

    /// @notice Time-locked payments awaiting release, by id (from 1).
    mapping(uint256 => Payment) private _payments;

    /// @notice Number of time-locked payments ever created; highest valid id.
    uint256 public paymentCount;

    /// @notice Total APT this escrow owes (withdrawable + not-yet-released).
    ///         Invariant: token.balanceOf(this) >= totalOwed.
    uint256 public totalOwed;

    event PaymentSettled(
        address indexed provider, uint256 indexed serviceId, uint256 amount
    );
    event PaymentPending(
        uint256 indexed paymentId,
        address indexed provider,
        address indexed payer,
        uint256 serviceId,
        uint256 amount,
        uint256 releaseAt
    );
    event PaymentReleased(
        uint256 indexed paymentId, address indexed provider, uint256 amount
    );
    event Withdrawn(address indexed provider, uint256 amount);

    event AuthorizerSet(address indexed authorizer);

    error NotAuthorizedPayer(address caller);
    error ZeroAddress();
    error ZeroAmount();
    error UnknownPayment(uint256 paymentId);
    error AlreadyReleased(uint256 paymentId);
    error ReleaseNotReady(uint256 paymentId, uint256 releaseAt);
    error NothingToWithdraw();
    error AuthorizerAlreadySet();
    error AuthorizerNotSet();

    constructor(IERC20 _token, IPolicyParameters _policy, address _owner)
        Ownable(_owner)
    {
        if (address(_token) == address(0) || address(_policy) == address(0)) {
            revert ZeroAddress();
        }
        token = _token;
        policy = _policy;
    }

    /// @notice Set the payer authorizer. Callable once, by the owner, at deploy time.
    function setAuthorizer(IWalletAuthorizer _authorizer) external onlyOwner {
        if (address(_authorizer) == address(0)) revert ZeroAddress();
        if (address(authorizer) != address(0)) revert AuthorizerAlreadySet();
        authorizer = _authorizer;
        emit AuthorizerSet(address(_authorizer));
    }

    /// @inheritdoc ISettlementEscrow
    /// @dev Tokens MUST already have been transferred to this escrow by the caller
    ///      (the AgentWallet) before this call; only vouched payers may call.
    function credit(address provider, uint256 serviceId, uint256 amount) external {
        IWalletAuthorizer auth = authorizer;
        if (address(auth) == address(0)) revert AuthorizerNotSet();
        if (!auth.isWallet(msg.sender)) revert NotAuthorizedPayer(msg.sender);
        if (provider == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        totalOwed += amount;

        uint256 window = policy.disputeWindow();
        if (window == 0) {
            withdrawable[provider] += amount;
            emit PaymentSettled(provider, serviceId, amount);
            return;
        }

        uint256 releaseAt = block.timestamp + window;
        uint256 id = ++paymentCount;
        _payments[id] = Payment({
            provider: provider,
            released: false,
            serviceId: serviceId,
            payer: msg.sender,
            amount: amount,
            releaseAt: releaseAt
        });
        emit PaymentPending(id, provider, msg.sender, serviceId, amount, releaseAt);
    }

    /// @notice Release a time-locked payment once its window has elapsed.
    /// @dev Permissionless crank: anyone may trigger the release to the provider.
    function release(uint256 paymentId) external {
        Payment storage p = _payments[paymentId];
        if (p.amount == 0) revert UnknownPayment(paymentId);
        if (p.released) revert AlreadyReleased(paymentId);
        if (block.timestamp < p.releaseAt) revert ReleaseNotReady(paymentId, p.releaseAt);

        p.released = true;
        withdrawable[p.provider] += p.amount;

        emit PaymentReleased(paymentId, p.provider, p.amount);
    }

    /// @notice Pull all currently-withdrawable APT to the caller.
    function withdraw() external nonReentrant returns (uint256 amount) {
        amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        withdrawable[msg.sender] = 0;
        totalOwed -= amount;
        token.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    // --- Views ---

    /// @notice Full record of a time-locked payment.
    function getPayment(uint256 paymentId) external view returns (Payment memory) {
        if (_payments[paymentId].amount == 0) revert UnknownPayment(paymentId);
        return _payments[paymentId];
    }

    /// @notice True while the escrow holds at least what it owes (monitoring aid).
    function solvent() external view returns (bool) {
        return token.balanceOf(address(this)) >= totalOwed;
    }
}
```

## Tests: SettlementEscrow.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const apt = (n) => ethers.parseEther(n);
const WINDOW = 60n * 60n; // 1 hour dispute window

describe("SettlementEscrow", () => {
  // Base fixture: a mock authorizer so a plain signer can act as an AgentWallet.
  async function deployWith(disputeWindow) {
    const [deployer, owner, walletSigner, provider, stranger] =
      await ethers.getSigners();

    const Token = await ethers.getContractFactory("AgentPayToken");
    const token = await Token.deploy(apt("1000000"), deployer.address);

    const Policy = await ethers.getContractFactory("MockPolicyParameters");
    const policy = await Policy.deploy(0, 0, 0);
    await policy.setDisputeWindow(disputeWindow);

    const Auth = await ethers.getContractFactory("MockWalletAuthorizer");
    const authorizer = await Auth.deploy();
    await authorizer.setWallet(walletSigner.address, true);

    const Escrow = await ethers.getContractFactory("SettlementEscrow");
    const escrow = await Escrow.deploy(
      await token.getAddress(),
      await policy.getAddress(),
      owner.address,
    );
    await escrow.connect(owner).setAuthorizer(await authorizer.getAddress());

    // The "wallet" is funded; it transfers to escrow then credits (as AgentWallet does).
    await token.transfer(walletSigner.address, apt("1000"));

    return { token, policy, authorizer, escrow, deployer, owner, walletSigner, provider, stranger };
  }

  // Named fixtures (loadFixture rejects anonymous functions).
  function deployImmediate() {
    return deployWith(0n);
  }
  function deployWindowed() {
    return deployWith(WINDOW);
  }

  // Simulate a spend: wallet pushes tokens to escrow, then credits the provider.
  async function creditAs(
    f,
    provider,
    serviceId,
    amount,
  ) {
    await f.token
      .connect(f.walletSigner)
      .transfer(await f.escrow.getAddress(), amount);
    return f.escrow.connect(f.walletSigner).credit(provider, serviceId, amount);
  }

  describe("authorization", () => {
    it("rejects credit from a non-wallet", async () => {
      const f = await loadFixture(deployImmediate);
      await f.token.transfer(await f.escrow.getAddress(), apt("1"));
      await expect(
        f.escrow.connect(f.stranger).credit(f.provider.address, 1n, apt("1")),
      )
        .to.be.revertedWithCustomError(f.escrow, "NotAuthorizedPayer")
        .withArgs(f.stranger.address);
    });

    it("rejects zero provider or zero amount", async () => {
      const f = await loadFixture(deployImmediate);
      await expect(
        f.escrow.connect(f.walletSigner).credit(ethers.ZeroAddress, 1n, apt("1")),
      ).to.be.revertedWithCustomError(f.escrow, "ZeroAddress");
      await expect(
        f.escrow.connect(f.walletSigner).credit(f.provider.address, 1n, 0),
      ).to.be.revertedWithCustomError(f.escrow, "ZeroAmount");
    });

    const depNames = ["token", "policy"];
    depNames.forEach((name, depIndex) => {
      it(`reverts constructor when ${name} is zero`, async () => {
        const f = await loadFixture(deployImmediate);
        const deps = [
          await f.token.getAddress(),
          await f.policy.getAddress(),
        ];
        deps[depIndex] = ethers.ZeroAddress;
        const Escrow = await ethers.getContractFactory("SettlementEscrow");
        await expect(
          Escrow.deploy(deps[0], deps[1], f.owner.address),
        ).to.be.revertedWithCustomError(Escrow, "ZeroAddress");
      });
    });
  });

  describe("immediate settlement (window == 0)", () => {
    it("credits withdrawable straight away", async () => {
      const f = await loadFixture(deployImmediate);
      await expect(creditAs(f, f.provider.address, 7n, apt("5")))
        .to.emit(f.escrow, "PaymentSettled")
        .withArgs(f.provider.address, 7n, apt("5"));
      expect(await f.escrow.withdrawable(f.provider.address)).to.equal(apt("5"));
      expect(await f.escrow.totalOwed()).to.equal(apt("5"));
      expect(await f.escrow.solvent()).to.equal(true);
    });

    it("lets the provider pull funds and clears the ledger", async () => {
      const f = await loadFixture(deployImmediate);
      await creditAs(f, f.provider.address, 7n, apt("5"));
      await expect(f.escrow.connect(f.provider).withdraw())
        .to.emit(f.escrow, "Withdrawn")
        .withArgs(f.provider.address, apt("5"));
      expect(await f.escrow.withdrawable(f.provider.address)).to.equal(0n);
      expect(await f.escrow.totalOwed()).to.equal(0n);
    });

    it("reverts withdraw when there is nothing to pull", async () => {
      const f = await loadFixture(deployImmediate);
      await expect(
        f.escrow.connect(f.provider).withdraw(),
      ).to.be.revertedWithCustomError(f.escrow, "NothingToWithdraw");
    });

    it("aggregates multiple credits before withdrawal", async () => {
      const f = await loadFixture(deployImmediate);
      await creditAs(f, f.provider.address, 1n, apt("2"));
      await creditAs(f, f.provider.address, 2n, apt("3"));
      expect(await f.escrow.withdrawable(f.provider.address)).to.equal(apt("5"));
    });
  });

  describe("windowed settlement (window > 0)", () => {
    it("creates a pending payment, not immediately withdrawable", async () => {
      const f = await loadFixture(deployWindowed);
      const tx = await creditAs(f, f.provider.address, 9n, apt("4"));
      const releaseAt = BigInt(await time.latest()) + WINDOW;
      await expect(tx)
        .to.emit(f.escrow, "PaymentPending")
        .withArgs(1n, f.provider.address, f.walletSigner.address, 9n, apt("4"), releaseAt);
      expect(await f.escrow.withdrawable(f.provider.address)).to.equal(0n);
      expect(await f.escrow.paymentCount()).to.equal(1n);
      const p = await f.escrow.getPayment(1n);
      expect(p.amount).to.equal(apt("4"));
      expect(p.released).to.equal(false);
    });

    it("cannot be released before the window elapses", async () => {
      const f = await loadFixture(deployWindowed);
      await creditAs(f, f.provider.address, 9n, apt("4"));
      await expect(
        f.escrow.release(1n),
      ).to.be.revertedWithCustomError(f.escrow, "ReleaseNotReady");
    });

    it("releases to withdrawable after the window (permissionless crank)", async () => {
      const f = await loadFixture(deployWindowed);
      await creditAs(f, f.provider.address, 9n, apt("4"));
      await time.increase(WINDOW);
      await expect(f.escrow.connect(f.stranger).release(1n))
        .to.emit(f.escrow, "PaymentReleased")
        .withArgs(1n, f.provider.address, apt("4"));
      expect(await f.escrow.withdrawable(f.provider.address)).to.equal(apt("4"));
      await expect(f.escrow.connect(f.provider).withdraw()).to.changeTokenBalance(
        f.token,
        f.provider,
        apt("4"),
      );
    });

    it("cannot double-release", async () => {
      const f = await loadFixture(deployWindowed);
      await creditAs(f, f.provider.address, 9n, apt("4"));
      await time.increase(WINDOW);
      await f.escrow.release(1n);
      await expect(
        f.escrow.release(1n),
      ).to.be.revertedWithCustomError(f.escrow, "AlreadyReleased");
    });

    it("reverts release / getPayment for an unknown id", async () => {
      const f = await loadFixture(deployWindowed);
      await expect(
        f.escrow.release(99n),
      ).to.be.revertedWithCustomError(f.escrow, "UnknownPayment");
      await expect(
        f.escrow.getPayment(99n),
      ).to.be.revertedWithCustomError(f.escrow, "UnknownPayment");
    });
  });

  describe("pull-over-push safety", () => {
    it("a spend credit to a hostile (reverting) provider still succeeds", async () => {
      const f = await loadFixture(deployImmediate);
      const Reverting = await ethers.getContractFactory("RevertingReceiver");
      const hostile = await Reverting.deploy();
      // Crediting never calls the provider, so the reverting fallback is irrelevant.
      await expect(
        creditAs(f, await hostile.getAddress(), 1n, apt("5")),
      ).to.emit(f.escrow, "PaymentSettled");
      expect(await f.escrow.withdrawable(await hostile.getAddress())).to.equal(
        apt("5"),
      );
    });

    it("blocks a reentrant withdraw via a malicious token callback", async () => {
      const [deployer, owner, walletSigner] = await ethers.getSigners();

      // Escrow denominated in a malicious ERC-777-style token.
      const RT = await ethers.getContractFactory("ReentrantToken");
      const token = await RT.deploy();
      const Policy = await ethers.getContractFactory("MockPolicyParameters");
      const policy = await Policy.deploy(0, 0, 0);
      await policy.setDisputeWindow(0); // immediate withdrawable, so withdraw actually transfers
      const Auth = await ethers.getContractFactory("MockWalletAuthorizer");
      const authorizer = await Auth.deploy();
      await authorizer.setWallet(walletSigner.address, true);
      const Escrow = await ethers.getContractFactory("SettlementEscrow");
      const escrow = await Escrow.deploy(
        await token.getAddress(),
        await policy.getAddress(),
        owner.address,
      );
      await escrow.connect(owner).setAuthorizer(await authorizer.getAddress());

      const Attacker = await ethers.getContractFactory("ReentrantAttacker");
      const attacker = await Attacker.deploy(await escrow.getAddress());

      // Fund escrow with extra tokens so a successful drain would be possible.
      await token.mint(await escrow.getAddress(), apt("100"));
      // Credit the attacker as provider (wallet pushed tokens are already there).
      await token.mint(walletSigner.address, apt("5"));
      await token
        .connect(walletSigner)
        .transfer(await escrow.getAddress(), apt("5"));
      await escrow
        .connect(walletSigner)
        .credit(await attacker.getAddress(), 1n, apt("5"));

      // Arm the token hook to fire on transfer to the attacker, then attack.
      await token.setHookTarget(await attacker.getAddress());
      const escrowBalBefore = await token.balanceOf(await escrow.getAddress());

      // The re-entrant withdraw is caught by the nonReentrant guard, so the whole
      // attack reverts and no funds leave the escrow. (checks-effects-interactions
      // ordering is a second line of defence.)
      await expect(attacker.attack()).to.be.revertedWithCustomError(
        escrow,
        "ReentrancyGuardReentrantCall",
      );
      expect(await token.balanceOf(await attacker.getAddress())).to.equal(0n);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(
        escrowBalBefore,
      );
      expect(await escrow.withdrawable(await attacker.getAddress())).to.equal(
        apt("5"),
      );
    });
  });
});
```
