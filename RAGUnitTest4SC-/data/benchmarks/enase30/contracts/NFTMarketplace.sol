// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

//NFT Marketplace â€” ERC721 mint, list, buy, royalty distribution
interface IERC721 {
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
    function getApproved(uint256 tokenId) external view returns (address);
}

contract NFTMarketplace {
    struct Listing {
        address seller;
        uint256 price;
        bool active;
    }

    struct RoyaltyInfo {
        address creator;
        uint96 bps; // basis points e.g. 250 = 2.5%
    }

    mapping(address => mapping(uint256 => Listing)) public listings;
    mapping(address => RoyaltyInfo) public royalties;

    event Listed(address indexed nft, uint256 indexed tokenId, uint256 price);
    event Sold(address indexed nft, uint256 indexed tokenId, address buyer, uint256 price);
    event RoyaltySet(address indexed nft, address creator, uint96 bps);

    function setRoyalty(address _nft, uint96 _bps) external {
        require(_bps <= 1000, "Max 10%");
        royalties[_nft] = RoyaltyInfo(msg.sender, _bps);
        emit RoyaltySet(_nft, msg.sender, _bps);
    }

    function list(address _nft, uint256 _tokenId, uint256 _price) external {
        require(IERC721(_nft).ownerOf(_tokenId) == msg.sender, "Not owner");
        require(IERC721(_nft).getApproved(_tokenId) == address(this), "Not approved");
        listings[_nft][_tokenId] = Listing(msg.sender, _price, true);
        emit Listed(_nft, _tokenId, _price);
    }

    function buy(address _nft, uint256 _tokenId) external payable {
        Listing storage l = listings[_nft][_tokenId];
        require(l.active, "Not listed");
        require(msg.value >= l.price, "Insufficient payment");

        l.active = false;
        address seller = l.seller;

        RoyaltyInfo memory r = royalties[_nft];
        uint256 royaltyAmount = r.bps > 0 ? (l.price * r.bps) / 10000 : 0;
        uint256 sellerProceeds = l.price - royaltyAmount;

        if (royaltyAmount > 0) {
            (bool rok, ) = r.creator.call{value: royaltyAmount}("");
            require(rok, "Royalty transfer failed");
        }
        (bool sok, ) = seller.call{value: sellerProceeds}("");
        require(sok, "Seller transfer failed");

        IERC721(_nft).transferFrom(seller, msg.sender, _tokenId);
        emit Sold(_nft, _tokenId, msg.sender, l.price);

        // Refund excess
        if (msg.value > l.price) {
            (bool rok2, ) = msg.sender.call{value: msg.value - l.price}("");
            require(rok2, "Refund failed");
        }
    }
}
