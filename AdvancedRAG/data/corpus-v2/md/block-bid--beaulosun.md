# block-bid--beaulosun

- domain: nft-marketplace (nft-auction-marketplace)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/BeauloSun/BlockBid @ 87ad7e1aeaf6fc5962441216e2146844385077c0
- license: MIT
- targets: BlockBid.sol, nft721.sol
- validation: 29 passing tests, 0 failing; statement coverage BlockBid.sol 98.67 %, nft721.sol 83.33 %

## Contract: BlockBid.sol (primary target)

```solidity
// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

error NotForSale(address nftAddress , uint256 tokenId);
error PriceNotMatched(address _nftAddress , uint256 _tokenId);
error PriceShouldBeGreaterThanZero();
error TheTokenDoesNotBelongToTheSender();
error DoNotHaveApprovalToSellNft();
error AuctionNotEnded();
error BidNotHighest();
error AuctionItemNotExists(uint256 _tokenId);
error UserHaveNoFunds();



contract BlockBid is ReentrancyGuard{
    struct listing721{
        uint256 tokenId;
        address payable owner;
        uint256 price;
    }

    struct auctionListing721{
        uint256 tokenId;
        address payable owner;
        uint256 minPrice;
        uint256 auctionEndTime;
        address highestBidder;
        uint256 highestBid;
        bool ended;
    }

    mapping(uint256 => listing721) nftListed721;
    mapping (uint256 => auctionListing721) auctionNftListed721;
    mapping(uint256 => mapping(address => uint256)) auctionBids;
    mapping (uint256 => address[]) auctionBidders;
    mapping (address => uint256) UserFunds;
    uint256[] ListedTokens721;
    uint256[] ListedAuctionTokens721;

// check if the message sender is the owner
    modifier Owner721(address nftAddress ,uint256 tokenId, address sender){
        IERC721 nft = IERC721(nftAddress);
        if (nft.ownerOf(tokenId) != sender){
            revert TheTokenDoesNotBelongToTheSender();
        }
        _;
    }

// if the token is on sale
    modifier ForSale721(address nftAddress , uint tokenId){
        listing721 memory displayed = nftListed721[tokenId];
        if(displayed.price <= 0){
            revert NotForSale(nftAddress , tokenId);
        }
        _;
    }
    
// check if token is on auctio
    modifier AuctionExists (uint256 _tokenId){
        auctionListing721 memory auctionItem = auctionNftListed721[_tokenId];
        if(auctionItem.tokenId <= 0){
            revert AuctionItemNotExists(_tokenId);
        }
        _;
    }

    function getListedNFT721 ( uint256 _tokenId) public view returns (listing721 memory){
        return nftListed721[_tokenId];
    }

    function getListedTokens () public view returns (uint256 [] memory){
        return ListedTokens721;
    }

    function sellNft721 (address _nftAddress , uint256 _tokenId , uint256 price) external Owner721(_nftAddress , _tokenId ,msg.sender){
        if (price <= 0){
            revert PriceShouldBeGreaterThanZero();
        }

        IERC721 nft = IERC721(_nftAddress);
        if (nft.getApproved(_tokenId) != address(this)){
            revert DoNotHaveApprovalToSellNft();
        }
  
        nftListed721[_tokenId] = listing721(_tokenId, payable(msg.sender) , price);
        ListedTokens721.push(_tokenId);
    }

    function buyNft721 (address _nftAddress , uint256 _tokenId) external payable ForSale721(_nftAddress , _tokenId) nonReentrant{

        listing721 memory item721 = nftListed721[_tokenId];
        
        require(item721.owner != msg.sender , "Owner cannot buy their own NFTs");

        if(msg.value < item721.price){
            revert PriceNotMatched(_nftAddress , _tokenId);
        }


        // transfer the funds to the sellers account
        (bool success, ) = item721.owner.call{value: msg.value}("");
        require(success, "Transfer failed");

        delete (nftListed721[_tokenId]);
       
        uint i = 0;
        while(ListedTokens721[i] != _tokenId){
            i ++;
        } 
        if (i<ListedTokens721.length){
            for (uint j = i ; j < ListedTokens721.length-1 ; j++){
                ListedTokens721[j]= ListedTokens721[j+1];
            }
            ListedTokens721.pop();
        }

        IERC721(_nftAddress).safeTransferFrom(item721.owner, msg.sender, _tokenId);
    }

    function cancelListing721(address _nftAddress , uint256 _tokenId) external Owner721(_nftAddress , _tokenId , msg.sender){
        delete (nftListed721[_tokenId]);
        
        uint i = 0;
        while(ListedTokens721[i] != _tokenId){
            i ++;
        } 
        if (i<ListedTokens721.length){
            for (uint j = i ; j < ListedTokens721.length-1 ; j++){
                ListedTokens721[j]= ListedTokens721[j+1];
            }
            ListedTokens721.pop();
        }
    }

    function auctionNft721(address _nftAddress , uint256 _tokenId ,uint256 minPrice,uint256 auctionduration) external Owner721(_nftAddress , _tokenId , msg.sender){

        uint256 starttime = block.timestamp;
        uint256 endtime = starttime + auctionduration;

        require (block.timestamp < endtime , "Not sufficient time for auction");
        require(minPrice >0 , "minPrice should be greater than 0");

            
        IERC721 nft = IERC721(_nftAddress);
        if (nft.getApproved(_tokenId) != address(this)){
            revert DoNotHaveApprovalToSellNft();
        }

        auctionNftListed721[_tokenId] = auctionListing721(_tokenId , payable(msg.sender) , minPrice , endtime, address(0), 0 , false);
        ListedAuctionTokens721.push(_tokenId);
    }

    function getAuctionEndTime(uint256 _tokenId) external view AuctionExists(_tokenId) returns(uint256) {
        return auctionNftListed721[_tokenId].auctionEndTime;}
    

    function bid( uint256 _tokenId) external payable AuctionExists(_tokenId){

        // check owner should not bid
        auctionListing721 storage auctionItem = auctionNftListed721[_tokenId];
        require(auctionItem.owner != msg.sender  , "Owner cannot bid on their own nft");
        require(block.timestamp < auctionItem.auctionEndTime, "The auction has ended");

        // check the new added value is greater than previous value + new value
        uint256 newTotalBid = auctionBids[_tokenId][msg.sender] + msg.value;
        require(newTotalBid >= auctionItem.minPrice , "The bid is lower than the minimum price");
        require(newTotalBid > auctionItem.highestBid, "There already is a higher bid.");

        // update the bids
        auctionBids[_tokenId][msg.sender] = newTotalBid;

        // update the bidders array if the new bidder does nto exits
        if(!checkBidderExists(_tokenId, msg.sender)){
            auctionBidders[_tokenId].push(msg.sender);
        }

        auctionItem.highestBid = newTotalBid;
        auctionItem.highestBidder = msg.sender;
    }

    function auctionEnd(address _nftAddress, uint256 _tokenId) external {
        auctionListing721 memory auction = auctionNftListed721[_tokenId];

        require(block.timestamp >= auction.auctionEndTime, "Auction not yet ended.");
        //require(!auction.ended, "AuctionEnd has already been called.");

        auction.ended = true;
        address[] memory bidders = auctionBidders[_tokenId];

        if (bidders.length <= 0){
            delete auctionBidders[_tokenId];
            delete auctionNftListed721[_tokenId];


        }else{
                    // transfer all the money to the seller's fund
            if(auctionBids[_tokenId][auction.highestBidder] == auction.highestBid){
                UserFunds[auction.owner] += auctionBids[_tokenId][auction.highestBidder];
                auctionBids[_tokenId][auction.highestBidder] = 0;
            }
            // transfer the money to all the bidders fund
            for(uint256 j = 0 ; j < bidders.length; j++){
                UserFunds[bidders[j]] += auctionBids[_tokenId][bidders[j]];
                delete auctionBids[_tokenId][bidders[j]];
            }

            
            delete auctionBidders[_tokenId];
            IERC721(_nftAddress).safeTransferFrom(auction.owner, auction.highestBidder, _tokenId);
            delete auctionNftListed721[_tokenId];

        }
        uint i = 0;
        while(ListedAuctionTokens721[i] != _tokenId){
            i ++;
        } 
        if (i<ListedAuctionTokens721.length){
            for (uint k = i ; k < ListedAuctionTokens721.length-1 ; k++){
                ListedAuctionTokens721[k]= ListedAuctionTokens721[k+1];
            }
            ListedAuctionTokens721.pop();
        }

    }

    function getListedAuctionTokens721() public view returns (uint256 [] memory){
        return ListedAuctionTokens721;
    }

    function getTheBidDifference(uint256 _tokenId, address currUser) external view returns (uint256){
         auctionListing721 storage auctionItem = auctionNftListed721[_tokenId];

         if(!checkBidderExists(_tokenId, currUser)){
            return auctionItem.highestBid;
         }
         return auctionItem.highestBid - auctionBids[_tokenId][currUser];
    }

    function getBiddersLastBid(uint256 _tokenId, address bidder) public view returns(uint256){
        return auctionBids[_tokenId][bidder];
    }

    function getListedAuctionItem721(uint256 _tokenId) public view returns(auctionListing721 memory){
        return auctionNftListed721[_tokenId];

    }

    function getUserFunds(address user) public view returns(uint256){
        return UserFunds[user];
    }


    function getBiddersForNft721(uint256 _tokenId) public view returns (address[] memory ){
        return auctionBidders[_tokenId];
    }

    function getFundBack(address user) external {
        uint256 userfunds = UserFunds[user];
        if(userfunds <= 0){
            revert UserHaveNoFunds();
        }
        UserFunds[user] = 0;
        (bool success , ) = payable(user).call{value:userfunds}("");
        require(success , "There was an error in transferring funds");
    }

    function checkBidderExists(uint256 _tokenId, address bidder) public view returns (bool) {
        address[] storage bidders = auctionBidders[_tokenId];
        for (uint i = 0; i < bidders.length; i++) {
            if (bidders[i] == bidder) {
                return true;
            }
        }
        return false;
    }
    
    
    function updateListing(address _nftAddress, uint256 _tokenId , uint256 price) public Owner721(_nftAddress , _tokenId , msg.sender){
        require(price > 0 , "Price cannot be lower than 0");
        nftListed721[_tokenId].price = price;
    }


}
```

