# nfticket--sowadalmughni

- domain: ticketing-events (ticketing)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/sowadalmughni/nfticket-protocol @ 1ef8a792d6c00d0838c1677ee43bb1a26529d97f
- license: MIT
- targets: NFTicket.sol
- validation: 25 passing tests, 0 failing; statement coverage NFTicket.sol 75.86 %

## Contract: NFTicket.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title NFTicket
 * @dev ERC-721 NFT contract for event tickets with anti-scalping mechanisms
 * @author Sowad Al-Mughni
 */
contract NFTicket is ERC721, ERC721URIStorage, AccessControl, ReentrancyGuard {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    uint256 private _tokenIdCounter;

    // Anti-scalping parameters
    uint256 public royaltyCap; // Percentage in basis points (e.g., 500 = 5%)
    uint256 public maxPrice; // Maximum resale price in wei
    address public royaltyRecipient; // Address to receive royalties

    // Event information
    string public eventName;
    string public eventDescription;
    uint256 public eventDate;
    string public eventVenue;

    // Ticket tracking
    // Ticket tracking
    mapping(uint256 => bool) public ticketUsed; // Track if ticket has been used for entry
    mapping(uint256 => uint256) public originalPrice; // Track original sale price

    // Seat mapping
    struct SeatInfo {
        string section;
        string row;
        string seatNumber;
        string category; // VIP, General, etc.
    }
    mapping(uint256 => SeatInfo) public ticketSeats;
    mapping(bytes32 => bool) public seatTaken; // Track which seats are reserved

    mapping(address => bool) public approvedMarketplaces;
    bool private _isInternalTransfer;

    // Events
    event TicketMinted(uint256 indexed tokenId, address indexed to, string uri);
    event TicketMintedWithSeat(uint256 indexed tokenId, address indexed to, string section, string row, string seatNumber);
    event TicketTransferred(uint256 indexed tokenId, address indexed from, address indexed to, uint256 price, uint256 royaltyAmount);
    event TicketUsed(uint256 indexed tokenId, address indexed owner);
    event RoyaltyCapUpdated(uint256 newRoyaltyCap);
    event MaxPriceUpdated(uint256 newMaxPrice);
    event RoyaltyRecipientUpdated(address newRecipient);
    event MarketplaceApprovalUpdated(address indexed marketplace, bool approved);

    constructor(
        string memory _eventName,
        string memory _eventDescription,
        uint256 _eventDate,
        string memory _eventVenue,
        uint256 _royaltyCap,
        uint256 _maxPrice,
        address _royaltyRecipient
    ) ERC721("NFTicket", "NFTIX") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);

        eventName = _eventName;
        eventDescription = _eventDescription;
        eventDate = _eventDate;
        eventVenue = _eventVenue;
        royaltyCap = _royaltyCap;
        maxPrice = _maxPrice;
        royaltyRecipient = _royaltyRecipient;
    }

    /**
     * @dev Mint a new NFTicket
     * @param to Address to mint the ticket to
     * @param uri Metadata URI for the ticket
     * @param price Original sale price of the ticket
     */
    function mintTicket(address to, string memory uri, uint256 price) 
        public 
        onlyRole(MINTER_ROLE) 
        returns (uint256) 
    {
        uint256 tokenId = _tokenIdCounter++;
        
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        originalPrice[tokenId] = price;
        
        emit TicketMinted(tokenId, to, uri);
        return tokenId;
    }

    /**
     * @dev Mint a new NFTicket with seat assignment
     * @param to Address to mint the ticket to
     * @param uri Metadata URI for the ticket
     * @param price Original sale price of the ticket
     * @param section Section identifier (e.g., "A", "B", "VIP")
     * @param row Row identifier (e.g., "1", "2", "AA")
     * @param seatNumber Seat number (e.g., "1", "15", "A1")
     * @param category Ticket category (e.g., "VIP", "General", "Premium")
     */
    function mintTicketWithSeat(
        address to, 
        string memory uri, 
        uint256 price,
        string memory section,
        string memory row,
        string memory seatNumber,
        string memory category
    ) 
        public 
        onlyRole(MINTER_ROLE) 
        returns (uint256) 
    {
        // Create seat hash to check uniqueness
        bytes32 seatHash = keccak256(abi.encodePacked(section, row, seatNumber));
        require(!seatTaken[seatHash], "NFTicket: seat already taken");
        
        uint256 tokenId = _tokenIdCounter++;
        
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        originalPrice[tokenId] = price;
        
        // Store seat information
        ticketSeats[tokenId] = SeatInfo({
            section: section,
            row: row,
            seatNumber: seatNumber,
            category: category
        });
        seatTaken[seatHash] = true;
        
        emit TicketMinted(tokenId, to, uri);
        emit TicketMintedWithSeat(tokenId, to, section, row, seatNumber);
        return tokenId;
    }

    /**
     * @dev Get seat information for a ticket
     * @param tokenId Token ID to query
     * @return section Section identifier
     * @return row Row identifier
     * @return seatNumber Seat number
     * @return category Ticket category
     */
    function getSeatInfo(uint256 tokenId) 
        public 
        view 
        returns (
            string memory section,
            string memory row,
            string memory seatNumber,
            string memory category
        ) 
    {
        require(ownerOf(tokenId) != address(0), "NFTicket: ticket does not exist");
        SeatInfo memory seat = ticketSeats[tokenId];
        return (seat.section, seat.row, seat.seatNumber, seat.category);
    }

    /**
     * @dev Check if a seat is available
     * @param section Section identifier
     * @param row Row identifier
     * @param seatNumber Seat number
     * @return available True if seat is available
     */
    function isSeatAvailable(
        string memory section,
        string memory row,
        string memory seatNumber
    ) public view returns (bool available) {
        bytes32 seatHash = keccak256(abi.encodePacked(section, row, seatNumber));
        return !seatTaken[seatHash];
    }

    /**
     * @dev Transfer ticket with anti-scalping enforcement
     * @param from Current owner
     * @param to New owner
     * @param tokenId Token ID to transfer
     * @param salePrice Price of the sale (0 for gifts)
     */
    function transferWithPrice(address from, address to, uint256 tokenId, uint256 salePrice) 
        public 
        payable 
        nonReentrant 
    {
        require(
            msg.sender == ownerOf(tokenId) || 
            getApproved(tokenId) == msg.sender || 
            isApprovedForAll(ownerOf(tokenId), msg.sender), 
            "NFTicket: transfer caller is not owner nor approved"
        );
        require(ownerOf(tokenId) == from, "NFTicket: transfer from incorrect owner");
        require(!ticketUsed[tokenId], "NFTicket: ticket has already been used");

        // Enforce max price if this is a resale (salePrice > 0)
        if (salePrice > 0) {
            require(salePrice <= maxPrice, "NFTicket: sale price exceeds maximum allowed price");
            require(msg.value >= salePrice, "NFTicket: insufficient payment");

            // Calculate and transfer royalty
            uint256 royaltyAmount = (salePrice * royaltyCap) / 10000;
            uint256 sellerAmount = salePrice - royaltyAmount;

            if (royaltyAmount > 0) {
                payable(royaltyRecipient).transfer(royaltyAmount);
            }
            
            if (sellerAmount > 0) {
                payable(from).transfer(sellerAmount);
            }

            // Refund excess payment
            if (msg.value > salePrice) {
                payable(msg.sender).transfer(msg.value - salePrice);
            }

            emit TicketTransferred(tokenId, from, to, salePrice, royaltyAmount);
        }

        _isInternalTransfer = true;
        _transfer(from, to, tokenId);
        _isInternalTransfer = false;
    }

    /**
     * @dev Mark a ticket as used for event entry
     * @param tokenId Token ID to mark as used
     */
    function useTicket(uint256 tokenId) public {
        require(ownerOf(tokenId) != address(0), "NFTicket: ticket does not exist");
        require(ownerOf(tokenId) == msg.sender, "NFTicket: caller is not the owner");
        require(!ticketUsed[tokenId], "NFTicket: ticket has already been used");

        ticketUsed[tokenId] = true;
        emit TicketUsed(tokenId, msg.sender);
    }

    /**
     * @dev Update royalty cap (admin only)
     * @param _royaltyCap New royalty cap in basis points
     */
    function setRoyaltyCap(uint256 _royaltyCap) public onlyRole(ADMIN_ROLE) {
        require(_royaltyCap <= 2500, "NFTicket: royalty cap cannot exceed 25%");
        royaltyCap = _royaltyCap;
        emit RoyaltyCapUpdated(_royaltyCap);
    }

    /**
     * @dev Update maximum resale price (admin only)
     * @param _maxPrice New maximum price in wei
     */
    function setMaxPrice(uint256 _maxPrice) public onlyRole(ADMIN_ROLE) {
        maxPrice = _maxPrice;
        emit MaxPriceUpdated(_maxPrice);
    }

    /**
     * @dev Update royalty recipient (admin only)
     * @param _royaltyRecipient New royalty recipient address
     */
    function setRoyaltyRecipient(address _royaltyRecipient) public onlyRole(ADMIN_ROLE) {
        require(_royaltyRecipient != address(0), "NFTicket: royalty recipient cannot be zero address");
        royaltyRecipient = _royaltyRecipient;
        emit RoyaltyRecipientUpdated(_royaltyRecipient);
    }

    /**
     * @dev Set approved marketplace status (admin only)
     * @param marketplace Address of the marketplace
     * @param approved Approval status
     */
    function setApprovedMarketplace(address marketplace, bool approved) public onlyRole(ADMIN_ROLE) {
        approvedMarketplaces[marketplace] = approved;
        emit MarketplaceApprovalUpdated(marketplace, approved);
    }

    /**
     * @dev Get ticket information
     * @param tokenId Token ID to query
     */
    function getTicketInfo(uint256 tokenId) public view returns (
        address owner,
        string memory uri,
        bool used,
        uint256 origPrice
    ) {
        require(ownerOf(tokenId) != address(0), "NFTicket: ticket does not exist");
        return (
            ownerOf(tokenId),
            tokenURI(tokenId),
            ticketUsed[tokenId],
            originalPrice[tokenId]
        );
    }

    /**
     * @dev Get event information
     */
    function getEventInfo() public view returns (
        string memory name,
        string memory description,
        uint256 date,
        string memory venue
    ) {
        return (eventName, eventDescription, eventDate, eventVenue);
    }

    // The following functions are overrides required by Solidity. 
    // We need to explicitly mark them as `virtual` here and `override` in the child contracts.
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
        override(ERC721, ERC721URIStorage, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // Internal function to prevent transfers unless authorized or strictly internal
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721)
        returns (address)
    {
        if (to != address(0)) {
            require(!ticketUsed[tokenId], "NFTicket: cannot transfer used ticket");
        }
        
        // Allow minting (from == 0) and burning (to == 0)
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            require(
                _isInternalTransfer || approvedMarketplaces[msg.sender],
                "NFTicket: transfers restricted to approved marketplaces"
            );
        }

        return super._update(to, tokenId, auth);
    }
}
```

## Tests: NFTicket.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTicket", function () {
  let NFTicket;
  let nfticket;
  let owner;
  let minter;
  let buyer;
  let reseller;
  let royaltyRecipient;
  let addrs;

  const eventName = "Test Concert";
  const eventDescription = "A test concert event";
  const eventDate = Math.floor(Date.now() / 1000) + 86400; // Tomorrow
  const eventVenue = "Test Venue";
  const royaltyCap = 500; // 5%
  const maxPrice = ethers.parseEther("1.0"); // 1 ETH
  const originalPrice = ethers.parseEther("0.1"); // 0.1 ETH

  beforeEach(async function () {
    [owner, minter, buyer, reseller, royaltyRecipient, ...addrs] = await ethers.getSigners();

    NFTicket = await ethers.getContractFactory("NFTicket");
    nfticket = await NFTicket.deploy(
      eventName,
      eventDescription,
      eventDate,
      eventVenue,
      royaltyCap,
      maxPrice,
      royaltyRecipient.address
    );

    // Grant minter role
    const MINTER_ROLE = await nfticket.MINTER_ROLE();
    await nfticket.grantRole(MINTER_ROLE, minter.address);
  });

  describe("Deployment", function () {
    it("Should set the right event information", async function () {
      const eventInfo = await nfticket.getEventInfo();
      expect(eventInfo.name).to.equal(eventName);
      expect(eventInfo.description).to.equal(eventDescription);
      expect(eventInfo.date).to.equal(eventDate);
      expect(eventInfo.venue).to.equal(eventVenue);
    });

    it("Should set the right anti-scalping parameters", async function () {
      expect(await nfticket.royaltyCap()).to.equal(royaltyCap);
      expect(await nfticket.maxPrice()).to.equal(maxPrice);
      expect(await nfticket.royaltyRecipient()).to.equal(royaltyRecipient.address);
    });

    it("Should grant roles correctly", async function () {
      const DEFAULT_ADMIN_ROLE = await nfticket.DEFAULT_ADMIN_ROLE();
      const ADMIN_ROLE = await nfticket.ADMIN_ROLE();
      const MINTER_ROLE = await nfticket.MINTER_ROLE();

      expect(await nfticket.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
      expect(await nfticket.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
      expect(await nfticket.hasRole(MINTER_ROLE, owner.address)).to.be.true;
      expect(await nfticket.hasRole(MINTER_ROLE, minter.address)).to.be.true;
    });
  });

  describe("Minting", function () {
    it("Should mint a ticket successfully", async function () {
      const tokenURI = "https://example.com/token/1";
      
      const tokenId = 0; // First minted token will have ID 0
      await expect(nfticket.connect(minter).mintTicket(buyer.address, tokenURI, originalPrice))
        .to.emit(nfticket, "TicketMinted")
        .withArgs(tokenId, buyer.address, tokenURI);

      expect(await nfticket.ownerOf(tokenId)).to.equal(buyer.address);
      expect(await nfticket.tokenURI(tokenId)).to.equal(tokenURI);
      
      const ticketInfo = await nfticket.getTicketInfo(tokenId);
      expect(ticketInfo.owner).to.equal(buyer.address);
      expect(ticketInfo.uri).to.equal(tokenURI);
      expect(ticketInfo.used).to.be.false;
      expect(ticketInfo.origPrice).to.equal(originalPrice);
    });

    it("Should fail if non-minter tries to mint", async function () {
      const tokenURI = "https://example.com/token/1";
      
      await expect(nfticket.connect(buyer).mintTicket(buyer.address, tokenURI, originalPrice))
        .to.be.reverted;
    });
  });

  describe("Transfer with Price", function () {
    beforeEach(async function () {
      const tokenURI = "https://example.com/token/1";
      await nfticket.connect(minter).mintTicket(buyer.address, tokenURI, originalPrice);
      await nfticket.connect(buyer).approve(reseller.address, 0);
    });

    it("Should transfer with valid price and royalty", async function () {
      const salePrice = ethers.parseEther("0.5");
      const royaltyCapBigInt = BigInt(royaltyCap);
      const expectedRoyalty = (salePrice * royaltyCapBigInt) / 10000n;
      const expectedSellerAmount = salePrice - expectedRoyalty;

      const initialRoyaltyBalance = await ethers.provider.getBalance(royaltyRecipient.address);
      const initialBuyerBalance = await ethers.provider.getBalance(buyer.address);

      await expect(
        nfticket.connect(reseller).transferWithPrice(buyer.address, reseller.address, 0, salePrice, {
          value: salePrice
        })
      )
        .to.emit(nfticket, "TicketTransferred")
        .withArgs(0, buyer.address, reseller.address, salePrice, expectedRoyalty);

      expect(await nfticket.ownerOf(0)).to.equal(reseller.address);

      const finalRoyaltyBalance = await ethers.provider.getBalance(royaltyRecipient.address);
      const finalBuyerBalance = await ethers.provider.getBalance(buyer.address);

      expect(finalRoyaltyBalance - initialRoyaltyBalance).to.equal(expectedRoyalty);
      expect(finalBuyerBalance - initialBuyerBalance).to.equal(expectedSellerAmount);
    });

    it("Should fail if sale price exceeds max price", async function () {
      const excessivePrice = ethers.parseEther("2.0"); // Exceeds maxPrice of 1 ETH

      await expect(
        nfticket.connect(reseller).transferWithPrice(buyer.address, reseller.address, 0, excessivePrice, {
          value: excessivePrice
        })
      ).to.be.revertedWith("NFTicket: sale price exceeds maximum allowed price");
    });

    it("Should fail if insufficient payment", async function () {
      const salePrice = ethers.parseEther("0.5");
      const insufficientPayment = ethers.parseEther("0.3");

      await expect(
        nfticket.connect(reseller).transferWithPrice(buyer.address, reseller.address, 0, salePrice, {
          value: insufficientPayment
        })
      ).to.be.revertedWith("NFTicket: insufficient payment");
    });

    it("Should refund excess payment", async function () {
      const salePrice = ethers.parseEther("0.5");
      const excessPayment = ethers.parseEther("0.7");
      
      // Calculate expected spent amount
      const initialResellerBalance = await ethers.provider.getBalance(reseller.address);

      const tx = await nfticket.connect(reseller).transferWithPrice(buyer.address, reseller.address, 0, salePrice, {
        value: excessPayment
      });
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalResellerBalance = await ethers.provider.getBalance(reseller.address);
      const actualSpent = initialResellerBalance - finalResellerBalance;

      // Should have spent only salePrice + gas, not the excess
      expect(actualSpent).to.equal(salePrice + gasUsed);
    });

    it("Should allow free transfers (gifts)", async function () {
      await expect(
        nfticket.connect(reseller).transferWithPrice(buyer.address, reseller.address, 0, 0)
      ).to.not.be.reverted;

      expect(await nfticket.ownerOf(0)).to.equal(reseller.address);
    });
  });

  describe("Ticket Usage", function () {
    beforeEach(async function () {
      const tokenURI = "https://example.com/token/1";
      await nfticket.connect(minter).mintTicket(buyer.address, tokenURI, originalPrice);
    });

    it("Should mark ticket as used", async function () {
      await expect(nfticket.connect(buyer).useTicket(0))
        .to.emit(nfticket, "TicketUsed")
        .withArgs(0, buyer.address);

      expect(await nfticket.ticketUsed(0)).to.be.true;
    });

    it("Should fail if non-owner tries to use ticket", async function () {
      await expect(nfticket.connect(reseller).useTicket(0))
        .to.be.revertedWith("NFTicket: caller is not the owner");
    });

    it("Should fail if ticket is already used", async function () {
      await nfticket.connect(buyer).useTicket(0);
      
      await expect(nfticket.connect(buyer).useTicket(0))
        .to.be.revertedWith("NFTicket: ticket has already been used");
    });

    it("Should prevent transfer of used tickets", async function () {
      await nfticket.connect(buyer).useTicket(0);
      await nfticket.connect(buyer).approve(reseller.address, 0);

      await expect(
        nfticket.connect(reseller).transferWithPrice(buyer.address, reseller.address, 0, 0)
      ).to.be.revertedWith("NFTicket: ticket has already been used");
    });
  });

  describe("Restricted Transfers", function () {
    let tokenId;

    beforeEach(async function () {
      const tokenURI = "https://example.com/token/restricted";
      tokenId = 0;
      await nfticket.connect(minter).mintTicket(buyer.address, tokenURI, originalPrice);
    });

    it("Should fail if user tries to transfer via transferFrom (OpenSea bypass)", async function () {
      await nfticket.connect(buyer).approve(reseller.address, tokenId);
      
      await expect(
        nfticket.connect(reseller).transferFrom(buyer.address, reseller.address, tokenId)
      ).to.be.revertedWith("NFTicket: transfers restricted to approved marketplaces");
    });

    it("Should fail if user tries to transfer via safeTransferFrom", async function () {
      await nfticket.connect(buyer).approve(reseller.address, tokenId);
      
      await expect(
        nfticket.connect(reseller)["safeTransferFrom(address,address,uint256)"](buyer.address, reseller.address, tokenId)
      ).to.be.revertedWith("NFTicket: transfers restricted to approved marketplaces");
    });

    it("Should allow transfer if sender is an approved marketplace", async function () {
      // Approve reseller as a marketplace for testing
      await nfticket.setApprovedMarketplace(reseller.address, true);
      
      await nfticket.connect(buyer).approve(reseller.address, tokenId);
      
      await expect(
        nfticket.connect(reseller).transferFrom(buyer.address, reseller.address, tokenId)
      ).to.not.be.reverted;

      expect(await nfticket.ownerOf(tokenId)).to.equal(reseller.address);
    });

    it("Should still allow transferWithPrice (internal mechanism)", async function () {
      await nfticket.connect(buyer).approve(reseller.address, tokenId);
      const salePrice = ethers.parseEther("0.5");

      await expect(
        nfticket.connect(reseller).transferWithPrice(buyer.address, reseller.address, tokenId, salePrice, {
           value: salePrice 
        })
      ).to.not.be.reverted;

      expect(await nfticket.ownerOf(tokenId)).to.equal(reseller.address);
    });
  });

  describe("Admin Functions", function () {
    it("Should update royalty cap", async function () {
      const newRoyaltyCap = 1000; // 10%

      await expect(nfticket.setRoyaltyCap(newRoyaltyCap))
        .to.emit(nfticket, "RoyaltyCapUpdated")
        .withArgs(newRoyaltyCap);

      expect(await nfticket.royaltyCap()).to.equal(newRoyaltyCap);
    });

    it("Should fail to set royalty cap above 25%", async function () {
      const excessiveRoyaltyCap = 2600; // 26%

      await expect(nfticket.setRoyaltyCap(excessiveRoyaltyCap))
        .to.be.revertedWith("NFTicket: royalty cap cannot exceed 25%");
    });

    it("Should update max price", async function () {
      const newMaxPrice = ethers.parseEther("2.0");

      await expect(nfticket.setMaxPrice(newMaxPrice))
        .to.emit(nfticket, "MaxPriceUpdated")
        .withArgs(newMaxPrice);

      expect(await nfticket.maxPrice()).to.equal(newMaxPrice);
    });

    it("Should update royalty recipient", async function () {
      await expect(nfticket.setRoyaltyRecipient(addrs[0].address))
        .to.emit(nfticket, "RoyaltyRecipientUpdated")
        .withArgs(addrs[0].address);

      expect(await nfticket.royaltyRecipient()).to.equal(addrs[0].address);
    });

    it("Should fail to set zero address as royalty recipient", async function () {
      await expect(nfticket.setRoyaltyRecipient(ethers.ZeroAddress))
        .to.be.revertedWith("NFTicket: royalty recipient cannot be zero address");
    });

    it("Should fail if non-admin tries to update parameters", async function () {
      await expect(nfticket.connect(buyer).setRoyaltyCap(1000))
        .to.be.reverted;

      await expect(nfticket.connect(buyer).setMaxPrice(ethers.parseEther("2.0")))
        .to.be.reverted;

      await expect(nfticket.connect(buyer).setRoyaltyRecipient(addrs[0].address))
        .to.be.reverted;
        
      await expect(nfticket.connect(buyer).setApprovedMarketplace(addrs[0].address, true))
        .to.be.reverted;
    });

    it("Should update approved marketplaces", async function () {
        const marketplace = addrs[0].address;
        
        await expect(nfticket.setApprovedMarketplace(marketplace, true))
            .to.emit(nfticket, "MarketplaceApprovalUpdated")
            .withArgs(marketplace, true);
            
        expect(await nfticket.approvedMarketplaces(marketplace)).to.be.true;
    });
  });
});
```
