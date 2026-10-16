// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SmartChit — Blockchain-based Chit Fund
/// @notice A trustless chit fund where members join, pay monthly, and bid for the pot
/// @dev Deployed on Polygon Amoy Testnet at 0x96539E626DB6b5cE21F2E39F9BDa46d1bD9DbB54
contract SmartChit {
    address public owner;
    uint256 public monthlyAmount;
    uint8 public constant MAX_MEMBERS = 5;

    address[] public members;
    uint8 public memberCount;
    mapping(address => bool) public isMember;
    mapping(address => bool) public hasPaid;

    uint256 public totalPot;
    uint8 public currentMonth;

    bool public auctionActive;
    uint256 public auctionEndTime;
    uint256 public constant AUCTION_DURATION = 5 minutes;

    mapping(address => uint256) public bids;
    address[] public bidders;

    event Joined(address member);
    event Paid(address member, uint256 amount);
    event BidPlaced(address bidder, uint256 discount);
    event WinnerSelected(address winner, uint256 amount);
    event DividendPaid(address member, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(uint256 _monthlyAmount) {
        owner = msg.sender;
        monthlyAmount = _monthlyAmount;
    }

    /// @notice Join the chit fund (max 5 members)
    function join() external {
        require(!isMember[msg.sender], "Already a member");
        require(memberCount < MAX_MEMBERS, "Fund is full");

        isMember[msg.sender] = true;
        members.push(msg.sender);
        memberCount++;

        emit Joined(msg.sender);
    }

    /// @notice Pay monthly contribution (must send exactly monthlyAmount)
    function pay() external payable {
        require(isMember[msg.sender], "Not a member");
        require(!hasPaid[msg.sender], "Already paid this month");
        require(msg.value == monthlyAmount, "Incorrect amount");

        hasPaid[msg.sender] = true;
        totalPot += msg.value;

        emit Paid(msg.sender, msg.value);

        if (memberCount >= MAX_MEMBERS && allPaid()) {
            _startAuction();
        }
    }

    /// @notice Place a bid for discount on the pot
    /// @param discountAmount The discount (in wei) the bidder wants
    function placeBid(uint256 discountAmount) external {
        require(auctionActive, "Auction not active");
        require(isMember[msg.sender], "Not a member");
        require(discountAmount > 0 && discountAmount < totalPot, "Invalid bid");

        bids[msg.sender] = discountAmount;
        bidders.push(msg.sender);

        emit BidPlaced(msg.sender, discountAmount);
    }

    /// @notice End auction and distribute funds to lowest bidder
    function endAuction() external {
        require(auctionActive, "Auction not active");
        require(block.timestamp >= auctionEndTime, "Auction not ended");

        auctionActive = false;

        if (bidders.length == 0) {
            // No bids — carry pot to next month
            currentMonth++;
            totalPot = 0;
            _resetPayments();
            return;
        }

        // Find lowest bidder (highest discount = lowest net payment)
        address winner = bidders[0];
        uint256 lowestBid = bids[bidders[0]];

        for (uint256 i = 1; i < bidders.length; i++) {
            if (bids[bidders[i]] < lowestBid) {
                lowestBid = bids[bidders[i]];
                winner = bidders[i];
            }
        }

        uint256 payout = totalPot - lowestBid;

        emit WinnerSelected(winner, payout);

        // Transfer funds to winner
        (bool sent, ) = payable(winner).call{value: payout}("");
        require(sent, "Transfer failed");

        // Pay dividend to other members
        uint256 dividend = lowestBid / (memberCount - 1);
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i] != winner && hasPaid[members[i]]) {
                (bool paid, ) = payable(members[i]).call{value: dividend}("");
                if (paid) {
                    emit DividendPaid(members[i], dividend);
                }
            }
        }

        // Reset for next month
        currentMonth++;
        totalPot = 0;
        delete bidders;
        for (uint256 i = 0; i < members.length; i++) {
            delete bids[members[i]];
        }
        _resetPayments();
    }

    /// @notice Get all members
    function getMembers() external view returns (address[] memory) {
        return members;
    }

    /// @notice Get current bids (addresses and amounts)
    function getCurrentBids() external view returns (address[] memory, uint256[] memory) {
        address[] memory addrs = new address[](bidders.length);
        uint256[] memory amounts = new uint256[](bidders.length);

        for (uint256 i = 0; i < bidders.length; i++) {
            addrs[i] = bidders[i];
            amounts[i] = bids[bidders[i]];
        }

        return (addrs, amounts);
    }

    /// @notice Get contract balance
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ── Internal ──────────────────────────────────────────────

    function allPaid() private view returns (bool) {
        for (uint256 i = 0; i < members.length; i++) {
            if (!hasPaid[members[i]]) return false;
        }
        return true;
    }

    function _startAuction() private {
        auctionActive = true;
        auctionEndTime = block.timestamp + AUCTION_DURATION;
    }

    function _resetPayments() private {
        for (uint256 i = 0; i < members.length; i++) {
            hasPaid[members[i]] = false;
        }
    }

    /// @notice Accept ETH (fallback)
    receive() external payable {}
}
