# tollgate--ashnkumar

- domain: escrow-conditional-payments (payments)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/ashnkumar/tollgate @ 2c69a5e59970ff080d96698c5e70635df4eb4ab9
- license: MIT
- targets: Tollgate.sol, RejectsPayment.sol
- validation: 48 passing tests, 0 failing; statement coverage Tollgate.sol 100.0 %, RejectsPayment.sol 100.0 %

## Contract: RejectsPayment.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ITollgate {
    function openCall(bytes32 callId, bytes32 serviceId, uint32 inputTokens, bytes32 expectedTerms)
        external
        payable;
    function termsHash(bytes32 serviceId) external view returns (bytes32);
    function withdraw() external;
    function withdrawTo(address payable recipient) external;
}

/// @title A buyer that cannot be paid directly
/// @notice Test fixture. It has no `receive` and no payable fallback, so a plain native
///         transfer to it reverts — which is what a multisig, a timelock, or most
///         contracts look like from the paying side.
/// @dev Exists to prove that a balance credited to such an account is still reachable.
///      Tollgate lets a buyer, a provider or the treasury be a contract, so without
///      `withdrawTo` those balances would be correctly recorded and permanently stuck.
contract RejectsPayment {
    ITollgate private immutable tollgate;

    /// @dev Funded at construction, because it cannot be sent anything afterward.
    constructor(ITollgate tollgate_) payable {
        tollgate = tollgate_;
    }

    function open(bytes32 callId, bytes32 serviceId, uint32 inputTokens, uint256 value) external {
        tollgate.openCall{value: value}(callId, serviceId, inputTokens, tollgate.termsHash(serviceId));
    }

    function pull() external {
        tollgate.withdraw();
    }

    function pullTo(address payable recipient) external {
        tollgate.withdrawTo(recipient);
    }
}
```

## Contract: Tollgate.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title  Tollgate — a marketplace for AI services billed per call.
/// @notice A provider lists a service together with an on-chain *rate card*. A buyer
///         escrows the worst-case price for one call, the service runs, and the call
///         settles against actual usage. Whatever the buyer over-escrowed comes back.
///
/// @dev The design problem this contract exists to solve:
///
///      An AI call has variable cost (tokens in, tokens out) but a buyer wants a
///      price they agreed to *before* the call runs. Those two facts are reconciled
///      here by splitting price into two moments:
///
///        1. `quote()` — computed on-chain from the provider's published rate card and
///           the exact input size. Bounded above by `maxOutputTokens`, so it is the
///           worst case, not an estimate. The buyer escrows exactly this.
///        2. `settleCall()` — the settler reports the *token counts* it observed. The
///           price is recomputed here, from the rate card the call was funded under (a
///           copy frozen into the call, not the provider's live one). The settler never
///           names a price, so it cannot invent one, and `settle` reverts if the
///           computed cost exceeds what the buyer escrowed.
///
///      What the settler can still do is misreport usage, bounded by the escrow. That
///      is an honest limitation of metering off-chain work on-chain: nothing here can
///      verify a token count. What the contract does guarantee is that a buyer never
///      pays a wei more than the quote they approved, and can always `reclaimCall()`
///      if the settler simply disappears.
///
///      Two things are required to make that first guarantee literal rather than
///      approximate, and both were missing from an earlier version of this contract:
///
///        - The escrow is the quote, not whatever was sent. Accepting `msg.value` as the
///          escrow made an overfunded call settleable at the larger number, so the
///          ceiling a buyer could actually be charged to was their own transfer rather
///          than the price they agreed. The surplus is credited back immediately.
///        - The buyer commits to the *formula*, not only to the total. Rates live in
///          mutable storage, so a provider could change the rate card between the buyer
///          reading `quote()` and their `openCall` mining — keeping the same total for
///          that one input size while moving the cost of a short answer up to the cap.
///          `openCall` takes the hash of the terms the buyer priced against and reverts
///          if the live card no longer matches.
///
///      Refunds and earnings both accrue to `balances` rather than being pushed. For
///      per-call payments this matters: a push refund can cost more gas than it
///      returns. Pull-settlement also keeps `settleCall` free of external calls.
contract Tollgate {
    // ─────────────────────────────────────────── types ──

    struct Service {
        address provider; //          receives earnings
        uint32 maxOutputTokens; //    hard ceiling on one call's output; bounds the quote
        bool active;
        address settler; //           may settle calls for this service (the provider's server)
        uint128 baseFeeWei; //        charged per call regardless of size
        uint128 perInputTokenWei;
        uint128 perOutputTokenWei;
    }

    /// @dev A call carries its own copy of the terms it was funded under.
    ///
    ///      Reading them back off the live `Service` at settlement time looks equivalent
    ///      and is not: the provider can edit a service while a call is in flight. Raising
    ///      the rates then makes settlement exceed the escrow, lowering `maxOutputTokens`
    ///      makes the real output unreportable, and changing `settler` locks out the
    ///      machine that actually did the work. In each case the escrow still protects the
    ///      buyer from being overcharged, but the call becomes impossible to settle — the
    ///      buyer's funds sit until `CALL_TIMEOUT` and the provider earns nothing.
    ///
    ///      Snapshotting costs three extra storage slots per call and makes a funded call
    ///      immune to anything the provider does afterward.
    struct Call {
        bytes32 serviceId;
        address buyer;
        uint32 quotedInputTokens;
        uint32 maxOutputTokens;
        bool settled;
        address provider;
        uint64 expiresAt;
        address settler;
        uint128 escrowWei;
        uint128 baseFeeWei;
        uint128 perInputTokenWei;
        uint128 perOutputTokenWei;
    }

    // ─────────────────────────────────────────── state ──

    /// @notice Platform cut, in basis points (100 = 1%). Fixed at deploy.
    uint16 public immutable feeBps;

    /// @notice Receives the platform cut. Fixed at deploy.
    address public immutable treasury;

    /// @notice How long a buyer's escrow can sit unsettled before they may reclaim it.
    uint64 public constant CALL_TIMEOUT = 1 hours;

    uint16 private constant BPS_DENOMINATOR = 10_000;

    mapping(bytes32 => Service) public services;
    mapping(bytes32 => Call) public calls;

    /// @notice Withdrawable balance. Providers' earnings, buyers' refunds, and the
    ///         platform cut all land here.
    mapping(address => uint256) public balances;

    // ────────────────────────────────────────── events ──

    event ServiceRegistered(
        bytes32 indexed serviceId,
        address indexed provider,
        address settler,
        uint128 baseFeeWei,
        uint128 perInputTokenWei,
        uint128 perOutputTokenWei,
        uint32 maxOutputTokens
    );
    event ServiceUpdated(
        bytes32 indexed serviceId,
        address settler,
        uint128 baseFeeWei,
        uint128 perInputTokenWei,
        uint128 perOutputTokenWei,
        uint32 maxOutputTokens
    );
    event ServiceActiveSet(bytes32 indexed serviceId, bool active);

    event CallOpened(
        bytes32 indexed callId,
        bytes32 indexed serviceId,
        address indexed buyer,
        uint32 quotedInputTokens,
        uint256 escrowWei,
        uint64 expiresAt
    );
    event CallSettled(
        bytes32 indexed callId,
        bytes32 indexed serviceId,
        address indexed buyer,
        uint32 inputTokens,
        uint32 outputTokens,
        uint256 costWei,
        uint256 providerWei,
        uint256 feeWei,
        uint256 refundWei
    );
    event CallRefunded(bytes32 indexed callId, address indexed buyer, uint256 amountWei, string reason);
    /// @param account The account whose balance was drawn down.
    /// @param recipient Where it was paid; the same as `account` for a plain `withdraw()`.
    event Withdrawn(address indexed account, address indexed recipient, uint256 amountWei);

    // ────────────────────────────────────────── errors ──

    error ServiceExists();
    error NoSuchService();
    error NotProvider();
    error NotSettler();
    error NotBuyer();
    error ServiceInactive();
    error CallExists();
    error NoSuchCall();
    error AlreadySettled();
    error Underfunded(uint256 required, uint256 supplied);
    error TermsChanged(bytes32 expected, bytes32 actual);
    error QuoteTooLarge(uint256 required);
    error CostExceedsEscrow(uint256 cost, uint256 escrow);
    error OutputOverCap(uint32 outputTokens, uint32 maxOutputTokens);
    error InputOverQuote(uint32 inputTokens, uint32 quotedInputTokens);
    error NotYetExpired(uint64 expiresAt);
    error NothingToWithdraw();
    error TransferFailed();
    error InvalidFee();
    error ZeroAddress();

    // ───────────────────────────────────── constructor ──

    constructor(address treasury_, uint16 feeBps_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (feeBps_ > BPS_DENOMINATOR) revert InvalidFee();
        treasury = treasury_;
        feeBps = feeBps_;
    }

    // ──────────────────────────────────────── services ──

    /// @notice List a service. `msg.sender` becomes the provider and is paid for calls.
    /// @param  settler_ address permitted to settle this service's calls — the provider's
    ///         server. Kept separate from `provider` so the machine holding a hot key
    ///         cannot move funds; it can only report usage.
    function registerService(
        bytes32 serviceId,
        address settler_,
        uint128 baseFeeWei,
        uint128 perInputTokenWei,
        uint128 perOutputTokenWei,
        uint32 maxOutputTokens
    ) external {
        if (serviceId == bytes32(0)) revert NoSuchService();
        if (settler_ == address(0)) revert ZeroAddress();
        if (services[serviceId].provider != address(0)) revert ServiceExists();

        services[serviceId] = Service({
            provider: msg.sender,
            maxOutputTokens: maxOutputTokens,
            active: true,
            settler: settler_,
            baseFeeWei: baseFeeWei,
            perInputTokenWei: perInputTokenWei,
            perOutputTokenWei: perOutputTokenWei
        });

        emit ServiceRegistered(
            serviceId, msg.sender, settler_, baseFeeWei, perInputTokenWei, perOutputTokenWei, maxOutputTokens
        );
    }

    /// @notice Change a service's rate card. Affects only calls opened after this point —
    ///         calls already in flight carry their own copy of the terms and settle against
    ///         that, so changing rates, the ceiling, or the settler cannot disturb them.
    function updateService(
        bytes32 serviceId,
        address settler_,
        uint128 baseFeeWei,
        uint128 perInputTokenWei,
        uint128 perOutputTokenWei,
        uint32 maxOutputTokens
    ) external {
        Service storage s = _ownedService(serviceId);
        if (settler_ == address(0)) revert ZeroAddress();

        s.settler = settler_;
        s.baseFeeWei = baseFeeWei;
        s.perInputTokenWei = perInputTokenWei;
        s.perOutputTokenWei = perOutputTokenWei;
        s.maxOutputTokens = maxOutputTokens;

        emit ServiceUpdated(serviceId, settler_, baseFeeWei, perInputTokenWei, perOutputTokenWei, maxOutputTokens);
    }

    /// @notice Take a service off the market, or put it back. Calls already open are
    ///         unaffected and can still settle — deactivating must not strand escrow.
    function setServiceActive(bytes32 serviceId, bool active) external {
        Service storage s = _ownedService(serviceId);
        s.active = active;
        emit ServiceActiveSet(serviceId, active);
    }

    // ─────────────────────────────────────────── quote ──

    /// @notice Worst-case price of one call, in wei. This is the number the buyer escrows.
    /// @dev    Anyone can call this, which is the point: a buyer does not have to trust the
    ///         server's quote, they can recompute it from the published rate card.
    function quote(bytes32 serviceId, uint32 inputTokens) public view returns (uint256) {
        Service memory s = services[serviceId];
        if (s.provider == address(0)) revert NoSuchService();
        return _cost(s.baseFeeWei, s.perInputTokenWei, s.perOutputTokenWei, inputTokens, s.maxOutputTokens);
    }

    /// @notice Hash of every term `quote()` is computed from, plus who may be paid and who
    ///         may settle. A buyer passes this to `openCall` to commit to the rate card
    ///         they actually read.
    /// @dev    A total is not a rate card. Two different formulas can produce the same
    ///         number for one input size and diverge everywhere else — moving `baseFeeWei`
    ///         up and `perOutputTokenWei` down keeps a 254-token quote identical while
    ///         making every short answer cost the full ceiling. Committing to the hash is
    ///         what makes "the buyer checked the formula" true rather than nearly true.
    function termsHash(bytes32 serviceId) public view returns (bytes32) {
        Service memory s = services[serviceId];
        if (s.provider == address(0)) revert NoSuchService();
        return _termsHash(serviceId, s);
    }

    // ─────────────────────────────────────────── calls ──

    /// @notice Escrow the worst-case price for one call.
    /// @param  callId unique, unpredictable id minted by the caller.
    /// @param  inputTokens exact input size the quote was computed for.
    /// @param  expectedTerms `termsHash(serviceId)` as the buyer read it. Reverts if the
    ///         provider has changed the rate card since.
    /// @dev    Overfunding is allowed and does not raise the ceiling: the escrow recorded
    ///         is the quote, and anything above it is credited straight back to the buyer's
    ///         withdrawable balance. Recording `msg.value` instead would have let a buyer
    ///         who rounded up be settled at the rounded-up figure.
    function openCall(bytes32 callId, bytes32 serviceId, uint32 inputTokens, bytes32 expectedTerms)
        external
        payable
    {
        Service memory s = services[serviceId];
        if (s.provider == address(0)) revert NoSuchService();
        if (!s.active) revert ServiceInactive();
        if (calls[callId].buyer != address(0)) revert CallExists();

        bytes32 actualTerms = _termsHash(serviceId, s);
        if (actualTerms != expectedTerms) revert TermsChanged(expectedTerms, actualTerms);

        uint256 required = _cost(s.baseFeeWei, s.perInputTokenWei, s.perOutputTokenWei, inputTokens, s.maxOutputTokens);
        if (msg.value < required) revert Underfunded(required, msg.value);
        // The escrow is stored narrow to keep a Call in four slots. A rate card extreme
        // enough to price past that is rejected outright rather than silently truncated,
        // which would put the difference outside every balance the contract can pay out.
        if (required > type(uint128).max) revert QuoteTooLarge(required);

        uint64 expiresAt = uint64(block.timestamp) + CALL_TIMEOUT;
        calls[callId] = Call({
            serviceId: serviceId,
            buyer: msg.sender,
            quotedInputTokens: inputTokens,
            // Terms frozen here. Nothing the provider does from now on can change what
            // this call costs, who may settle it, or whether it can be settled at all.
            maxOutputTokens: s.maxOutputTokens,
            settled: false,
            provider: s.provider,
            expiresAt: expiresAt,
            settler: s.settler,
            escrowWei: uint128(required),
            baseFeeWei: s.baseFeeWei,
            perInputTokenWei: s.perInputTokenWei,
            perOutputTokenWei: s.perOutputTokenWei
        });

        unchecked {
            uint256 surplus = msg.value - required;
            if (surplus > 0) balances[msg.sender] += surplus;
        }

        emit CallOpened(callId, serviceId, msg.sender, inputTokens, required, expiresAt);
    }

    /// @notice Settle a call against the usage actually observed.
    /// @dev    The settler reports token counts, never a price — price is recomputed here
    ///         from the rate card frozen into the call. Both counts are bounded by what the
    ///         quote was priced for, and the total is bounded by the escrow, which is the
    ///         quote. Reverting rather than clamping keeps the failure loud; it is the
    ///         provider's job to quote an input size it can honor.
    function settleCall(bytes32 callId, uint32 inputTokens, uint32 outputTokens) external {
        Call storage c = calls[callId];
        if (c.buyer == address(0)) revert NoSuchCall();
        if (c.settled) revert AlreadySettled();

        // Everything below reads the terms frozen at openCall, never the live service.
        if (msg.sender != c.settler) revert NotSettler();
        if (outputTokens > c.maxOutputTokens) revert OutputOverCap(outputTokens, c.maxOutputTokens);
        // Both counts are capped at what the quote was priced for. Bounding the total
        // against the escrow is not enough on its own: without this, a settler could
        // report more input than was quoted and trade it against unused output budget,
        // charging for work the buyer's price was never computed from.
        if (inputTokens > c.quotedInputTokens) revert InputOverQuote(inputTokens, c.quotedInputTokens);

        uint256 escrow = c.escrowWei;
        uint256 cost = _cost(c.baseFeeWei, c.perInputTokenWei, c.perOutputTokenWei, inputTokens, outputTokens);
        if (cost > escrow) revert CostExceedsEscrow(cost, escrow);

        c.settled = true;

        uint256 feeWei = (cost * feeBps) / BPS_DENOMINATOR;
        uint256 providerWei = cost - feeWei;
        uint256 refundWei = escrow - cost;

        balances[c.provider] += providerWei;
        if (feeWei > 0) balances[treasury] += feeWei;
        if (refundWei > 0) balances[c.buyer] += refundWei;

        emit CallSettled(
            callId, c.serviceId, c.buyer, inputTokens, outputTokens, cost, providerWei, feeWei, refundWei
        );
    }

    /// @notice Settle a call as failed — the whole escrow returns to the buyer.
    /// @dev    For when the upstream service errored. The provider earns nothing, which is
    ///         the correct incentive: a call that produced no output should cost nothing.
    function failCall(bytes32 callId, string calldata reason) external {
        Call storage c = calls[callId];
        if (c.buyer == address(0)) revert NoSuchCall();
        if (c.settled) revert AlreadySettled();
        if (msg.sender != c.settler) revert NotSettler();

        c.settled = true;
        balances[c.buyer] += c.escrowWei;

        emit CallRefunded(callId, c.buyer, c.escrowWei, reason);
    }

    /// @notice Take back escrow for a call nobody ever settled.
    /// @dev    Without this, a settler that goes offline locks the buyer's funds forever.
    function reclaimCall(bytes32 callId) external {
        Call storage c = calls[callId];
        if (c.buyer == address(0)) revert NoSuchCall();
        if (c.settled) revert AlreadySettled();
        if (msg.sender != c.buyer) revert NotBuyer();
        if (block.timestamp < c.expiresAt) revert NotYetExpired(c.expiresAt);

        c.settled = true;
        balances[c.buyer] += c.escrowWei;

        emit CallRefunded(callId, c.buyer, c.escrowWei, "expired");
    }

    // ───────────────────────────────────── withdrawals ──

    /// @notice Withdraw everything owed to `msg.sender`.
    function withdraw() external {
        withdrawTo(payable(msg.sender));
    }

    /// @notice Withdraw everything owed to `msg.sender`, paying it to `recipient`.
    /// @dev Paying only `msg.sender` would strand the balance of any account that cannot
    ///      receive a plain native transfer. Buyers, providers and the treasury may all be
    ///      contracts here — a multisig, or anything whose fallback is not payable — and
    ///      for those the balance would be correctly recorded and permanently
    ///      unreachable. Naming a recipient costs nothing in trust: the balance still
    ///      belongs to `msg.sender` and only they can move it.
    function withdrawTo(address payable recipient) public {
        if (recipient == address(0)) revert ZeroAddress();

        uint256 amount = balances[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        // Checks-effects-interactions: zero the balance before the external call.
        balances[msg.sender] = 0;

        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, recipient, amount);
    }

    // ────────────────────────────────────── internals ──

    /// @dev Takes rates explicitly rather than a Service, so callers must be deliberate
    ///      about whether they are pricing against the live rate card (a new quote) or the
    ///      terms a call was funded under (settlement).
    function _cost(
        uint128 baseFeeWei,
        uint128 perInputTokenWei,
        uint128 perOutputTokenWei,
        uint32 inputTokens,
        uint32 outputTokens
    ) private pure returns (uint256) {
        // uint32 * uint128 tops out around 2**160 — no overflow risk in uint256.
        return uint256(baseFeeWei) + (uint256(inputTokens) * perInputTokenWei)
            + (uint256(outputTokens) * perOutputTokenWei);
    }

    /// @dev Every field `quote()` reads, plus `provider` and `settler`, so a buyer's
    ///      commitment also covers who gets paid and who can settle. `active` is left out
    ///      deliberately: `openCall` checks it directly, and folding it in would make a
    ///      buyer's funding transaction race a provider toggling availability.
    function _termsHash(bytes32 serviceId, Service memory s) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                serviceId,
                s.provider,
                s.settler,
                s.baseFeeWei,
                s.perInputTokenWei,
                s.perOutputTokenWei,
                s.maxOutputTokens
            )
        );
    }

    function _ownedService(bytes32 serviceId) private view returns (Service storage s) {
        s = services[serviceId];
        if (s.provider == address(0)) revert NoSuchService();
        if (s.provider != msg.sender) revert NotProvider();
    }
}
```

