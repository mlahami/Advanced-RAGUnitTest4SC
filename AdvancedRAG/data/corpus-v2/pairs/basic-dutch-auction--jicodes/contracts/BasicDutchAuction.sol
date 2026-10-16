// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

// Uncomment this line to use console.log
// import "hardhat/console.sol";

contract BasicDutchAuction {
    address payable public seller;
    uint256 public reservePrice;
    uint256 public numBlocksAuctionOpen;
    uint256 public offerPriceDecrement;
    uint256 public initialPrice;
    uint256 public startBlock;
    bool public isEnded;
    address public winner;

    modifier isOpenning() {
        require(!isEnded, "Auction has ended");
        _; 
    }

    constructor(
        uint256 _reservePrice,
        uint256 _numBlocksAuctionOpen,
        uint256 _offerPriceDecrement
    ) {
        seller = payable(msg.sender);
        reservePrice = _reservePrice;
        numBlocksAuctionOpen = _numBlocksAuctionOpen;
        offerPriceDecrement = _offerPriceDecrement;
        initialPrice = reservePrice + numBlocksAuctionOpen * offerPriceDecrement;
        startBlock = block.number;
        isEnded = false;
    }

    function bid() public payable isOpenning returns (address) {
        require(block.number < startBlock + numBlocksAuctionOpen, "Auction expired");
        require(msg.value >= reservePrice, "Bid should be no less than the reserve price");
        require(msg.value >= currentPrice(), "Bid should be no less than the current price");
                
        winner = msg.sender;
        finalize(currentPrice());
        return winner;
    }

    function currentPrice() public view returns (uint256) {
        uint256 elapsedBlocks = block.number - startBlock;
        return initialPrice - elapsedBlocks * offerPriceDecrement;
    }

    function finalize(uint256 finalAuctionPrice) internal {
        isEnded = true;
        
        seller.transfer(finalAuctionPrice);

    }
}