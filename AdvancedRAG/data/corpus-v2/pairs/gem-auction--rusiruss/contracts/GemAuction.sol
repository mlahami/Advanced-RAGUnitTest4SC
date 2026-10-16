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