## Contract: nft721.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";


contract nft721 is ERC721URIStorage {
    uint256 private _tokenId;

    event nft721Minted(string tokenURI, uint256 _tokenId);

    constructor() ERC721("BlockBid", "BBT") {
        _tokenId = 1;
    }

    function mintNft(address owner, string memory tokenURI) external returns (uint256) {
        _safeMint(owner, _tokenId);
        _setTokenURI(_tokenId, tokenURI);
        _tokenId = _tokenId + 1;
        emit nft721Minted(tokenURI, _tokenId);
        return _tokenId;
    }

    // get the tokenid
    function getTokenId() public view returns(uint256){
        return _tokenId;
    }

    function burnToken(uint tokenId) external virtual{
        return _burn(tokenId);
    }

    function getOwnerNFTs(address owner) public view returns (uint256[] memory) {
        uint256[] memory ownerNFTs = new uint256[](balanceOf(owner));
        uint256 count = 0;
        for (uint256 i = 1; i < _tokenId; i++) {
            if (_ownerOf(i)!= address(0)) {
                if (_ownerOf(i) == owner) {
                    ownerNFTs[count] = i;
                    count++;
                }
            }

        }
        return ownerNFTs;
    }
}
```

## Tests: 02-blockbid-test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BlockBid", function () {
  let NFT721;
  let BLOCKBID;
  let nft721;
  let blockbid;
  let owner;
  let addr1;
  let addr2;
  let addr3;

  beforeEach(async function () {
    BLOCKBID = await ethers.getContractFactory("BlockBid");
    NFT721 = await ethers.getContractFactory("nft721");
    [owner, addr1, addr2, addr3] = await ethers.getSigners();
    nft721 = await NFT721.deploy();
    blockbid = await BLOCKBID.deploy();
  });

  describe("Sell an NFT", function () {
    it("Should be reverted if sender is not the owner", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      await expect(
        blockbid.connect(addr2).sellNft721(nft721.target, tokenId, price)
      ).to.be.revertedWithCustomError(
        blockbid,
        "TheTokenDoesNotBelongToTheSender"
      );
    });

    it("Should be reverted if price is lower than 0", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("0");
      await expect(
        blockbid.connect(addr1).sellNft721(nft721.target, tokenId, price)
      ).to.be.revertedWithCustomError(blockbid, "PriceShouldBeGreaterThanZero");
    });

    it("Should be reverted if approval not granted", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      const price = ethers.parseEther("1");
      await expect(
        blockbid.connect(addr1).sellNft721(nft721.target, tokenId, price)
      ).to.be.revertedWithCustomError(blockbid, "DoNotHaveApprovalToSellNft");
    });

    it("Should be able to sell a Token", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      await blockbid.connect(addr1).sellNft721(nft721.target, tokenId, price);
      const listing = await blockbid.connect(addr1).getListedNFT721(tokenId);
      expect(listing.owner).to.equal(addr1.address);
      expect(listing.tokenId).to.equal(tokenId);
    });
  });

  describe("Buy an NFT", function () {
    it("Should not be able to buy the NFT if not for sale", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      await expect(
        blockbid.connect(addr2).buyNft721(nft721.target, tokenId)
      ).to.revertedWithCustomError(blockbid, "NotForSale");
    });

    it("Owners cannot buy their own NFT", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      await blockbid.connect(addr1).sellNft721(nft721.target, tokenId, price);
      await expect(
        blockbid.connect(addr1).buyNft721(nft721.target, tokenId)
      ).to.revertedWith("Owner cannot buy their own NFTs");
    });

    it("Revert the transaction if Buyer does not match the NFT price", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      const msgValue = ethers.parseEther("0.5");
      await blockbid.connect(addr1).sellNft721(nft721.target, tokenId, price);
      await expect(
        blockbid
          .connect(addr2)
          .buyNft721(nft721.target, tokenId, { value: msgValue })
      ).to.revertedWithCustomError(blockbid, "PriceNotMatched");
    });

    it("Buyer should be able to buy the NFT", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      const msgValue = ethers.parseEther("1");
      await blockbid.connect(addr1).sellNft721(nft721.target, tokenId, price);
      const ListedTokensBefore = await blockbid
        .connect(owner)
        .getListedTokens();
      expect(ListedTokensBefore.length).to.equal(1);
      await blockbid
        .connect(addr2)
        .buyNft721(nft721.target, tokenId, { value: msgValue });
      const newOwner = await nft721.connect(addr2).ownerOf(tokenId);
      const ListedTokensAfter = await blockbid.connect(owner).getListedTokens();
      expect(ListedTokensAfter.length).to.equal(0);
      expect(newOwner).to.equal(addr2.address);
    });
  });

  describe("Cancel a NFT Listing", function () {
    it("Non Owner should not be able to cancel listing", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      await blockbid.connect(addr1).sellNft721(nft721.target, tokenId, price);
      const ListedTokensBefore = await blockbid
        .connect(owner)
        .getListedTokens();
      expect(ListedTokensBefore.length).to.equal(1);
      await expect(
        blockbid.connect(addr2).cancelListing721(nft721.target, tokenId)
      ).to.revertedWithCustomError(
        blockbid,
        "TheTokenDoesNotBelongToTheSender"
      );
    });
    it("Owner should be able to cancel the listing", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      await blockbid.connect(addr1).sellNft721(nft721.target, tokenId, price);
      const ListedTokensBefore = await blockbid
        .connect(owner)
        .getListedTokens();
      expect(ListedTokensBefore.length).to.equal(1);
      await blockbid.connect(addr1).cancelListing721(nft721.target, tokenId);
      const Owner = await nft721.connect(owner).ownerOf(tokenId);
      const ListedTokensAfter = await blockbid.connect(owner).getListedTokens();
      expect(ListedTokensAfter.length).to.equal(0);
      expect(Owner).to.equal(addr1.address);
    });
  });

  describe("Auction an NFT", function () {
    it("Revert if user is not owner", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      await expect(
        blockbid.connect(addr2).auctionNft721(nft721.target, tokenId, price, 20)
      ).to.revertedWithCustomError(
        blockbid,
        "TheTokenDoesNotBelongToTheSender"
      );
    });

    it("Revert if duration condition is not met", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      await expect(
        blockbid.connect(addr1).auctionNft721(nft721.target, tokenId, price, 0)
      ).to.revertedWith("Not sufficient time for auction");
    });

    it("Revert if price is less than or equal to 0", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("0");
      await expect(
        blockbid.connect(addr1).auctionNft721(nft721.target, tokenId, price, 30)
      ).to.revertedWith("minPrice should be greater than 0");
    });

    it("Revert if not approved by the owner", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      const price = ethers.parseEther("1");
      await expect(
        blockbid.connect(addr1).auctionNft721(nft721.target, tokenId, price, 30)
      ).to.revertedWithCustomError(blockbid, "DoNotHaveApprovalToSellNft");
    });

    it("User should be able to list the NFT for Auction", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      await blockbid
        .connect(addr1)
        .auctionNft721(nft721.target, tokenId, price, 30);
      const AuctionListing = await blockbid
        .connect(owner)
        .getListedAuctionItem721(tokenId);
      expect(AuctionListing.owner).to.equal(addr1.address);
      expect(AuctionListing.minPrice).to.equal(price);
      const ListedAuctionTokens = await blockbid
        .connect(owner)
        .getListedAuctionTokens721();
      expect(ListedAuctionTokens.length).to.equal(1);
    });
  });

  describe("Bid on an Auctioned NFT", function () {
    it("Check if the auction exists", async function () {
      const price = ethers.parseEther("1");
      expect(
        blockbid.connect(owner).bid(1, { value: price })
      ).to.revertedWithCustomError(blockbid, "AuctionItemNotExists");
    });

    it("Owner cannot bid on their own auction NFT", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      const bidPrice = ethers.parseEther("1.2");
      await blockbid
        .connect(addr1)
        .auctionNft721(nft721.target, tokenId, price, 20);
      expect(
        blockbid.connect(addr1).bid(tokenId, { value: bidPrice })
      ).to.revertedWith("Owner cannot bid on their own nft");
    });

    it("Buyers should bid more than the minimum price", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      const bidPrice = ethers.parseEther("0.9");
      await blockbid
        .connect(addr1)
        .auctionNft721(nft721.target, tokenId, price, 20);
      expect(
        blockbid.connect(addr2).bid(tokenId, { value: bidPrice })
      ).to.revertedWith("The bid is lower than the minimum price");
    });

    it("Buyers should bid more than the highest bid", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      const bidPrice = ethers.parseEther("1.5");
      const bidPrice1 = ethers.parseEther("1.1");
      await blockbid
        .connect(addr1)
        .auctionNft721(nft721.target, tokenId, price, 20);
      await blockbid.connect(addr2).bid(tokenId, { value: bidPrice });
      expect(
        blockbid.connect(addr3).bid(tokenId, { value: bidPrice1 })
      ).to.revertedWith("There already is a higher bid.");
    });

    it("Check if the Auction function is working well", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      const bidPrice = ethers.parseEther("1.5");
      const bidPrice1 = ethers.parseEther("1.6");
      await blockbid
        .connect(addr1)
        .auctionNft721(nft721.target, tokenId, price, 20);
      await blockbid.connect(addr2).bid(tokenId, { value: bidPrice });
      const auctionItem = await blockbid
        .connect(addr2)
        .getListedAuctionItem721(tokenId);
      expect(bidPrice).to.equal(auctionItem.highestBid);
      expect(addr2.address).to.equal(auctionItem.highestBidder);

      await blockbid.connect(addr3).bid(tokenId, { value: bidPrice1 });
      const auctionItem1 = await blockbid
        .connect(addr3)
        .getListedAuctionItem721(tokenId);
      expect(bidPrice1).to.equal(auctionItem1.highestBid);
      expect(addr3.address).to.equal(auctionItem1.highestBidder);
    });
  });

  describe("End An Auction", function () {
    it("Auction should not end before auction end Time", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      const bidPrice = ethers.parseEther("1.5");
      const bidPrice1 = ethers.parseEther("1.6");
      await blockbid
        .connect(addr1)
        .auctionNft721(nft721.target, tokenId, price, 4);
      await blockbid.connect(addr2).bid(tokenId, { value: bidPrice });
      await blockbid.connect(addr3).bid(tokenId, { value: bidPrice1 });

      await expect(
        blockbid.connect(owner).auctionEnd(nft721.target, tokenId)
      ).to.revertedWith("Auction not yet ended.");
    });

    it("If there are not bidders nothing should happen", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      await blockbid
        .connect(addr1)
        .auctionNft721(nft721.target, tokenId, price, 1);

      const listedTokens = await blockbid
        .connect(owner)
        .getListedAuctionTokens721();
      expect(listedTokens.length).to.equal(1);

      await blockbid.connect(owner).auctionEnd(nft721.target, tokenId);
      const ownerNFTs1 = await nft721.getOwnerNFTs(addr1.address);
      const listedTokens1 = await blockbid
        .connect(owner)
        .getListedAuctionTokens721();
      expect(listedTokens1.length).to.equal(0);
      expect(ownerNFTs1.length).to.equal(1);
    });

    it("Check the function works well  if there are bidders", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      const bidPrice = ethers.parseEther("1.5");
      const bidPrice1 = ethers.parseEther("1.6");
      await blockbid
        .connect(addr1)
        .auctionNft721(nft721.target, tokenId, price, 3);
      await blockbid.connect(addr2).bid(tokenId, { value: bidPrice });
      await blockbid.connect(addr3).bid(tokenId, { value: bidPrice1 });
      await blockbid.connect(owner).auctionEnd(nft721.target, tokenId);

      // check that owner fund got updated
      const ownerFund = await blockbid
        .connect(owner)
        .getUserFunds(addr1.address);
      expect(ownerFund).to.equal(bidPrice1);

      // check that the money went back to the user fund if they did not win the auction
      const userFund = await blockbid
        .connect(owner)
        .getUserFunds(addr2.address);
      expect(userFund).to.equal(bidPrice);

      // check that transfer was made
      const ownerNFTs3 = await nft721.getOwnerNFTs(addr3.address);
      const tokenId3 = ownerNFTs3[0];
      expect(tokenId).to.equal(tokenId3);
    });

    it("Check the funds are transfered to the User", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      const bidPrice = ethers.parseEther("1.5");
      const bidPrice1 = ethers.parseEther("1.6");
      await blockbid
        .connect(addr1)
        .auctionNft721(nft721.target, tokenId, price, 3);
      await blockbid.connect(addr2).bid(tokenId, { value: bidPrice });
      await blockbid.connect(addr3).bid(tokenId, { value: bidPrice1 });
      await blockbid.connect(owner).auctionEnd(nft721.target, tokenId);

      // check that owner fund got updated
      const ownerFund = await blockbid
        .connect(owner)
        .getUserFunds(addr1.address);
      expect(ownerFund).to.equal(bidPrice1);

      // check if the funds were transfered back to user
      await blockbid.connect(owner).getFundBack(addr1.address);
      const ownerFundAfter = await blockbid
        .connect(owner)
        .getUserFunds(addr1.address);
      expect(ownerFundAfter).to.equal(0);
      await expect(
        blockbid.connect(owner).getFundBack(addr3.address)
      ).to.revertedWithCustomError(blockbid, "UserHaveNoFunds");
    });
  });

  describe("Test for Getter functions", function () {
    it("Get Auction End Time", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      const bidPrice = ethers.parseEther("1.2");
      await blockbid
        .connect(addr1)
        .auctionNft721(nft721.target, tokenId, price, 20);
      const auctionItem = await blockbid
        .connect(addr1)
        .getListedAuctionItem721(tokenId);
      const endTime = await blockbid.connect(addr1).getAuctionEndTime(tokenId);
      expect(endTime).to.equal(auctionItem.auctionEndTime);
    });

    it("Get Listed Auction Tokens", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      await nft721.connect(addr2).mintNft(addr2.address, "tokenURI2");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      const ownerNFTs2 = await nft721.getOwnerNFTs(addr2.address);
      const tokenId2 = ownerNFTs2[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      await nft721.connect(addr2).approve(blockbid.target, tokenId2);
      const price = ethers.parseEther("1");
      const price2 = ethers.parseEther("1.2");
      await blockbid
        .connect(addr1)
        .auctionNft721(nft721.target, tokenId, price, 20);

      await blockbid
        .connect(addr2)
        .auctionNft721(nft721.target, tokenId2, price2, 100);

      const listedTokens = await blockbid
        .connect(addr1)
        .getListedAuctionTokens721();
      expect(listedTokens.length).to.equal(2);
    });

    it("Get the bid Difference", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      const bidPrice = ethers.parseEther("1.1");
      const bidPrice1 = ethers.parseEther("1.5");
      const bidDifference = ethers.parseEther("0.4");
      await blockbid
        .connect(addr1)
        .auctionNft721(nft721.target, tokenId, price, 20);

      await blockbid.connect(addr2).bid(tokenId, { value: bidPrice });

      const bidDiff1 = await blockbid
        .connect(addr1)
        .getTheBidDifference(tokenId, addr3.address);
      expect(bidDiff1).to.equal(bidPrice);
      await blockbid.connect(addr3).bid(tokenId, { value: bidPrice1 });

      const bidDiff2 = await blockbid
        .connect(addr1)
        .getTheBidDifference(tokenId, addr2.address);
      expect(bidDiff2).to.equal(bidDifference);
    });

    it("Get bidders last bid", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      const bidPrice = ethers.parseEther("1.1");
      const bidPrice1 = ethers.parseEther("1.5");
      await blockbid
        .connect(addr1)
        .auctionNft721(nft721.target, tokenId, price, 20);

      await blockbid.connect(addr2).bid(tokenId, { value: bidPrice });
      await blockbid.connect(addr3).bid(tokenId, { value: bidPrice1 });

      const lastBid = await blockbid
        .connect(addr2)
        .getBiddersLastBid(tokenId, addr2.address);
      expect(lastBid).to.equal(bidPrice);
    });

    it("Get all the bidders for a Token", async function () {
      await nft721.connect(addr1).mintNft(addr1.address, "tokenURI1");
      const ownerNFTs = await nft721.getOwnerNFTs(addr1.address);
      const tokenId = ownerNFTs[0];
      await nft721.connect(addr1).approve(blockbid.target, tokenId);
      const price = ethers.parseEther("1");
      const bidPrice = ethers.parseEther("1.1");
      const bidPrice1 = ethers.parseEther("1.5");
      await blockbid
        .connect(addr1)
        .auctionNft721(nft721.target, tokenId, price, 20);

      await blockbid.connect(addr2).bid(tokenId, { value: bidPrice });
      await blockbid.connect(addr3).bid(tokenId, { value: bidPrice1 });

      const bidders = await blockbid
        .connect(addr2)
        .getBiddersForNft721(tokenId);
      expect(bidders.length).to.equal(2);
    });
  });
});
```
