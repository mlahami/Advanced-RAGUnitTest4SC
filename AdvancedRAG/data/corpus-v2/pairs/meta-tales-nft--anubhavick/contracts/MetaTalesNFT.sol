// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";

/**
 * @title MetaTalesNFT
 * @dev ERC721 contract for Meta-Tales literary NFTs with royalty support
 * @author Meta-Tales Team
 */
contract MetaTalesNFT is ERC721, ERC721URIStorage, ERC721Burnable, Ownable, IERC2981 {
    // Token ID counter
    uint256 private _tokenIdCounter;

    // Mapping from token ID to royalty info
    mapping(uint256 => RoyaltyInfo) private _tokenRoyalties;

    // Default royalty info
    RoyaltyInfo private _defaultRoyaltyInfo;

    // Royalty info struct
    struct RoyaltyInfo {
        address recipient;
        uint96 royaltyFraction; // In basis points (1/100 of a percent)
    }

    // Events
    event TokenMinted(
        uint256 indexed tokenId,
        address indexed to,
        string uri,
        address royaltyRecipient,
        uint96 royaltyFraction
    );

    event RoyaltySet(
        uint256 indexed tokenId,
        address indexed recipient,
        uint96 royaltyFraction
    );

    // Maximum royalty fraction (10% = 1000 basis points)
    uint96 public constant MAX_ROYALTY_FRACTION = 1000;

    /**
     * @dev Constructor
     * @param _name Token name
     * @param _symbol Token symbol
     * @param _defaultRoyaltyRecipient Default royalty recipient
     * @param _defaultRoyaltyFraction Default royalty fraction in basis points
     * @param _owner Contract owner
     */
    constructor(
        string memory _name,
        string memory _symbol,
        address _defaultRoyaltyRecipient,
        uint96 _defaultRoyaltyFraction,
        address _owner
    ) ERC721(_name, _symbol) Ownable(_owner) {
        require(_defaultRoyaltyFraction <= MAX_ROYALTY_FRACTION, "Royalty too high");
        _defaultRoyaltyInfo = RoyaltyInfo(_defaultRoyaltyRecipient, _defaultRoyaltyFraction);
    }

    /**
     * @dev Check if a token exists
     * @param tokenId Token ID to check
     * @return bool Whether the token exists
     */
    function exists(uint256 tokenId) public view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    /**
     * @dev Mint a new NFT
     * @param to Address to mint to
     * @param uri Metadata URI for the token
     * @param royaltyRecipient Address to receive royalties
     * @param royaltyFraction Royalty fraction in basis points
     * @return tokenId The ID of the newly minted token
     */
    function mintNFT(
        address to,
        string memory uri,
        address royaltyRecipient,
        uint96 royaltyFraction
    ) public returns (uint256) {
        require(royaltyFraction <= MAX_ROYALTY_FRACTION, "Royalty too high");
        require(royaltyRecipient != address(0), "Invalid royalty recipient");

        _tokenIdCounter++;
        uint256 tokenId = _tokenIdCounter;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);

        // Set royalty info for this token
        _tokenRoyalties[tokenId] = RoyaltyInfo(royaltyRecipient, royaltyFraction);

        emit TokenMinted(tokenId, to, uri, royaltyRecipient, royaltyFraction);
        emit RoyaltySet(tokenId, royaltyRecipient, royaltyFraction);

        return tokenId;
    }

    /**
     * @dev Mint NFT with default royalty
     * @param to Address to mint to
     * @param uri Metadata URI for the token
     * @return tokenId The ID of the newly minted token
     */
    function mintNFTWithDefaultRoyalty(
        address to,
        string memory uri
    ) public returns (uint256) {
        return mintNFT(to, uri, _defaultRoyaltyInfo.recipient, _defaultRoyaltyInfo.royaltyFraction);
    }

    /**
     * @dev Set royalty info for a specific token (only owner or token owner)
     * @param tokenId Token ID
     * @param recipient Royalty recipient
     * @param royaltyFraction Royalty fraction in basis points
     */
    function setTokenRoyalty(
        uint256 tokenId,
        address recipient,
        uint96 royaltyFraction
    ) public {
        require(exists(tokenId), "Token does not exist");
        require(
            owner() == _msgSender() || ownerOf(tokenId) == _msgSender(),
            "Caller is not owner or token owner"
        );
        require(royaltyFraction <= MAX_ROYALTY_FRACTION, "Royalty too high");
        require(recipient != address(0), "Invalid recipient");

        _tokenRoyalties[tokenId] = RoyaltyInfo(recipient, royaltyFraction);
        emit RoyaltySet(tokenId, recipient, royaltyFraction);
    }

    /**
     * @dev Set default royalty info (only owner)
     * @param recipient Default royalty recipient
     * @param royaltyFraction Default royalty fraction in basis points
     */
    function setDefaultRoyalty(address recipient, uint96 royaltyFraction) public onlyOwner {
        require(royaltyFraction <= MAX_ROYALTY_FRACTION, "Royalty too high");
        require(recipient != address(0), "Invalid recipient");

        _defaultRoyaltyInfo = RoyaltyInfo(recipient, royaltyFraction);
    }

    /**
     * @dev Get total number of tokens minted
     * @return Total supply of tokens
     */
    function totalSupply() public view returns (uint256) {
        return _tokenIdCounter;
    }

    /**
     * @dev Get royalty info for a token (EIP-2981)
     * @param tokenId Token ID
     * @param salePrice Sale price of the token
     * @return receiver Royalty recipient
     * @return royaltyAmount Royalty amount
     */
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        public
        view
        override
        returns (address receiver, uint256 royaltyAmount)
    {
        if (!exists(tokenId)) {
            return (_defaultRoyaltyInfo.recipient, 0);
        }

        RoyaltyInfo memory royalty = _tokenRoyalties[tokenId];
        
        // If no specific royalty set for this token, use default
        if (royalty.recipient == address(0)) {
            royalty = _defaultRoyaltyInfo;
        }

        uint256 royaltyValue = (salePrice * royalty.royaltyFraction) / 10000;
        return (royalty.recipient, royaltyValue);
    }

    /**
     * @dev Get royalty info for a token (custom function)
     * @param tokenId Token ID
     * @return recipient Royalty recipient
     * @return royaltyFraction Royalty fraction in basis points
     */
    function getTokenRoyalty(uint256 tokenId)
        public
        view
        returns (address recipient, uint96 royaltyFraction)
    {
        if (!exists(tokenId)) {
            return (_defaultRoyaltyInfo.recipient, _defaultRoyaltyInfo.royaltyFraction);
        }

        RoyaltyInfo memory royalty = _tokenRoyalties[tokenId];
        
        // If no specific royalty set for this token, use default
        if (royalty.recipient == address(0)) {
            royalty = _defaultRoyaltyInfo;
        }

        return (royalty.recipient, royalty.royaltyFraction);
    }

    /**
     * @dev Get default royalty info
     * @return recipient Default royalty recipient
     * @return royaltyFraction Default royalty fraction in basis points
     */
    function getDefaultRoyalty()
        public
        view
        returns (address recipient, uint96 royaltyFraction)
    {
        return (_defaultRoyaltyInfo.recipient, _defaultRoyaltyInfo.royaltyFraction);
    }

    // Required overrides
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage, IERC165)
        returns (bool)
    {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }
}