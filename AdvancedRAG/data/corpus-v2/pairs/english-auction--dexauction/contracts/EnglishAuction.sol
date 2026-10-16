// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

// Interface for interacting with an ERC721 RWA contract
interface IERC721 {
    function safeTransferFrom(address from, address to, uint256 tokenId)
        external;
    function transferFrom(address, address, uint256) external;
}

// Contract for conducting an English Auction for an RWA
contract EnglishAuction {

    // Events emitted during various stages of the auction
    event Start();
    event Bid(address indexed sender, uint256 amount);
    event Withdraw(address indexed bidder, uint256 amount);
    event End(address winner, uint256 amount);

    // RWA contract and token ID being auctioned
    IERC721 public rwa_contract;
    uint256 public rwaId;

    // Auction-related variables
    address payable public seller;
    uint256 public endAt;
    bool public started;
    bool public ended;
    uint256 public auctionDuration;

    // Bid-related variables
    address public highestBidder;
    uint256 public highestBid;
    mapping(address => uint256) public bids;

    constructor(address _rwa_contract, uint256 _rwaId, uint256 _startingBid, uint256 _auctionDuration) {
        rwa_contract = IERC721(_rwa_contract);
        rwaId = _rwaId;

        seller = payable(msg.sender);   // Set the seller as the deployer of the contract
        highestBid = _startingBid;
        auctionDuration = _auctionDuration;
    }

    // Function to start the auction
    function start() external {
        require(!started, "started"); // Ensure the auction hasn't started yet
        require(msg.sender == seller, "not seller"); // Only the seller can start the auction

        rwa_contract.transferFrom(msg.sender, address(this), rwaId);  // Transfer the RWA to the auction contract
        started = true;
        endAt = block.timestamp + auctionDuration; // Set the auction end time

        emit Start();
    }

    // Function to place a bid
    function bid() external payable {
        require(started, "not started");  // Ensure the auction has started
        require(block.timestamp < endAt, "ended"); // Ensure the auction hasn't ended
        require(msg.value > highestBid, "value < highest"); // Ensure the bid is higher than the current highest bid

        if (highestBidder != address(0)) {
            bids[highestBidder] += highestBid;
        }

        highestBidder = msg.sender;  // Set the new highest bidder
        highestBid = msg.value; // Set the new highest bid

        emit Bid(msg.sender, msg.value);
    }

    // Function to withdraw a previous bid
    function withdraw() external {
        uint256 bal = bids[msg.sender];
        require(bal > 0, "balance is zero");
        bids[msg.sender] = 0;
        payable(msg.sender).transfer(bal); // Transfer the balance to the callerc

        emit Withdraw(msg.sender, bal);
    }

    // Function to end the auction
    function end() external {
        require(started, "not started");  // Ensure the auction has started
        require(block.timestamp >= endAt, "not ended");  // Ensure the auction end time has passed
        require(!ended, "ended"); // Ensure the auction hasn't already ended
        require(msg.sender == seller, "Unauthorized: not seller"); // Only the seller can end the auction
        ended = true;
        if (highestBidder != address(0)) {
            rwa_contract.safeTransferFrom(address(this), highestBidder, rwaId); // Transfer the RWA to the highest bidder
            seller.transfer(highestBid); // Transfer the highest bid amount to the seller
        } else {
            rwa_contract.safeTransferFrom(address(this), seller, rwaId);  // Return the RWA to the seller if there are no bids
        }

        emit End(highestBidder, highestBid);
    }
}
