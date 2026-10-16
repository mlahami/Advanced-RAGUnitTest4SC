// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ArecaAuction {
    struct Auction {
        address payable seller;
        uint256 basePrice;
        uint256 highestBid;
        address highestBidder;
        uint64  endTime;
        bool    closed;
        bool    cancelled;
        bool    exists;
    }

    // anti-snipe: bids in last ANTISNIPE_WINDOW seconds push endTime forward
    uint64 public constant ANTISNIPE_WINDOW = 30;
    uint64 public constant ANTISNIPE_EXTEND = 30;

    uint256 public nextId;
    mapping(uint256 => Auction) public auctions;
    mapping(address => uint256) public pendingReturns;

    event AuctionCreated  (uint256 indexed id, address indexed seller, uint256 basePrice, uint64 endTime);
    event BidPlaced       (uint256 indexed id, address indexed bidder, uint256 amount);
    event AuctionExtended (uint256 indexed id, uint64 newEndTime);
    event AuctionClosed   (uint256 indexed id, address indexed winner, uint256 amount);
    event AuctionCancelled(uint256 indexed id, address indexed seller);
    event Withdrawn       (address indexed who, uint256 amount);

    function createAuction(uint256 basePrice, uint64 endTime) external returns (uint256 id) {
        require(endTime > block.timestamp, "end in past");
        id = ++nextId;
        auctions[id] = Auction({
            seller: payable(msg.sender),
            basePrice: basePrice,
            highestBid: 0,
            highestBidder: address(0),
            endTime: endTime,
            closed: false,
            cancelled: false,
            exists: true
        });
        emit AuctionCreated(id, msg.sender, basePrice, endTime);
    }

    function placeBid(uint256 id) external payable {
        Auction storage a = auctions[id];
        require(a.exists, "no auction");
        require(!a.closed, "closed");
        require(!a.cancelled, "cancelled");
        require(block.timestamp < a.endTime, "ended");
        require(msg.sender != a.seller, "seller cannot bid");

        uint256 minRequired = a.highestBid == 0 ? a.basePrice : a.highestBid + 1;
        require(msg.value >= minRequired, "bid too low");

        if (a.highestBidder != address(0)) {
            pendingReturns[a.highestBidder] += a.highestBid;
        }
        a.highestBid = msg.value;
        a.highestBidder = msg.sender;

        emit BidPlaced(id, msg.sender, msg.value);

        // anti-snipe: if bid lands in last ANTISNIPE_WINDOW seconds, extend
        uint64 nowTs = uint64(block.timestamp);
        if (a.endTime - nowTs < ANTISNIPE_WINDOW) {
            a.endTime = nowTs + ANTISNIPE_EXTEND;
            emit AuctionExtended(id, a.endTime);
        }
    }

    function closeAuction(uint256 id) external {
        Auction storage a = auctions[id];
        require(a.exists, "no auction");
        require(!a.closed, "already closed");
        require(!a.cancelled, "cancelled");
        require(block.timestamp >= a.endTime, "not yet");
        a.closed = true;
        if (a.highestBidder != address(0)) {
            (bool ok, ) = a.seller.call{value: a.highestBid}("");
            require(ok, "seller transfer failed");
        }
        emit AuctionClosed(id, a.highestBidder, a.highestBid);
    }

    /// seller cancels an auction that has no bids yet. closed/already-cancelled
    /// auctions cannot be cancelled. all auctions with at least one bid must run
    /// to completion to protect bidders.
    function cancelAuction(uint256 id) external {
        Auction storage a = auctions[id];
        require(a.exists, "no auction");
        require(msg.sender == a.seller, "only seller");
        require(!a.closed, "already closed");
        require(!a.cancelled, "already cancelled");
        require(a.highestBidder == address(0), "has bids");
        a.cancelled = true;
        emit AuctionCancelled(id, msg.sender);
    }

    function withdraw() external {
        uint256 amount = pendingReturns[msg.sender];
        require(amount > 0, "nothing to withdraw");
        pendingReturns[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "withdraw failed");
        emit Withdrawn(msg.sender, amount);
    }

    function getAuction(uint256 id) external view returns (
        address seller,
        uint256 basePrice,
        uint256 highestBid,
        address highestBidder,
        uint64  endTime,
        bool    closed,
        bool    cancelled
    ) {
        Auction storage a = auctions[id];
        require(a.exists, "no auction");
        return (a.seller, a.basePrice, a.highestBid, a.highestBidder, a.endTime, a.closed, a.cancelled);
    }
}