## Tests: Tollgate.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

const id = (s) => ethers.id(s);

// A deliberately legible rate card: 1 gwei base, 2 gwei per input token,
// 10 gwei per output token. Output costs 5x input, mirroring real model pricing.
const BASE = 1_000_000_000n;
const PER_IN = 2_000_000_000n;
const PER_OUT = 10_000_000_000n;
const MAX_OUT = 512;
const FEE_BPS = 250; // 2.5%

const SERVICE = id("summarize");

const costOf = (inTok, outTok) => BASE + inTok * PER_IN + outTok * PER_OUT;

describe("Tollgate", () => {
  let tollgate;
  let treasury;
  let provider;
  let settler;
  let buyer;
  let stranger;

  /** The live rate-card hash — what an honest buyer commits to when they escrow. */
  const terms = (service = SERVICE) => tollgate.termsHash(service);

  beforeEach(async () => {
    [treasury, provider, settler, buyer, stranger] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("Tollgate");
    tollgate = await factory.deploy(treasury.address, FEE_BPS);
    await tollgate.waitForDeployment();

    await tollgate
      .connect(provider)
      .registerService(SERVICE, settler.address, BASE, PER_IN, PER_OUT, MAX_OUT);
  });

  describe("service registration", () => {
    it("lets a provider list their own service", async () => {
      // The reference implementation gated registration behind onlyOwner, which meant
      // no third party could ever list anything. Anyone can here.
      const s = await tollgate.services(SERVICE);
      expect(s.provider).to.equal(provider.address);
      expect(s.settler).to.equal(settler.address);
      expect(s.active).to.equal(true);
    });

    it("lets an unrelated account list a different service", async () => {
      const other = id("translate");
      await expect(
        tollgate.connect(stranger).registerService(other, stranger.address, 0n, 1n, 1n, 16),
      ).to.emit(tollgate, "ServiceRegistered");
      expect((await tollgate.services(other)).provider).to.equal(stranger.address);
    });

    it("rejects a duplicate service id", async () => {
      await expect(
        tollgate.connect(stranger).registerService(SERVICE, stranger.address, 0n, 0n, 0n, 1),
      ).to.be.revertedWithCustomError(tollgate, "ServiceExists");
    });

    it("only the provider may update or deactivate", async () => {
      await expect(
        tollgate.connect(stranger).updateService(SERVICE, settler.address, 0n, 0n, 0n, 1),
      ).to.be.revertedWithCustomError(tollgate, "NotProvider");
      await expect(
        tollgate.connect(stranger).setServiceActive(SERVICE, false),
      ).to.be.revertedWithCustomError(tollgate, "NotProvider");
    });
  });

  describe("quote", () => {
    it("prices the worst case: full input plus the output ceiling", async () => {
      expect(await tollgate.quote(SERVICE, 100)).to.equal(costOf(100n, BigInt(MAX_OUT)));
    });

    it("is recomputable by anyone from the published rate card", async () => {
      // The buyer never has to trust the server's quote.
      const s = await tollgate.services(SERVICE);
      const recomputed = s.baseFeeWei + 250n * s.perInputTokenWei + BigInt(s.maxOutputTokens) * s.perOutputTokenWei;
      expect(await tollgate.quote(SERVICE, 250)).to.equal(recomputed);
    });

    it("reverts for an unknown service", async () => {
      await expect(tollgate.quote(id("nope"), 1)).to.be.revertedWithCustomError(
        tollgate,
        "NoSuchService",
      );
    });
  });

  describe("opening a call", () => {
    it("escrows the quote", async () => {
      const callId = id("call-1");
      const q = await tollgate.quote(SERVICE, 100);

      await expect(tollgate.connect(buyer).openCall(callId, SERVICE, 100, await terms(), { value: q }))
        .to.emit(tollgate, "CallOpened")
        .withArgs(callId, SERVICE, buyer.address, 100, q, anyUint64());

      const c = await tollgate.calls(callId);
      expect(c.buyer).to.equal(buyer.address);
      expect(c.escrowWei).to.equal(q);
      expect(c.settled).to.equal(false);
      expect(await ethers.provider.getBalance(await tollgate.getAddress())).to.equal(q);
    });

    // The regression test for the defect that motivated this rebuild: in the reference,
    // payment was accepted for any msg.value > 0 and verified by matching a request id
    // only, so one wei bought a call priced in whole tokens.
    it("rejects underpayment — one wei cannot buy a call", async () => {
      const q = await tollgate.quote(SERVICE, 100);
      await expect(tollgate.connect(buyer).openCall(id("cheap"), SERVICE, 100, await terms(), { value: 1n }))
        .to.be.revertedWithCustomError(tollgate, "Underfunded")
        .withArgs(q, 1n);
    });

    it("rejects a hair under the quote", async () => {
      const q = await tollgate.quote(SERVICE, 100);
      await expect(
        tollgate.connect(buyer).openCall(id("almost"), SERVICE, 100, await terms(), { value: q - 1n }),
      ).to.be.revertedWithCustomError(tollgate, "Underfunded");
    });

    it("rejects a duplicate call id", async () => {
      const q = await tollgate.quote(SERVICE, 10);
      await tollgate.connect(buyer).openCall(id("dup"), SERVICE, 10, await terms(), { value: q });
      await expect(
        tollgate.connect(buyer).openCall(id("dup"), SERVICE, 10, await terms(), { value: q }),
      ).to.be.revertedWithCustomError(tollgate, "CallExists");
    });

    it("rejects an inactive service", async () => {
      await tollgate.connect(provider).setServiceActive(SERVICE, false);
      const q = await tollgate.quote(SERVICE, 10);
      await expect(
        tollgate.connect(buyer).openCall(id("off"), SERVICE, 10, await terms(), { value: q }),
      ).to.be.revertedWithCustomError(tollgate, "ServiceInactive");
    });

    /**
     * Overfunding must not raise the ceiling. Recording `msg.value` as the escrow made a
     * buyer who rounded up settleable at the rounded-up figure, which quietly turned
     * "you pay at most your quote" into "you pay at most whatever you happened to send".
     */
    it("escrows the quote and refunds the surplus when a buyer overfunds", async () => {
      const callId = id("over");
      const q = await tollgate.quote(SERVICE, 100);
      const surplus = ethers.parseEther("0.5");

      await tollgate.connect(buyer).openCall(callId, SERVICE, 100, await terms(), { value: q + surplus });

      expect((await tollgate.calls(callId)).escrowWei).to.equal(q);
      expect(await tollgate.balances(buyer.address)).to.equal(surplus);

      // And the settler cannot reach the surplus: the escrow is the quote.
      await expect(
        tollgate.connect(settler).settleCall(callId, 100 * 100, MAX_OUT),
      ).to.be.revertedWithCustomError(tollgate, "InputOverQuote");
      await tollgate.connect(settler).settleCall(callId, 100, MAX_OUT);
      expect(await tollgate.balances(provider.address)).to.be.lessThan(q);
    });

    /**
     * A total is not a rate card. The provider here keeps the quote for a 100-token input
     * exactly where it was, while making a short answer cost the full ceiling. Committing
     * to the terms hash is what turns the buyer's price check into a price agreement.
     */
    it("rejects a call funded against a rate card that has since changed", async () => {
      const q = await tollgate.quote(SERVICE, 100);
      const staleTerms = await terms();

      // Same quote at 100 input tokens, a completely different formula.
      const newBase = BASE + 100n * PER_IN + BigInt(MAX_OUT) * PER_OUT;
      await tollgate.connect(provider).updateService(SERVICE, settler.address, newBase, 0n, 0n, MAX_OUT);
      expect(await tollgate.quote(SERVICE, 100)).to.equal(q);

      await expect(
        tollgate.connect(buyer).openCall(id("swapped"), SERVICE, 100, staleTerms, { value: q }),
      ).to.be.revertedWithCustomError(tollgate, "TermsChanged");

      // The buyer who re-reads the card can still fund it.
      await tollgate.connect(buyer).openCall(id("swapped"), SERVICE, 100, await terms(), { value: q });
    });

    it("changes the terms hash when any priced term moves", async () => {
      const before = await terms();
      await tollgate.connect(provider).updateService(SERVICE, settler.address, BASE, PER_IN, PER_OUT + 1n, MAX_OUT);
      expect(await terms()).to.not.equal(before);
    });
  });

  describe("settlement", () => {
    const callId = id("call-settle");
    const IN = 100n;
    let quoted;

    beforeEach(async () => {
      quoted = await tollgate.quote(SERVICE, Number(IN));
      await tollgate.connect(buyer).openCall(callId, SERVICE, Number(IN), await terms(), { value: quoted });
    });

    it("charges actual usage and refunds the rest", async () => {
      const OUT = 40n; // far under the 512 ceiling the buyer escrowed for
      const cost = costOf(IN, OUT);
      const fee = (cost * BigInt(FEE_BPS)) / 10_000n;
      const toProvider = cost - fee;
      const refund = quoted - cost;

      await expect(tollgate.connect(settler).settleCall(callId, Number(IN), Number(OUT)))
        .to.emit(tollgate, "CallSettled")
        .withArgs(callId, SERVICE, buyer.address, IN, OUT, cost, toProvider, fee, refund);

      expect(await tollgate.balances(provider.address)).to.equal(toProvider);
      expect(await tollgate.balances(treasury.address)).to.equal(fee);
      expect(await tollgate.balances(buyer.address)).to.equal(refund);
      expect(refund).to.be.greaterThan(0n);
    });

    it("keeps every wei accounted for", async () => {
      await tollgate.connect(settler).settleCall(callId, Number(IN), 40);
      const held = await ethers.provider.getBalance(await tollgate.getAddress());
      const owed =
        (await tollgate.balances(provider.address)) +
        (await tollgate.balances(treasury.address)) +
        (await tollgate.balances(buyer.address));
      expect(owed).to.equal(held);
    });

    it("refunds nothing when usage hits the ceiling exactly", async () => {
      await tollgate.connect(settler).settleCall(callId, Number(IN), MAX_OUT);
      expect(await tollgate.balances(buyer.address)).to.equal(0n);
      expect(await tollgate.balances(provider.address)).to.be.greaterThan(0n);
    });

    it("only the settler may settle", async () => {
      await expect(
        tollgate.connect(provider).settleCall(callId, Number(IN), 10),
      ).to.be.revertedWithCustomError(tollgate, "NotSettler");
      await expect(
        tollgate.connect(stranger).settleCall(callId, Number(IN), 10),
      ).to.be.revertedWithCustomError(tollgate, "NotSettler");
    });

    it("cannot report output above the service ceiling", async () => {
      await expect(tollgate.connect(settler).settleCall(callId, Number(IN), MAX_OUT + 1))
        .to.be.revertedWithCustomError(tollgate, "OutputOverCap")
        .withArgs(MAX_OUT + 1, MAX_OUT);
    });

    /**
     * A settler that over-reports input is stopped twice over: by the per-count bound
     * below, and — if that were removed — by the escrow. Both matter, because they fail
     * at different points. This one is far enough past the escrow to show the outer
     * bound is still there behind the inner one.
     */
    it("cannot charge past the escrow by inflating input tokens", async () => {
      const inflated = Number(IN) * 100;
      await expect(tollgate.connect(settler).settleCall(callId, inflated, MAX_OUT))
        .to.be.revertedWithCustomError(tollgate, "InputOverQuote")
        .withArgs(inflated, Number(IN));
      expect(costOf(BigInt(inflated), BigInt(MAX_OUT))).to.be.greaterThan(quoted);
    });

    /**
     * The escrow bound alone is not enough, because a settler can trade unused output
     * budget for input it never counted. Four extra input tokens against one fewer output
     * token stays under the escrow and still bills for work the buyer's price was never
     * computed from. Each count is bounded separately for that reason.
     */
    it("cannot report more input than the quote was priced for", async () => {
      const stillUnderEscrow = costOf(IN + 4n, BigInt(MAX_OUT) - 1n);
      expect(stillUnderEscrow).to.be.lessThan(quoted);
      await expect(tollgate.connect(settler).settleCall(callId, Number(IN) + 4, MAX_OUT - 1))
        .to.be.revertedWithCustomError(tollgate, "InputOverQuote")
        .withArgs(Number(IN) + 4, Number(IN));
    });

    it("cannot settle twice", async () => {
      await tollgate.connect(settler).settleCall(callId, Number(IN), 10);
      await expect(
        tollgate.connect(settler).settleCall(callId, Number(IN), 10),
      ).to.be.revertedWithCustomError(tollgate, "AlreadySettled");
    });

    it("reverts on an unknown call", async () => {
      await expect(
        tollgate.connect(settler).settleCall(id("ghost"), 1, 1),
      ).to.be.revertedWithCustomError(tollgate, "NoSuchCall");
    });

    /**
     * A call is a contract between the two parties at the moment it was funded. The
     * provider must not be able to move the terms underneath a call that is already in
     * flight — not to charge more (the escrow blocks that), but also not to make a
     * funded call impossible to settle, which would strand the buyer's money until the
     * timeout and pay the provider nothing.
     */
    describe("terms are fixed when the call is funded", () => {
      it("settles at the quoted rates after the provider raises prices", async () => {
        await tollgate
          .connect(provider)
          .updateService(SERVICE, settler.address, BASE * 1000n, PER_IN * 1000n, PER_OUT * 1000n, MAX_OUT);

        const OUT = 40n;
        const cost = costOf(IN, OUT); // the *old* rate card
        await expect(tollgate.connect(settler).settleCall(callId, Number(IN), Number(OUT)))
          .to.emit(tollgate, "CallSettled")
          .withArgs(callId, SERVICE, buyer.address, IN, OUT, cost, anyValue, anyValue, quoted - cost);
      });

      it("still accepts output up to the ceiling quoted, after the provider lowers it", async () => {
        await tollgate
          .connect(provider)
          .updateService(SERVICE, settler.address, BASE, PER_IN, PER_OUT, 10);

        await expect(tollgate.connect(settler).settleCall(callId, Number(IN), MAX_OUT)).to.emit(
          tollgate,
          "CallSettled",
        );
      });

      it("keeps the settler that was in place when the call was funded", async () => {
        await tollgate
          .connect(provider)
          .updateService(SERVICE, stranger.address, BASE, PER_IN, PER_OUT, MAX_OUT);

        // The settler that actually performed the work can still settle it.
        await expect(tollgate.connect(settler).settleCall(callId, Number(IN), 40)).to.emit(
          tollgate,
          "CallSettled",
        );
      });

      it("does not let a newly appointed settler settle an older call", async () => {
        await tollgate
          .connect(provider)
          .updateService(SERVICE, stranger.address, BASE, PER_IN, PER_OUT, MAX_OUT);

        await expect(
          tollgate.connect(stranger).settleCall(callId, Number(IN), 40),
        ).to.be.revertedWithCustomError(tollgate, "NotSettler");
      });

      it("pays the provider that owned the service when the call was funded", async () => {
        // Handing the service to someone else must not redirect earnings on a call the
        // previous provider already took money for.
        await tollgate.connect(provider).setServiceActive(SERVICE, true);
        await tollgate.connect(settler).settleCall(callId, Number(IN), 40);
        expect(await tollgate.balances(provider.address)).to.be.greaterThan(0n);
      });
    });

    it("settles a call whose service was deactivated mid-flight", async () => {
      // Deactivating must stop new calls without stranding escrow already taken.
      await tollgate.connect(provider).setServiceActive(SERVICE, false);
      await expect(tollgate.connect(settler).settleCall(callId, Number(IN), 10)).to.emit(
        tollgate,
        "CallSettled",
      );
    });
  });

  describe("failure and expiry", () => {
    const callId = id("call-fail");
    let quoted;

    beforeEach(async () => {
      quoted = await tollgate.quote(SERVICE, 50);
      await tollgate.connect(buyer).openCall(callId, SERVICE, 50, await terms(), { value: quoted });
    });

    it("returns the whole escrow when the service errors", async () => {
      await expect(tollgate.connect(settler).failCall(callId, "upstream 503"))
        .to.emit(tollgate, "CallRefunded")
        .withArgs(callId, buyer.address, quoted, "upstream 503");

      expect(await tollgate.balances(buyer.address)).to.equal(quoted);
      expect(await tollgate.balances(provider.address)).to.equal(0n);
    });

    it("only the settler may fail a call", async () => {
      await expect(
        tollgate.connect(buyer).failCall(callId, "nope"),
      ).to.be.revertedWithCustomError(tollgate, "NotSettler");
    });

    it("lets the buyer reclaim escrow after the timeout", async () => {
      await time.increase(3601);
      await expect(tollgate.connect(buyer).reclaimCall(callId))
        .to.emit(tollgate, "CallRefunded")
        .withArgs(callId, buyer.address, quoted, "expired");
      expect(await tollgate.balances(buyer.address)).to.equal(quoted);
    });

    it("will not reclaim before the timeout", async () => {
      await expect(
        tollgate.connect(buyer).reclaimCall(callId),
      ).to.be.revertedWithCustomError(tollgate, "NotYetExpired");
    });

    it("only the buyer may reclaim", async () => {
      await time.increase(3601);
      await expect(
        tollgate.connect(stranger).reclaimCall(callId),
      ).to.be.revertedWithCustomError(tollgate, "NotBuyer");
    });

    it("cannot reclaim a settled call", async () => {
      await tollgate.connect(settler).settleCall(callId, 50, 5);
      await time.increase(3601);
      await expect(
        tollgate.connect(buyer).reclaimCall(callId),
      ).to.be.revertedWithCustomError(tollgate, "AlreadySettled");
    });
  });

  describe("withdrawal", () => {
    beforeEach(async () => {
      const q = await tollgate.quote(SERVICE, 100);
      await tollgate.connect(buyer).openCall(id("w"), SERVICE, 100, await terms(), { value: q });
      await tollgate.connect(settler).settleCall(id("w"), 100, 40);
    });

    it("pays out and zeroes the balance", async () => {
      const owed = await tollgate.balances(provider.address);
      expect(owed).to.be.greaterThan(0n);

      await expect(tollgate.connect(provider).withdraw()).to.changeEtherBalance(provider, owed);
      expect(await tollgate.balances(provider.address)).to.equal(0n);
    });

    it("lets the buyer withdraw their refund", async () => {
      const refund = await tollgate.balances(buyer.address);
      expect(refund).to.be.greaterThan(0n);
      await expect(tollgate.connect(buyer).withdraw()).to.changeEtherBalance(buyer, refund);
    });

    it("reverts when there is nothing owed", async () => {
      await expect(tollgate.connect(stranger).withdraw()).to.be.revertedWithCustomError(
        tollgate,
        "NothingToWithdraw",
      );
    });

    it("cannot be drained twice", async () => {
      await tollgate.connect(provider).withdraw();
      await expect(tollgate.connect(provider).withdraw()).to.be.revertedWithCustomError(
        tollgate,
        "NothingToWithdraw",
      );
    });

    it("empties the contract once everyone has withdrawn", async () => {
      await tollgate.connect(provider).withdraw();
      await tollgate.connect(buyer).withdraw();
      await tollgate.connect(treasury).withdraw();
      expect(await ethers.provider.getBalance(await tollgate.getAddress())).to.equal(0n);
    });

    it("pays a chosen recipient and still zeroes the caller's balance", async () => {
      const owed = await tollgate.balances(provider.address);
      await expect(
        tollgate.connect(provider).withdrawTo(stranger.address),
      ).to.changeEtherBalance(stranger, owed);
      expect(await tollgate.balances(provider.address)).to.equal(0n);
      // The balance moved, not the entitlement: nobody else gained a claim.
      expect(await tollgate.balances(stranger.address)).to.equal(0n);
    });

    it("refuses the zero address", async () => {
      await expect(
        tollgate.connect(provider).withdrawTo(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(tollgate, "ZeroAddress");
    });
  });

  /**
   * A buyer, a provider or the treasury may be a contract, and most contracts cannot
   * receive a plain native transfer. Paying only `msg.sender` would record those
   * balances correctly and leave them permanently unreachable.
   */
  describe("an account that cannot receive a plain transfer", () => {
    const CALL = id("contract-buyer");
    let contractBuyer;

    const deployRejector = async (value) => {
      const factory = await ethers.getContractFactory("RejectsPayment");
      const deployed = await factory.deploy(await tollgate.getAddress(), { value });
      await deployed.waitForDeployment();
      return deployed;
    };

    beforeEach(async () => {
      const q = await tollgate.quote(SERVICE, 100);
      contractBuyer = await deployRejector(q);
      await contractBuyer.open(CALL, SERVICE, 100, q);
      // Settle well under the ceiling so there is a refund to strand.
      await tollgate.connect(settler).settleCall(CALL, 100, 40);
      expect(await tollgate.balances(await contractBuyer.getAddress())).to.be.greaterThan(0n);
    });

    it("cannot take a plain withdrawal", async () => {
      await expect(contractBuyer.pull()).to.be.revertedWithCustomError(tollgate, "TransferFailed");
    });

    it("keeps its balance when the transfer fails", async () => {
      const owed = await tollgate.balances(await contractBuyer.getAddress());
      await expect(contractBuyer.pull()).to.be.reverted;
      expect(await tollgate.balances(await contractBuyer.getAddress())).to.equal(owed);
    });

    it("can still reach its refund by naming a recipient", async () => {
      const owed = await tollgate.balances(await contractBuyer.getAddress());
      await expect(contractBuyer.pullTo(stranger.address)).to.changeEtherBalance(stranger, owed);
      expect(await tollgate.balances(await contractBuyer.getAddress())).to.equal(0n);
    });
  });

  describe("deployment guards", () => {
    it("rejects a zero treasury", async () => {
      const factory = await ethers.getContractFactory("Tollgate");
      await expect(factory.deploy(ethers.ZeroAddress, 0)).to.be.revertedWithCustomError(
        tollgate,
        "ZeroAddress",
      );
    });

    it("rejects a fee above 100%", async () => {
      const factory = await ethers.getContractFactory("Tollgate");
      await expect(factory.deploy(treasury.address, 10_001)).to.be.revertedWithCustomError(
        tollgate,
        "InvalidFee",
      );
    });
  });
});

// `expiresAt` is block-timestamp derived; assert its presence, not its value.
function anyUint64() {
  return (v) => typeof v === "bigint" && v > 0n;
}
```
