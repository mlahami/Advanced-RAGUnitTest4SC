// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Coursework ERC721 with payable mint and IPFS metadata
contract MyNFT is ERC721URIStorage, Ownable, ReentrancyGuard {
    uint256 public nextTokenId;
    uint256 public price; // wei

    event Minted(address indexed to, uint256 indexed tokenId, string tokenURI);
    event PriceUpdated(uint256 oldPrice, uint256 newPrice);
    event Withdrawal(address indexed to, uint256 amount);

    constructor(string memory name_, string memory symbol_, uint256 initialPriceWei)
        ERC721(name_, symbol_) 
        Ownable(msg.sender)
    {
        price = initialPriceWei;
    }

    /// @notice Owner can change mint price
    function setPrice(uint256 newPrice) external onlyOwner {
        emit PriceUpdated(price, newPrice);
        price = newPrice;
    }

    /// @notice Payable mint. Stores IPFS tokenURI.
    function safeMint(address to, string memory tokenUri)
        external
        payable
        nonReentrant
        returns (uint256 tokenId)
    {
        require(msg.value >= price, "Insufficient ETH");
        tokenId = ++nextTokenId;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenUri);
        emit Minted(to, tokenId, tokenUri);
    }

    /// @notice Withdraw contract balance to owner
    function withdraw() external onlyOwner nonReentrant {
        uint256 bal = address(this).balance;
        require(bal > 0, "No balance");
        (bool ok, ) = payable(owner()).call{value: bal}("");
        require(ok, "Withdraw failed");
        emit Withdrawal(owner(), bal);
    }

    // Required override (multiple inheritance)
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }
}
