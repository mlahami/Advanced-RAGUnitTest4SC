# gem-auction--rusiruss

- domain: auctions (auction)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/rusiruss/Gem-bid @ 371d1c6f27a1b7eaa415ede975e551f4162a5298
- license: MIT
- targets: GemAuction.sol, BidRejector.sol
- validation: 19 passing tests, 0 failing; statement coverage GemAuction.sol 100.0 %, BidRejector.sol 100.0 %

## Contract: BidRejector.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {GemAuction} from "./GemAuction.sol";

/// @title BidRejector
/// @notice TEST-ONLY helper. A contract that bids through the auction but has no
///         receive/fallback, so it reverts on any incoming ETH. Used to prove that
///         pull-payments isolate the damage: when such a bidder is outbid, its own
///         withdraw() fails — but the auction keeps working for everyone else.
///         (With push-refunds, this same contract could freeze the whole auction.)
contract BidRejector {
    GemAuction public immutable auction;

    constructor(GemAuction _auction) {
        auction = _auction;
    }

    function bid(uint256 gemId) external payable {
        auction.placeBid{value: msg.value}(gemId);
    }

    function withdraw() external {
        auction.withdraw();
    }

    // Deliberately NO receive()/fallback() — this contract cannot accept ETH.
}
```

## Contract: GemAuction.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";

/// @title GemAuction (v2)
/// @notice Time-based auction house where each "gem" IS an ERC-721 NFT
///         (tokenId == gemId), carrying on-chain gemological traits (the 4 Cs)
///         and an ERC-2981 royalty. Listing mints the gem into escrow; it
///         transfers to the winner on settlement (or back to the seller if no
///         bids). Extras in v2: on-chain 4 Cs, a Buy Now price for instant
///         purchase, anti-snipe deadline extension, and creator royalties.
///         All ETH leaves only through {withdraw} (pull-payments) and NFT
///         transfers use the non-callback {_transfer}, so neither a hostile
///         bidder nor a hostile winner can block an auction.
/// @dev    Testnet learning project (Sepolia). NOT audited — no real funds.
contract GemAuction is ERC721URIStorage, ERC2981 {
    // ---------------------------------------------------------------------
    // Types & storage
    // ---------------------------------------------------------------------

    struct Gem {
        address seller;
        uint256 startingPrice;
        uint256 buyNowPrice; // 0 = Buy Now disabled
        uint256 endTime;
        address highestBidder;
        uint256 highestBid;
        bool settled;
    }

    /// @notice The 4 Cs. Indices map to labels off-chain:
    ///  cut     0..4  = Fair, Good, Very Good, Excellent, Ideal
    ///  color   0..22 = D, E, F, ... Z
    ///  clarity 0..10 = FL, IF, VVS1, VVS2, VS1, VS2, SI1, SI2, I1, I2, I3
    struct Traits {
        uint16 caratHundredths; // 150 = 1.50 ct
        uint8 cut;
        uint8 color;
        uint8 clarity;
    }

    /// @notice Parameters for creating a gem (grouped to avoid a huge arg list).
    struct GemInput {
        uint256 startingPrice;
        uint256 duration; // seconds
        uint256 buyNowPrice; // 0 to disable
        uint96 royaltyBps; // e.g. 500 = 5%
        uint16 caratHundredths;
        uint8 cut;
        uint8 color;
        uint8 clarity;
        string uri;
    }

    uint256 public gemCount;
    mapping(uint256 => Gem) public gems;
    mapping(uint256 => Traits) public traits;
    mapping(address => uint256) public pendingReturns;

    uint256 public constant ANTISNIPE_WINDOW = 5 minutes;
    uint256 public constant ANTISNIPE_EXTENSION = 5 minutes;
    uint96 public constant MAX_ROYALTY_BPS = 1000; // 10%

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event GemCreated(uint256 indexed gemId, address indexed seller, uint256 startingPrice, uint256 endTime);
    event BidPlaced(uint256 indexed gemId, address indexed bidder, uint256 amount);
    event AuctionExtended(uint256 indexed gemId, uint256 newEndTime);
    event AuctionSettled(uint256 indexed gemId, address indexed winner, uint256 amount);
    event Withdrawal(address indexed payee, uint256 amount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error InvalidStartingPrice();
    error InvalidDuration();
    error InvalidBuyNowPrice();
    error RoyaltyTooHigh();
    error GemDoesNotExist();
    error BiddingClosed();
    error SellerCannotBid();
    error BidNotHighEnough();
    error BuyNowUnavailable();
    error IncorrectPayment();
    error TooEarlyToSettle();
    error AlreadySettled();
    error NothingToWithdraw();
    error TransferFailed();

    constructor() ERC721("GemBid Gem", "GEM") {}

    // ---------------------------------------------------------------------
    // Listing
    // ---------------------------------------------------------------------

    /// @notice List a new gem. Mints the gem NFT into escrow, records its 4 Cs
    ///         and (optional) royalty, and starts a time-based auction.
    /// @return gemId The auto-incremented id / NFT tokenId.
    function createGem(GemInput calldata input) external returns (uint256 gemId) {
        if (input.startingPrice == 0) revert InvalidStartingPrice();
        if (input.duration == 0) revert InvalidDuration();
        if (input.buyNowPrice != 0 && input.buyNowPrice <= input.startingPrice) revert InvalidBuyNowPrice();
        if (input.royaltyBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();

        gemId = ++gemCount;
        gems[gemId] = Gem({
            seller: msg.sender,
            startingPrice: input.startingPrice,
            buyNowPrice: input.buyNowPrice,
            endTime: block.timestamp + input.duration,
            highestBidder: address(0),
            highestBid: 0,
            settled: false
        });
        traits[gemId] = Traits({
            caratHundredths: input.caratHundredths,
            cut: input.cut,
            color: input.color,
            clarity: input.clarity
        });

        _mint(address(this), gemId);
        _setTokenURI(gemId, input.uri);
        if (input.royaltyBps > 0) {
            _setTokenRoyalty(gemId, msg.sender, input.royaltyBps);
        }

        emit GemCreated(gemId, msg.sender, input.startingPrice, block.timestamp + input.duration);
    }

    // ---------------------------------------------------------------------
    // Bidding
    // ---------------------------------------------------------------------

    /// @notice Place a bid. Must be >= startingPrice AND strictly greater than
    ///         the current highest. A bid in the final window extends the deadline.
    function placeBid(uint256 gemId) external payable {
        Gem storage gem = gems[gemId];
        if (gem.seller == address(0)) revert GemDoesNotExist();
        if (block.timestamp >= gem.endTime) revert BiddingClosed();
        if (msg.sender == gem.seller) revert SellerCannotBid();
        if (msg.value < gem.startingPrice || msg.value <= gem.highestBid) revert BidNotHighEnough();

        // Effects (CEI): credit the outbid bidder (pull), then update the leader.
        if (gem.highestBidder != address(0)) {
            pendingReturns[gem.highestBidder] += gem.highestBid;
        }
        gem.highestBidder = msg.sender;
        gem.highestBid = msg.value;

        // Anti-snipe: extend the deadline if the bid lands in the final window.
        // Safe from underflow: bidding is open, so endTime > block.timestamp here.
        if (gem.endTime - block.timestamp < ANTISNIPE_WINDOW) {
            gem.endTime = block.timestamp + ANTISNIPE_EXTENSION;
            emit AuctionExtended(gemId, gem.endTime);
        }

        emit BidPlaced(gemId, msg.sender, msg.value);
    }

    /// @notice Instantly buy a gem at its Buy Now price, ending the auction now.
    ///         Refunds any current bidder (pull), pays the seller, and transfers
    ///         the NFT to the buyer. Must pay exactly the Buy Now price.
    function buyNow(uint256 gemId) external payable {
        Gem storage gem = gems[gemId];
        if (gem.seller == address(0)) revert GemDoesNotExist();
        if (gem.buyNowPrice == 0) revert BuyNowUnavailable();
        if (gem.settled) revert AlreadySettled();
        if (block.timestamp >= gem.endTime) revert BiddingClosed();
        if (msg.sender == gem.seller) revert SellerCannotBid();
        if (gem.highestBid >= gem.buyNowPrice) revert BuyNowUnavailable(); // auction already passed it
        if (msg.value != gem.buyNowPrice) revert IncorrectPayment();

        // Effects (CEI) before the NFT move.
        gem.settled = true;
        if (gem.highestBidder != address(0)) {
            pendingReturns[gem.highestBidder] += gem.highestBid; // refund the outbid bidder
        }
        gem.highestBidder = msg.sender;
        gem.highestBid = msg.value;
        pendingReturns[gem.seller] += msg.value; // seller proceeds

        _transfer(address(this), msg.sender, gemId);

        emit AuctionSettled(gemId, msg.sender, msg.value);
    }

    // ---------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------

    /// @notice Settle after the deadline. Credits the seller, marks sold, and
    ///         transfers the gem NFT to the winner — or returns it to the seller
    ///         if there were no bids. Makes no external ETH transfer.
    function endAuction(uint256 gemId) external {
        Gem storage gem = gems[gemId];
        if (gem.seller == address(0)) revert GemDoesNotExist();
        if (block.timestamp < gem.endTime) revert TooEarlyToSettle();
        if (gem.settled) revert AlreadySettled();

        gem.settled = true;

        address winner = gem.highestBidder;
        if (winner != address(0)) {
            pendingReturns[gem.seller] += gem.highestBid;
            _transfer(address(this), winner, gemId);
        } else {
            _transfer(address(this), gem.seller, gemId);
        }

        emit AuctionSettled(gemId, winner, gem.highestBid);
    }

    // ---------------------------------------------------------------------
    // Withdrawals (the only ETH exit)
    // ---------------------------------------------------------------------

    /// @notice Withdraw all funds owed to the caller (refunds and/or proceeds).
    function withdraw() external {
        uint256 amount = pendingReturns[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingReturns[msg.sender] = 0; // effect before interaction (CEI)

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawal(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Current highest bid and bidder for a gem.
    function getHighestBid(uint256 gemId) external view returns (uint256 highestBid, address highestBidder) {
        Gem storage gem = gems[gemId];
        return (gem.highestBid, gem.highestBidder);
    }

    /// @dev Combine ERC721URIStorage + ERC2981 interface support.
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
```

