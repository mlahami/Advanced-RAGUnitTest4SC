# attention-stream--wildterralabs

- domain: subscriptions-streaming (payment-streaming)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/WILDTERRALABS/attention-press @ 321821a38f539c02cdc7aba01ac415523045f818
- license: MIT
- targets: AttentionStream.sol, ArticleRegistry.sol, IArticleRegistry.sol, MockERC20.sol
- validation: 16 passing tests, 0 failing; statement coverage AttentionStream.sol 75.76 %, ArticleRegistry.sol 78.57 %, IArticleRegistry.sol 100.0 %, MockERC20.sol 100.0 %

## Contract: ArticleRegistry.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IArticleRegistry} from "./IArticleRegistry.sol";

/// @title ArticleRegistry
/// @notice On-chain index of published articles. Only a content hash and pointer
///         live on-chain; the article body itself belongs on IPFS/Arweave.
/// @dev    Authorship is mutable only by the current author (transfer / retire).
contract ArticleRegistry is IArticleRegistry {
    struct Article {
        address author; // payout recipient; address(0) == does not exist
        bytes32 contentHash; // digest of the canonical, immutable article body
        uint64 createdAt;
        bool retired; // author disabled new reading sessions
    }

    /// @notice Id of the next article to be minted. Ids start at 1.
    uint256 public nextId = 1;

    mapping(uint256 => Article) public articles;
    /// @notice Off-chain pointer (e.g. ipfs://CID) with title, author name, cover, etc.
    mapping(uint256 => string) public metadataURI;

    event Published(uint256 indexed id, address indexed author, bytes32 contentHash, string metadataURI);
    event MetadataUpdated(uint256 indexed id, string metadataURI);
    event Retired(uint256 indexed id);
    event AuthorshipTransferred(uint256 indexed id, address indexed from, address indexed to);

    error NotAuthor();
    error UnknownArticle();
    error EmptyContentHash();
    error ZeroAddress();

    modifier onlyAuthor(uint256 id) {
        address a = articles[id].author;
        if (a == address(0)) revert UnknownArticle();
        if (a != msg.sender) revert NotAuthor();
        _;
    }

    /// @notice Register a new article. Anyone may publish.
    /// @param contentHash digest binding this id to an exact article body.
    /// @param uri off-chain metadata pointer (may be updated later).
    function publish(bytes32 contentHash, string calldata uri) external returns (uint256 id) {
        if (contentHash == bytes32(0)) revert EmptyContentHash();
        id = nextId++;
        articles[id] =
            Article({author: msg.sender, contentHash: contentHash, createdAt: uint64(block.timestamp), retired: false});
        metadataURI[id] = uri;
        emit Published(id, msg.sender, contentHash, uri);
    }

    function updateMetadata(uint256 id, string calldata uri) external onlyAuthor(id) {
        metadataURI[id] = uri;
        emit MetadataUpdated(id, uri);
    }

    /// @notice Stop new reading sessions for an article. Existing sessions are unaffected.
    function retire(uint256 id) external onlyAuthor(id) {
        articles[id].retired = true;
        emit Retired(id);
    }

    /// @notice Hand payout rights to another address (e.g. a multisig or splitter).
    function transferAuthorship(uint256 id, address to) external onlyAuthor(id) {
        if (to == address(0)) revert ZeroAddress();
        articles[id].author = to;
        emit AuthorshipTransferred(id, msg.sender, to);
    }

    /// @inheritdoc IArticleRegistry
    function authorOf(uint256 id) external view returns (address) {
        address a = articles[id].author;
        if (a == address(0)) revert UnknownArticle();
        return a;
    }

    /// @inheritdoc IArticleRegistry
    function isActive(uint256 id) external view returns (bool) {
        Article storage a = articles[id];
        return a.author != address(0) && !a.retired;
    }
}
```

## Contract: AttentionStream.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IArticleRegistry} from "./IArticleRegistry.sol";

/// @title AttentionStream
/// @notice Reader-funded, pay-per-second reading. Each reading session is a
///         unidirectional payment channel: the reader escrows a capped budget,
///         then a browser-held session key signs monotonically increasing
///         `cumulativeAmount` vouchers while the reader is actually on the page.
///         The author redeems the latest voucher on-chain; the reader is refunded
///         whatever budget was not streamed.
///
/// @dev    Closing is two-phase, so a reader cannot end the session and walk away
///         before the author's collector settles the last voucher:
///           1. `closeSession(id)` records an accrual cutoff (`closeInitiatedAt`)
///              and does NOT refund. Accrual is frozen at that timestamp.
///           2. For `challengeWindow` seconds anyone may still `settle` vouchers
///              the session key signed at or before the cutoff.
///           3. `finalizeSession(id)` (permissionless) then refunds
///              `budget - claimed` to the reader and closes the channel.
///         A collector-less reader recovers funds unilaterally:
///         `closeSession` -> wait `challengeWindow` -> `finalizeSession`. An
///         abandoned session can be force-closed by anyone once
///         `MAX_ACCRUAL_WINDOW` has elapsed.
///
/// @dev    Trust model
///         - No proof-of-personhood / anti-sybil machinery. Because the reader
///           funds the stream and value flows reader -> author, a publisher who
///           "reads" their own article via bots only loses the protocol fee and
///           gas. Fake attention is strictly unprofitable.
///         - The reader trusts their own client to stop signing vouchers when the
///           tab loses focus. This is bounded on-chain by `budget` (hard cap) and
///           `ratePerSec` (accrual cap). Keep default budgets small and session
///           lengths short in the UI.
contract AttentionStream is EIP712, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev EIP-712 typehash for a payment voucher.
    bytes32 private constant VOUCHER_TYPEHASH = keccak256("Voucher(bytes32 sessionId,uint256 cumulativeAmount)");

    uint16 public constant MAX_FEE_BPS = 1_000; // 10%
    uint64 public constant MIN_CHALLENGE_WINDOW = 1 minutes;
    uint64 public constant MAX_CHALLENGE_WINDOW = 1 days;
    /// @dev Upper bound on how far `ratePerSec` accrual is allowed to run, so a
    ///      never-closed session cannot be drained at full rate indefinitely.
    ///      Also the point after which anyone may force-close an abandoned session.
    uint64 public constant MAX_ACCRUAL_WINDOW = 7 days;

    IERC20 public immutable token;
    IArticleRegistry public immutable registry;

    address public treasury;
    uint16 public protocolFeeBps;
    /// @notice Seconds after `closeSession` during which vouchers may still settle
    ///         before `finalizeSession` refunds the reader.
    uint64 public challengeWindow = 15 minutes;

    struct Session {
        address reader; // escrow owner + refund recipient
        address signer; // ephemeral browser key authorized to sign vouchers
        address author; // payout recipient, cached at open time
        uint96 budget; // total escrowed; hard cap on cumulativeAmount
        uint96 claimed; // amount already streamed to the author
        uint64 articleId;
        uint64 startTime;
        uint64 ratePerSec; // max streaming rate; caps voucher accrual
        bool open;
    }

    mapping(bytes32 => Session) public sessions;
    /// @notice 0 while live; the timestamp `closeSession` was called otherwise.
    ///         Freezes accrual at that instant and starts the challenge window.
    mapping(bytes32 => uint64) public closeInitiatedAt;
    /// @notice Per-reader counter feeding session id derivation.
    mapping(address => uint256) public openCount;

    // --- Discovery stats (informational; a self-funded reader can inflate these,
    //     so rank on `articleEarned` / distinct payers off-chain, not raw counts) ---
    mapping(uint256 => uint256) public articleEarned; // gross streamed to author, pre-fee
    mapping(uint256 => uint256) public articleReaderSeconds; // sum of closed-session durations
    mapping(uint256 => uint32) public articleSessions;

    event SessionOpened(
        bytes32 indexed id,
        uint256 indexed articleId,
        address indexed reader,
        address author,
        address signer,
        uint96 budget,
        uint64 ratePerSec
    );
    event Settled(bytes32 indexed id, uint256 indexed articleId, uint96 cumulativeAmount, uint96 delta, uint96 fee);
    /// @notice Phase 1: accrual frozen at `initiatedAt`, challenge window running.
    event SessionClosing(bytes32 indexed id, uint256 indexed articleId, uint64 initiatedAt);
    /// @notice Phase 2: reader refunded, channel closed.
    event SessionClosed(
        bytes32 indexed id, uint256 indexed articleId, uint96 totalPaid, uint96 refunded, uint64 duration
    );
    event TreasuryUpdated(address treasury);
    event ProtocolFeeUpdated(uint16 bps);
    event ChallengeWindowUpdated(uint64 window);

    error ArticleInactive();
    error BadParams();
    error NotReader();
    error SessionNotOpen();
    error AlreadyClosing();
    error NotClosing();
    error ChallengeWindowOpen();
    error ChallengeWindowClosed();
    error NonMonotonic();
    error OverBudget();
    error RateExceeded();
    error BadSignature();

    constructor(IERC20 _token, IArticleRegistry _registry, address _treasury, uint16 _feeBps)
        EIP712("AttentionStream", "1")
        Ownable(msg.sender)
    {
        if (address(_token) == address(0) || address(_registry) == address(0) || _treasury == address(0)) {
            revert BadParams();
        }
        if (_feeBps > MAX_FEE_BPS) revert BadParams();
        token = _token;
        registry = _registry;
        treasury = _treasury;
        protocolFeeBps = _feeBps;
    }

    // ---------------------------------------------------------------------------
    // Reader / author flow
    // ---------------------------------------------------------------------------

    /// @notice Open a reading session and escrow `budget` of the payment token.
    /// @param articleId  target article; must be active in the registry.
    /// @param budget     hard cap the reader can spend this session.
    /// @param ratePerSec advertised streaming rate; also the on-chain accrual cap.
    /// @param signer     ephemeral key (generated in the reader's browser) that
    ///                   will sign vouchers. Compromise is bounded by budget+rate.
    function openSession(uint64 articleId, uint96 budget, uint64 ratePerSec, address signer)
        external
        nonReentrant
        returns (bytes32 id)
    {
        if (!registry.isActive(articleId)) revert ArticleInactive();
        if (budget == 0 || ratePerSec == 0 || signer == address(0)) revert BadParams();

        address author = registry.authorOf(articleId);

        id = keccak256(abi.encode(msg.sender, openCount[msg.sender]++, block.chainid, articleId, address(this)));
        if (sessions[id].reader != address(0)) revert BadParams(); // unreachable in practice

        sessions[id] = Session({
            reader: msg.sender,
            signer: signer,
            author: author,
            budget: budget,
            claimed: 0,
            articleId: articleId,
            startTime: uint64(block.timestamp),
            ratePerSec: ratePerSec,
            open: true
        });

        unchecked {
            articleSessions[articleId] += 1;
        }

        token.safeTransferFrom(msg.sender, address(this), budget);
        emit SessionOpened(id, articleId, msg.sender, author, signer, budget, ratePerSec);
    }

    /// @notice Ratchet the amount streamed to the author up to `cumulativeAmount`.
    /// @dev Permissionless: normally called by the author's collector service.
    ///      Works while the session is live and, once closing, until
    ///      `closeInitiatedAt + challengeWindow`. Accrual is capped at the close
    ///      timestamp during the window, so no post-close voucher can help the
    ///      reader.
    function settle(bytes32 id, uint96 cumulativeAmount, bytes calldata sig) external nonReentrant {
        Session storage s = sessions[id];
        if (!s.open) revert SessionNotOpen();

        uint64 cAt = closeInitiatedAt[id];
        if (cAt != 0 && block.timestamp > uint256(cAt) + challengeWindow) revert ChallengeWindowClosed();

        _verify(id, s.signer, cumulativeAmount, sig);
        _applySettlement(id, s, cumulativeAmount, cAt != 0 ? cAt : block.timestamp);
    }

    /// @notice Phase 1 of closing: freeze accrual and start the challenge window.
    ///         Does NOT refund. Callable by the reader any time, or by anyone once
    ///         `MAX_ACCRUAL_WINDOW` has elapsed (abandoned-session recovery).
    function closeSession(bytes32 id) external nonReentrant {
        Session storage s = sessions[id];
        if (!s.open) revert SessionNotOpen();
        if (closeInitiatedAt[id] != 0) revert AlreadyClosing();

        bool abandoned = block.timestamp >= uint256(s.startTime) + MAX_ACCRUAL_WINDOW;
        if (msg.sender != s.reader && !abandoned) revert NotReader();

        closeInitiatedAt[id] = uint64(block.timestamp);
        emit SessionClosing(id, s.articleId, uint64(block.timestamp));
    }

    /// @notice Phase 2: after the challenge window, refund `budget - claimed` to
    ///         the reader and close the channel. Permissionless.
    function finalizeSession(bytes32 id) external nonReentrant {
        Session storage s = sessions[id];
        if (!s.open) revert SessionNotOpen();

        uint64 cAt = closeInitiatedAt[id];
        if (cAt == 0) revert NotClosing();
        if (block.timestamp <= uint256(cAt) + challengeWindow) revert ChallengeWindowOpen();

        s.open = false; // effects before interactions

        uint96 refund = s.budget - s.claimed;
        uint64 duration = cAt - s.startTime;

        unchecked {
            articleReaderSeconds[s.articleId] += duration;
        }

        if (refund > 0) token.safeTransfer(s.reader, refund);
        emit SessionClosed(id, s.articleId, s.claimed, refund, duration);
    }

    // ---------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------

    function _verify(bytes32 id, address signer, uint256 cumulativeAmount, bytes calldata sig) internal view {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, id, cumulativeAmount)));
        if (ECDSA.recover(digest, sig) != signer) revert BadSignature();
    }

    /// @dev Largest `cumulativeAmount` the rate cap permits, measured to
    ///      `referenceTs` (wall clock while live, the close timestamp once closing).
    function _maxAccrued(Session storage s, uint256 referenceTs) internal view returns (uint256) {
        uint256 endCap = uint256(s.startTime) + MAX_ACCRUAL_WINDOW;
        uint256 nowTs = referenceTs < endCap ? referenceTs : endCap;
        uint256 elapsed = nowTs - s.startTime;
        // +1s slack absorbs clock skew between the signer and the chain.
        return uint256(s.ratePerSec) * (elapsed + 1);
    }

    function _applySettlement(bytes32 id, Session storage s, uint96 cumulativeAmount, uint256 referenceTs) internal {
        if (cumulativeAmount < s.claimed) revert NonMonotonic();
        if (cumulativeAmount > s.budget) revert OverBudget();
        if (cumulativeAmount > _maxAccrued(s, referenceTs)) revert RateExceeded();

        uint96 delta = cumulativeAmount - s.claimed;
        s.claimed = cumulativeAmount; // effects before interactions

        uint96 fee = uint96((uint256(delta) * protocolFeeBps) / 10_000);
        unchecked {
            articleEarned[s.articleId] += delta;
        }

        if (delta > 0) {
            if (fee > 0) token.safeTransfer(treasury, fee);
            token.safeTransfer(s.author, delta - fee);
        }
        emit Settled(id, s.articleId, cumulativeAmount, delta, fee);
    }

    // ---------------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------------

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert BadParams();
        treasury = t;
        emit TreasuryUpdated(t);
    }

    function setProtocolFeeBps(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert BadParams();
        protocolFeeBps = bps;
        emit ProtocolFeeUpdated(bps);
    }

    function setChallengeWindow(uint64 w) external onlyOwner {
        if (w < MIN_CHALLENGE_WINDOW || w > MAX_CHALLENGE_WINDOW) revert BadParams();
        challengeWindow = w;
        emit ChallengeWindowUpdated(w);
    }

    // ---------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------

    /// @notice EIP-712 domain separator, exposed for client-side voucher signing.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Amount currently claimable by the author for `id` given a voucher value.
    function claimableFor(bytes32 id, uint96 cumulativeAmount) external view returns (uint96) {
        Session storage s = sessions[id];
        if (!s.open || cumulativeAmount <= s.claimed) return 0;

        uint64 cAt = closeInitiatedAt[id];
        if (cAt != 0 && block.timestamp > uint256(cAt) + challengeWindow) return 0;

        uint256 capped = cumulativeAmount;
        if (capped > s.budget) capped = s.budget;
        uint256 rateCap = _maxAccrued(s, cAt != 0 ? cAt : block.timestamp);
        if (capped > rateCap) capped = rateCap;
        if (capped <= s.claimed) return 0;
        return uint96(capped - s.claimed);
    }
}
```

