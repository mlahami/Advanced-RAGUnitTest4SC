// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Crowdfunding decentralizzato
contract Crowdfunding is ReentrancyGuard {
    struct Campaign {
        address creator;      // 0
        string  title;        // 1
        string  description;  // 2
        uint256 goal;         // 3
        uint256 deadline;     // 4
        uint256 raised;       // 5
        bool    claimed;      // 6
    }

    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => mapping(address => uint256)) public contributions;
    uint256 public campaignCount;

    event CampaignCreated(uint256 indexed id, address indexed creator, string title, uint256 goal, uint256 deadline);
    event ContributionMade(uint256 indexed id, address indexed contributor, uint256 amount);
    event FundsWithdrawn(uint256 indexed id, address indexed creator, uint256 amount);
    event RefundIssued(uint256 indexed id, address indexed contributor, uint256 amount);

    function createCampaign(
        uint256 _goal,
        uint256 _durationSeconds,
        string calldata _title,
        string calldata _description
    ) external returns (uint256) {
        require(_goal > 0, "Obiettivo deve essere > 0");
        require(_durationSeconds > 0, "Durata deve essere > 0");
        require(bytes(_title).length > 0, "Titolo obbligatorio");

        uint256 id = campaignCount;
        campaigns[id] = Campaign({
            creator:     msg.sender,
            title:       _title,
            description: _description,
            goal:        _goal,
            deadline:    block.timestamp + _durationSeconds,
            raised:      0,
            claimed:     false
        });
        campaignCount++;

        emit CampaignCreated(id, msg.sender, _title, _goal, block.timestamp + _durationSeconds);
        return id;
    }

    function contribute(uint256 _id) external payable {
        Campaign storage c = campaigns[_id];
        require(c.creator != address(0), "Campagna inesistente");
        require(block.timestamp < c.deadline, "Campagna scaduta");
        require(msg.value > 0, "Contributo deve essere > 0");

        c.raised += msg.value;
        contributions[_id][msg.sender] += msg.value;

        emit ContributionMade(_id, msg.sender, msg.value);
    }

    function withdraw(uint256 _id) external nonReentrant {
        Campaign storage c = campaigns[_id];
        require(msg.sender == c.creator, "Solo il creatore");
        require(block.timestamp >= c.deadline, "Campagna ancora attiva");
        require(c.raised >= c.goal, "Obiettivo non raggiunto");
        require(!c.claimed, "Fondi gia' prelevati");

        c.claimed = true;
        uint256 amount = c.raised;

        (bool ok, ) = payable(c.creator).call{value: amount}("");
        require(ok, "Trasferimento fallito");

        emit FundsWithdrawn(_id, c.creator, amount);
    }

    function refund(uint256 _id) external nonReentrant {
        Campaign storage c = campaigns[_id];
        require(block.timestamp >= c.deadline, "Campagna ancora attiva");
        require(c.raised < c.goal, "Campagna riuscita: nessun rimborso");

        uint256 contributed = contributions[_id][msg.sender];
        require(contributed > 0, "Nessun contributo da rimborsare");

        contributions[_id][msg.sender] = 0;

        (bool ok, ) = payable(msg.sender).call{value: contributed}("");
        require(ok, "Rimborso fallito");

        emit RefundIssued(_id, msg.sender, contributed);
    }
}