## Tests: GemAuction.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const DURATION = 3600; // 1 hour
const TOKEN_URI = "ipfs://gembid/ruby.json";

// GemInput builder with sensible defaults.
function input(o = {}) {
  return {
    startingPrice: o.startingPrice ?? ethers.parseEther("1"),
    duration: o.duration ?? DURATION,
    buyNowPrice: o.buyNowPrice ?? 0n,
    royaltyBps: o.royaltyBps ?? 0,
    caratHundredths: o.caratHundredths ?? 150, // 1.50 ct
    cut: o.cut ?? 4, // Ideal
    color: o.color ?? 0, // D
    clarity: o.clarity ?? 2, // VVS1
    uri: o.uri ?? TOKEN_URI,
  };
}

describe("GemAuction v2", function () {
  async function deployFixture() {
    const [seller, alice, bob, carol] = await ethers.getSigners();
    const auction = await ethers.deployContract("GemAuction");
    return { auction, seller, alice, bob, carol };
  }

  async function withGemFixture() {
    const base = await deployFixture();
    await base.auction.connect(base.seller).createGem(input());
    return { ...base, gemId: 1n };
  }

  describe("ERC-721 / ERC-2981 interfaces", function () {
    it("exposes NFT name/symbol and supports ERC-2981", async function () {
      const { auction } = await loadFixture(deployFixture);
      expect(await auction.name()).to.equal("GemBid Gem");
      expect(await auction.symbol()).to.equal("GEM");
      expect(await auction.supportsInterface("0x2a55205a")).to.equal(true); // ERC-2981
      expect(await auction.supportsInterface("0x80ac58cd")).to.equal(true); // ERC-721
    });
  });

  describe("createGem", function () {
    it("assigns ids, mints into escrow, stores traits & royalty", async function () {
      const { auction, seller } = await loadFixture(deployFixture);
      expect(await auction.connect(seller).createGem.staticCall(input())).to.equal(1n);

      await auction.connect(seller).createGem(input({ royaltyBps: 500 }));
      const now = await time.latest();

      const gem = await auction.gems(1);
      expect(gem.seller).to.equal(seller.address);
      expect(gem.startingPrice).to.equal(ethers.parseEther("1"));
      expect(gem.buyNowPrice).to.equal(0n);
      expect(gem.endTime).to.equal(BigInt(now) + BigInt(DURATION));
      expect(gem.settled).to.equal(false);

      // NFT minted into escrow.
      expect(await auction.ownerOf(1)).to.equal(await auction.getAddress());
      expect(await auction.tokenURI(1)).to.equal(TOKEN_URI);

      // Traits stored on-chain.
      const t = await auction.traits(1);
      expect(t.caratHundredths).to.equal(150);
      expect(t.cut).to.equal(4);
      expect(t.color).to.equal(0);
      expect(t.clarity).to.equal(2);

      // ERC-2981 royalty: 5% of 1 ETH = 0.05 ETH, to the seller.
      const [receiver, amount] = await auction.royaltyInfo(1, ethers.parseEther("1"));
      expect(receiver).to.equal(seller.address);
      expect(amount).to.equal(ethers.parseEther("0.05"));
    });

    it("reverts on zero starting price / duration", async function () {
      const { auction, seller } = await loadFixture(deployFixture);
      await expect(auction.connect(seller).createGem(input({ startingPrice: 0 }))).to.be.revertedWithCustomError(
        auction,
        "InvalidStartingPrice"
      );
      await expect(auction.connect(seller).createGem(input({ duration: 0 }))).to.be.revertedWithCustomError(
        auction,
        "InvalidDuration"
      );
    });

    it("reverts when buyNowPrice <= startingPrice", async function () {
      const { auction, seller } = await loadFixture(deployFixture);
      await expect(
        auction.connect(seller).createGem(input({ startingPrice: ethers.parseEther("1"), buyNowPrice: ethers.parseEther("1") }))
      ).to.be.revertedWithCustomError(auction, "InvalidBuyNowPrice");
    });

    it("reverts when royalty exceeds the cap", async function () {
      const { auction, seller } = await loadFixture(deployFixture);
      await expect(auction.connect(seller).createGem(input({ royaltyBps: 1001 }))).to.be.revertedWithCustomError(
        auction,
        "RoyaltyTooHigh"
      );
    });
  });

  describe("placeBid + anti-snipe", function () {
    it("escrows a valid bid and rejects low / seller / closed bids", async function () {
      const { auction, seller, alice, bob } = await loadFixture(withGemFixture);

      await expect(auction.connect(alice).placeBid(1, { value: ethers.parseEther("0.5") })).to.be.revertedWithCustomError(
        auction,
        "BidNotHighEnough"
      );
      await expect(auction.connect(seller).placeBid(1, { value: ethers.parseEther("1") })).to.be.revertedWithCustomError(
        auction,
        "SellerCannotBid"
      );

      await auction.connect(alice).placeBid(1, { value: ethers.parseEther("1") });
      await expect(auction.connect(bob).placeBid(1, { value: ethers.parseEther("1") })).to.be.revertedWithCustomError(
        auction,
        "BidNotHighEnough"
      );

      // outbid → previous bidder credited
      await auction.connect(bob).placeBid(1, { value: ethers.parseEther("1.5") });
      expect(await auction.pendingReturns(alice.address)).to.equal(ethers.parseEther("1"));
    });

    it("does NOT extend the deadline for an early bid", async function () {
      const { auction, alice } = await loadFixture(withGemFixture);
      const before = (await auction.gems(1)).endTime;
      await auction.connect(alice).placeBid(1, { value: ethers.parseEther("1") });
      expect((await auction.gems(1)).endTime).to.equal(before);
    });

    it("extends the deadline for a bid inside the anti-snipe window", async function () {
      const { auction, alice } = await loadFixture(withGemFixture);
      const before = (await auction.gems(1)).endTime;
      // Move to 100s before the end (< 5-minute window).
      await time.increaseTo(Number(before) - 100);

      await expect(auction.connect(alice).placeBid(1, { value: ethers.parseEther("1") })).to.emit(
        auction,
        "AuctionExtended"
      );
      expect((await auction.gems(1)).endTime).to.be.greaterThan(before);
    });

    it("rejects bids after the deadline", async function () {
      const { auction, alice } = await loadFixture(withGemFixture);
      await time.increase(DURATION + 1);
      await expect(auction.connect(alice).placeBid(1, { value: ethers.parseEther("1") })).to.be.revertedWithCustomError(
        auction,
        "BiddingClosed"
      );
    });
  });

  describe("buyNow", function () {
    async function withBuyNow() {
      const base = await deployFixture();
      await base.auction.connect(base.seller).createGem(
        input({ startingPrice: ethers.parseEther("1"), buyNowPrice: ethers.parseEther("5") })
      );
      return base;
    }

    it("instantly settles: pays seller, transfers NFT, marks sold", async function () {
      const { auction, seller, alice } = await withBuyNow();
      const price = ethers.parseEther("5");

      const tx = await auction.connect(alice).buyNow(1, { value: price });
      await expect(tx).to.emit(auction, "AuctionSettled").withArgs(1n, alice.address, price);
      await expect(tx).to.changeEtherBalances([alice, auction], [-price, price]);

      expect((await auction.gems(1)).settled).to.equal(true);
      expect(await auction.ownerOf(1)).to.equal(alice.address);
      expect(await auction.pendingReturns(seller.address)).to.equal(price);
    });

    it("refunds the current highest bidder on Buy Now", async function () {
      const { auction, alice, bob } = await withBuyNow();
      await auction.connect(alice).placeBid(1, { value: ethers.parseEther("2") });
      await auction.connect(bob).buyNow(1, { value: ethers.parseEther("5") });
      expect(await auction.pendingReturns(alice.address)).to.equal(ethers.parseEther("2"));
      expect(await auction.ownerOf(1)).to.equal(bob.address);
    });

    it("reverts on wrong payment, when disabled, for the seller, or once past price", async function () {
      const { auction, seller, alice, bob } = await withBuyNow();

      await expect(auction.connect(alice).buyNow(1, { value: ethers.parseEther("4") })).to.be.revertedWithCustomError(
        auction,
        "IncorrectPayment"
      );
      await expect(auction.connect(seller).buyNow(1, { value: ethers.parseEther("5") })).to.be.revertedWithCustomError(
        auction,
        "SellerCannotBid"
      );

      // A gem without a Buy Now price.
      await auction.connect(seller).createGem(input()); // gemId 2, buyNow disabled
      await expect(auction.connect(alice).buyNow(2, { value: ethers.parseEther("5") })).to.be.revertedWithCustomError(
        auction,
        "BuyNowUnavailable"
      );

      // Once a bid meets/exceeds Buy Now, it's no longer available.
      await auction.connect(bob).placeBid(1, { value: ethers.parseEther("5") });
      await expect(auction.connect(alice).buyNow(1, { value: ethers.parseEther("5") })).to.be.revertedWithCustomError(
        auction,
        "BuyNowUnavailable"
      );
    });

    it("reverts for a non-existent gem, after the deadline, and once settled", async function () {
      const { auction, seller, alice } = await withBuyNow();

      await expect(auction.connect(alice).buyNow(99, { value: ethers.parseEther("5") })).to.be.revertedWithCustomError(
        auction,
        "GemDoesNotExist"
      );

      // Settle via Buy Now, then Buy Now again → AlreadySettled.
      await auction.connect(alice).buyNow(1, { value: ethers.parseEther("5") });
      await expect(auction.connect(alice).buyNow(1, { value: ethers.parseEther("5") })).to.be.revertedWithCustomError(
        auction,
        "AlreadySettled"
      );

      // A fresh gem (gemId 2), past its deadline → BiddingClosed.
      await auction.connect(seller).createGem(input({ buyNowPrice: ethers.parseEther("5"), duration: 100 }));
      await time.increase(101);
      await expect(auction.connect(alice).buyNow(2, { value: ethers.parseEther("5") })).to.be.revertedWithCustomError(
        auction,
        "BiddingClosed"
      );
    });
  });

  describe("withdraw", function () {
    it("lets an outbid bidder pull funds; reverts when nothing owed", async function () {
      const { auction, alice, bob, carol } = await loadFixture(withGemFixture);
      await auction.connect(alice).placeBid(1, { value: ethers.parseEther("1") });
      await auction.connect(bob).placeBid(1, { value: ethers.parseEther("1.5") });

      await expect(auction.connect(alice).withdraw()).to.changeEtherBalances(
        [alice, auction],
        [ethers.parseEther("1"), ethers.parseEther("-1")]
      );
      await expect(auction.connect(carol).withdraw()).to.be.revertedWithCustomError(auction, "NothingToWithdraw");
    });
  });

  describe("endAuction", function () {
    it("reverts early / non-existent / twice", async function () {
      const { auction, seller } = await loadFixture(withGemFixture);
      await expect(auction.connect(seller).endAuction(1)).to.be.revertedWithCustomError(auction, "TooEarlyToSettle");
      await expect(auction.connect(seller).endAuction(99)).to.be.revertedWithCustomError(auction, "GemDoesNotExist");
      await time.increase(DURATION + 1);
      await auction.connect(seller).endAuction(1);
      await expect(auction.connect(seller).endAuction(1)).to.be.revertedWithCustomError(auction, "AlreadySettled");
    });

    it("transfers the NFT to the winner and credits the seller", async function () {
      const { auction, seller, alice } = await loadFixture(withGemFixture);
      const bid = ethers.parseEther("2");
      await auction.connect(alice).placeBid(1, { value: bid });
      await time.increase(DURATION + 1);

      await expect(auction.connect(alice).endAuction(1)).to.emit(auction, "AuctionSettled").withArgs(1n, alice.address, bid);
      expect(await auction.ownerOf(1)).to.equal(alice.address);
      expect(await auction.pendingReturns(seller.address)).to.equal(bid);
    });

    it("returns the NFT to the seller when there were no bids", async function () {
      const { auction, seller } = await loadFixture(withGemFixture);
      await time.increase(DURATION + 1);
      await auction.connect(seller).endAuction(1);
      expect(await auction.ownerOf(1)).to.equal(seller.address);
    });
  });

  describe("security: pull-payment isolates a rejecting bidder", function () {
    it("a rejecting bidder's own withdraw reverts; the auction is unharmed", async function () {
      const { auction, seller, bob } = await loadFixture(withGemFixture);
      const rejector = await ethers.deployContract("BidRejector", [await auction.getAddress()]);
      await rejector.bid(1, { value: ethers.parseEther("1") });
      await auction.connect(bob).placeBid(1, { value: ethers.parseEther("1.5") });

      await expect(rejector.withdraw()).to.be.revertedWithCustomError(auction, "TransferFailed");

      await time.increase(DURATION + 1);
      await auction.connect(seller).endAuction(1);
      expect(await auction.ownerOf(1)).to.equal(bob.address);
    });
  });

  describe("invariant: solvency", function () {
    it("balance == sum(pendingReturns) + live highestBid; drains to 0 after settle+withdraws", async function () {
      const { auction, seller, alice, bob, carol } = await loadFixture(withGemFixture);
      await auction.connect(alice).placeBid(1, { value: ethers.parseEther("1") });
      await auction.connect(bob).placeBid(1, { value: ethers.parseEther("1.5") });
      await auction.connect(carol).placeBid(1, { value: ethers.parseEther("2") });

      const bal = await ethers.provider.getBalance(await auction.getAddress());
      const owed =
        (await auction.pendingReturns(alice.address)) +
        (await auction.pendingReturns(bob.address)) +
        (await auction.pendingReturns(carol.address)) +
        (await auction.pendingReturns(seller.address));
      const [highestBid] = await auction.getHighestBid(1);
      expect(bal).to.equal(owed + highestBid);

      await time.increase(DURATION + 1);
      await auction.connect(seller).endAuction(1);
      await auction.connect(alice).withdraw();
      await auction.connect(bob).withdraw();
      await auction.connect(seller).withdraw();
      expect(await ethers.provider.getBalance(await auction.getAddress())).to.equal(0n);
    });
  });
});
```