## Contract: IArticleRegistry.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IArticleRegistry
/// @notice Minimal surface the AttentionStream contract needs from the registry.
interface IArticleRegistry {
    /// @notice Current author (payout recipient) for an article.
    /// @dev MUST revert for unknown ids so callers cannot open sessions against them.
    function authorOf(uint256 id) external view returns (address);

    /// @notice True if the article exists and has not been retired by its author.
    function isActive(uint256 id) external view returns (bool);
}
```

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Freely-mintable ERC20 for tests and testnet deploys only.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock USD", "mUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Tests: attention.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const CONTENT_HASH = ethers.keccak256(ethers.toUtf8Bytes("the canonical article body"));
const BUDGET = ethers.parseEther("1");
const RATE = 1_000_000_000_000n; // wei per second → "budget seconds" = 1e6
const FEE_BPS = 250n; // 2.5%
const CHALLENGE_WINDOW = 15n * 60n; // contract default, seconds
const PAST_WINDOW = Number(CHALLENGE_WINDOW) + 1;

async function deploy() {
  const [owner, author, reader, treasury, other] = await ethers.getSigners();

  const registry = await (await ethers.getContractFactory("ArticleRegistry")).deploy();
  const token = await (await ethers.getContractFactory("MockERC20")).deploy();
  const stream = await (await ethers.getContractFactory("AttentionStream")).deploy(
    await token.getAddress(),
    await registry.getAddress(),
    treasury.address,
    FEE_BPS,
  );

  await token.mint(reader.address, ethers.parseEther("1000"));
  await token.mint(author.address, ethers.parseEther("1000"));
  await token.connect(reader).approve(await stream.getAddress(), ethers.MaxUint256);
  await token.connect(author).approve(await stream.getAddress(), ethers.MaxUint256);

  await registry.connect(author).publish(CONTENT_HASH, "ipfs://meta");
  const articleId = 1n;

  return { owner, author, reader, treasury, other, registry, token, stream, articleId };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function openSession(stream, reader, articleId, signer) {
  const tx = await stream.connect(reader).openSession(articleId, BUDGET, RATE, signer.address);
  const rc = await tx.wait();
  const ev = rc .logs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((l) => {
      try {
        return stream.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .find((e) => e?.name === "SessionOpened");
  return ev .args.id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function signVoucher(stream, signer, sessionId, cumulativeAmount) {
  const domain = {
    name: "AttentionStream",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await stream.getAddress(),
  };
  const types = {
    Voucher: [
      { name: "sessionId", type: "bytes32" },
      { name: "cumulativeAmount", type: "uint256" },
    ],
  };
  return signer.signTypedData(domain, types, { sessionId, cumulativeAmount });
}

describe("ArticleRegistry", () => {
  it("publishes with incrementing ids and records the author", async () => {
    const { registry, author, other } = await deploy();
    await registry.connect(other).publish(CONTENT_HASH, "ipfs://b");
    expect(await registry.authorOf(1n)).to.equal(author.address);
    expect(await registry.authorOf(2n)).to.equal(other.address);
    expect(await registry.nextId()).to.equal(3n);
  });

  it("rejects an empty content hash", async () => {
    const { registry, author } = await deploy();
    await expect(registry.connect(author).publish(ethers.ZeroHash, "x")).to.be.revertedWithCustomError(
      registry,
      "EmptyContentHash",
    );
  });

  it("only the author can retire or update metadata", async () => {
    const { registry, author, other } = await deploy();
    await expect(registry.connect(other).retire(1n)).to.be.revertedWithCustomError(registry, "NotAuthor");
    await registry.connect(author).retire(1n);
    expect(await registry.isActive(1n)).to.equal(false);
  });
});

describe("AttentionStream", () => {
  it("openSession escrows the budget and rejects bad params", async () => {
    const { stream, reader, token, articleId } = await deploy();
    const key = ethers.Wallet.createRandom();
    const before = await token.balanceOf(await stream.getAddress());
    await openSession(stream, reader, articleId, key);
    expect((await token.balanceOf(await stream.getAddress())) - before).to.equal(BUDGET);

    await expect(stream.connect(reader).openSession(articleId, 0, RATE, key.address)).to.be.revertedWithCustomError(
      stream,
      "BadParams",
    );
    await expect(
      stream.connect(reader).openSession(articleId, BUDGET, RATE, ethers.ZeroAddress),
    ).to.be.revertedWithCustomError(stream, "BadParams");
  });

  it("rejects sessions against a retired article", async () => {
    const { stream, reader, registry, author, articleId } = await deploy();
    await registry.connect(author).retire(articleId);
    const key = ethers.Wallet.createRandom();
    await expect(
      stream.connect(reader).openSession(articleId, BUDGET, RATE, key.address),
    ).to.be.revertedWithCustomError(stream, "ArticleInactive");
  });

  it("settles a valid voucher, paying author minus fee and treasury the fee", async () => {
    const { stream, reader, author, treasury, token, articleId } = await deploy();
    const key = ethers.Wallet.createRandom();
    const id = await openSession(stream, reader, articleId, key);

    await time.increase(120);
    const cumulative = RATE * 100n; // safely under rate cap and budget
    const sig = await signVoucher(stream, key, id, cumulative);

    const authorBefore = await token.balanceOf(author.address);
    const treasuryBefore = await token.balanceOf(treasury.address);

    await stream.settle(id, cumulative, sig);

    const fee = (cumulative * FEE_BPS) / 10_000n;
    expect((await token.balanceOf(author.address)) - authorBefore).to.equal(cumulative - fee);
    expect((await token.balanceOf(treasury.address)) - treasuryBefore).to.equal(fee);
    expect(await stream.articleEarned(articleId)).to.equal(cumulative);
  });

  it("rejects non-monotonic, over-budget, over-rate and mis-signed vouchers", async () => {
    const { stream, reader, articleId } = await deploy();
    const key = ethers.Wallet.createRandom();
    const wrongKey = ethers.Wallet.createRandom();
    const id = await openSession(stream, reader, articleId, key);
    await time.increase(120);

    const base = RATE * 50n;
    await stream.settle(id, base, await signVoucher(stream, key, id, base));

    await expect(
      stream.settle(id, base - 1n, await signVoucher(stream, key, id, base - 1n)),
    ).to.be.revertedWithCustomError(stream, "NonMonotonic");

    const over = BUDGET + 1n;
    await expect(stream.settle(id, over, await signVoucher(stream, key, id, over))).to.be.revertedWithCustomError(
      stream,
      "OverBudget",
    );

    const overRate = RATE * 500_000n; // < budget, >> rate*elapsed
    await expect(
      stream.settle(id, overRate, await signVoucher(stream, key, id, overRate)),
    ).to.be.revertedWithCustomError(stream, "RateExceeded");

    const amt = RATE * 60n;
    await expect(
      stream.settle(id, amt, await signVoucher(stream, wrongKey, id, amt)),
    ).to.be.revertedWithCustomError(stream, "BadSignature");
  });

  // -------------------------------------------------------------------------
  // Two-phase closure
  // -------------------------------------------------------------------------

  it("close -> challenge window -> finalize refunds budget - claimed", async () => {
    const { stream, reader, token, articleId } = await deploy();
    const key = ethers.Wallet.createRandom();
    const id = await openSession(stream, reader, articleId, key);
    await time.increase(120);

    const cumulative = RATE * 90n;
    await stream.settle(id, cumulative, await signVoucher(stream, key, id, cumulative));

    await stream.connect(reader).closeSession(id);
    expect(await stream.closeInitiatedAt(id)).to.be.greaterThan(0n);
    expect((await stream.sessions(id)).open).to.equal(true); // still open during the window

    await expect(stream.finalizeSession(id)).to.be.revertedWithCustomError(stream, "ChallengeWindowOpen");

    await time.increase(PAST_WINDOW);
    const readerBefore = await token.balanceOf(reader.address);
    await stream.finalizeSession(id);

    expect((await token.balanceOf(reader.address)) - readerBefore).to.equal(BUDGET - cumulative);
    expect((await stream.sessions(id)).open).to.equal(false);

    await expect(stream.connect(reader).closeSession(id)).to.be.revertedWithCustomError(stream, "SessionNotOpen");
    await expect(stream.finalizeSession(id)).to.be.revertedWithCustomError(stream, "SessionNotOpen");
  });

  it("collector settles a fresh voucher DURING the window after the reader front-runs closeSession (3.6)", async () => {
    const { stream, reader, author, token, articleId } = await deploy();
    const key = ethers.Wallet.createRandom();
    const id = await openSession(stream, reader, articleId, key);
    await time.increase(300);

    // reader signs a fresh voucher but does NOT settle it, then races a close
    const fresh = RATE * 250n;
    const sig = await signVoucher(stream, key, id, fresh);
    await stream.connect(reader).closeSession(id);

    // collector still gets it in, inside the window, capped at the close time
    const authorBefore = await token.balanceOf(author.address);
    await stream.settle(id, fresh, sig);
    const fee = (fresh * FEE_BPS) / 10_000n;
    expect((await token.balanceOf(author.address)) - authorBefore).to.equal(fresh - fee);
    expect((await stream.sessions(id)).claimed).to.equal(fresh);

    await time.increase(PAST_WINDOW);
    const readerBefore = await token.balanceOf(reader.address);
    await stream.finalizeSession(id);
    expect((await token.balanceOf(reader.address)) - readerBefore).to.equal(BUDGET - fresh);
  });

  it("settle after the challenge window is rejected", async () => {
    const { stream, reader, articleId } = await deploy();
    const key = ethers.Wallet.createRandom();
    const id = await openSession(stream, reader, articleId, key);
    await time.increase(120);
    await stream.connect(reader).closeSession(id);
    await time.increase(PAST_WINDOW);

    const amt = RATE * 100n;
    await expect(
      stream.settle(id, amt, await signVoucher(stream, key, id, amt)),
    ).to.be.revertedWithCustomError(stream, "ChallengeWindowClosed");
  });

  it("a voucher above the frozen close-time cap is rejected even when under budget and the live rate cap (3.5)", async () => {
    const { stream, reader, articleId } = await deploy();
    const key = ethers.Wallet.createRandom();
    const id = await openSession(stream, reader, articleId, key);

    await time.increase(100); // ~100s elapsed
    await stream.connect(reader).closeSession(id); // accrual frozen at ~101s of rate

    await time.increase(500); // live rate cap would now allow ~601s of rate
    const amt = RATE * 300n; // < budget (1e6 s), < live cap (601 s), > frozen cap (~101 s)
    await expect(
      stream.settle(id, amt, await signVoucher(stream, key, id, amt)),
    ).to.be.revertedWithCustomError(stream, "RateExceeded");
  });

  it("double closeSession reverts AlreadyClosing; finalize before close reverts NotClosing", async () => {
    const { stream, reader, articleId } = await deploy();
    const key = ethers.Wallet.createRandom();
    const id = await openSession(stream, reader, articleId, key);

    await expect(stream.finalizeSession(id)).to.be.revertedWithCustomError(stream, "NotClosing");
    await stream.connect(reader).closeSession(id);
    await expect(stream.connect(reader).closeSession(id)).to.be.revertedWithCustomError(stream, "AlreadyClosing");
  });

  it("non-reader cannot close before MAX_ACCRUAL_WINDOW; anyone can after (abandoned recovery)", async () => {
    const { stream, reader, other, token, articleId } = await deploy();
    const key = ethers.Wallet.createRandom();
    const id = await openSession(stream, reader, articleId, key);

    await expect(stream.connect(other).closeSession(id)).to.be.revertedWithCustomError(stream, "NotReader");

    await time.increase(7 * 24 * 60 * 60); // MAX_ACCRUAL_WINDOW
    await stream.connect(other).closeSession(id); // now permissionless
    await time.increase(PAST_WINDOW);

    const readerBefore = await token.balanceOf(reader.address);
    await stream.connect(other).finalizeSession(id); // permissionless; refund still to the reader
    expect((await token.balanceOf(reader.address)) - readerBefore).to.equal(BUDGET);
  });

  it("collector-less reader recovers the full budget with no voucher", async () => {
    const { stream, reader, token, articleId } = await deploy();
    const key = ethers.Wallet.createRandom();
    const id = await openSession(stream, reader, articleId, key);
    await time.increase(200);

    await stream.connect(reader).closeSession(id);
    await time.increase(PAST_WINDOW);
    const before = await token.balanceOf(reader.address);
    await stream.connect(reader).finalizeSession(id);
    expect((await token.balanceOf(reader.address)) - before).to.equal(BUDGET);
  });

  it("self-funded reading is strictly loss-making (fee is burned)", async () => {
    const { stream, registry, token, treasury, author } = await deploy();
    await token.connect(author).approve(await stream.getAddress(), ethers.MaxUint256);
    await registry.connect(author).publish(CONTENT_HASH, "ipfs://self");
    const selfArticle = 2n;

    const key = ethers.Wallet.createRandom();
    const authorStart = await token.balanceOf(author.address);
    const treasuryStart = await token.balanceOf(treasury.address);

    const id = await openSession(stream, author, selfArticle, key);
    await time.increase(120);
    const cumulative = RATE * 100n;
    await stream.settle(id, cumulative, await signVoucher(stream, key, id, cumulative));
    await stream.connect(author).closeSession(id);
    await time.increase(PAST_WINDOW);
    await stream.finalizeSession(id);

    const fee = (cumulative * FEE_BPS) / 10_000n;
    expect((await token.balanceOf(author.address)) - authorStart).to.equal(-fee);
    expect((await token.balanceOf(treasury.address)) - treasuryStart).to.equal(fee);
  });

  it("admin setters are owner-gated and bounded", async () => {
    const { stream, owner, other } = await deploy();
    await expect(stream.connect(other).setProtocolFeeBps(100)).to.be.revertedWithCustomError(
      stream,
      "OwnableUnauthorizedAccount",
    );
    await expect(stream.connect(owner).setProtocolFeeBps(1001)).to.be.revertedWithCustomError(stream, "BadParams");
    await stream.connect(owner).setProtocolFeeBps(500);
    expect(await stream.protocolFeeBps()).to.equal(500n);

    await expect(stream.connect(owner).setChallengeWindow(59)).to.be.revertedWithCustomError(stream, "BadParams");
    await expect(stream.connect(owner).setChallengeWindow(24 * 60 * 60 + 1)).to.be.revertedWithCustomError(
      stream,
      "BadParams",
    );
    await expect(stream.connect(other).setChallengeWindow(1800)).to.be.revertedWithCustomError(
      stream,
      "OwnableUnauthorizedAccount",
    );
    await stream.connect(owner).setChallengeWindow(1800);
    expect(await stream.challengeWindow()).to.equal(1800n);
  });
});
```
