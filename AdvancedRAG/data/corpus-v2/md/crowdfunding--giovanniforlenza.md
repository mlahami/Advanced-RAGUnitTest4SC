# crowdfunding--giovanniforlenza

- domain: crowdfunding (crowdfunding)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/GiovanniForlenza/crowdfunding-dapp @ eecf8b3d57ce14c6f6e214dd3bf4dc9b5fa6f4b7
- license: MIT
- targets: Crowdfunding.sol
- validation: 6 passing tests, 0 failing; statement coverage Crowdfunding.sol 100.0 %

## Contract: Crowdfunding.sol (primary target)

```solidity
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
```

## Tests: Crowdfunding.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Crowdfunding", function () {
  let crowdfunding, creator, alice, bob;
  const GOAL = ethers.parseEther("10");   // obiettivo: 10 ETH
  const DURATION = 60 * 60 * 24 * 7;       // 7 giorni

  beforeEach(async function () {
    [creator, alice, bob] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("Crowdfunding");
    crowdfunding = await Factory.deploy();
    // il creatore lancia la campagna 0
    await crowdfunding.connect(creator).createCampaign(GOAL, DURATION, "Campagna test", "Descrizione di prova");
  });

  it("registra correttamente un contributo", async function () {
    await crowdfunding.connect(alice).contribute(0, { value: ethers.parseEther("3") });
    const c = await crowdfunding.campaigns(0);
    expect(c.raised).to.equal(ethers.parseEther("3"));
    expect(await crowdfunding.contributions(0, alice.address)).to.equal(ethers.parseEther("3"));
  });

  it("SCENARIO SUCCESSO: obiettivo raggiunto -> il creatore preleva", async function () {
    await crowdfunding.connect(alice).contribute(0, { value: ethers.parseEther("6") });
    await crowdfunding.connect(bob).contribute(0,   { value: ethers.parseEther("5") }); // tot 11 >= 10

    await time.increase(DURATION + 1); // "viaggio nel tempo": campagna scaduta

    // il prelievo va a buon fine e sposta 11 ETH al creatore
    await expect(crowdfunding.connect(creator).withdraw(0))
      .to.changeEtherBalance(creator, ethers.parseEther("11"));

    const c = await crowdfunding.campaigns(0);
    expect(c.claimed).to.equal(true);
  });

  it("SCENARIO FALLIMENTO: obiettivo non raggiunto -> rimborso ai contributori", async function () {
    await crowdfunding.connect(alice).contribute(0, { value: ethers.parseEther("4") }); // < 10

    await time.increase(DURATION + 1);

    // alice riprende esattamente i suoi 4 ETH
    await expect(crowdfunding.connect(alice).refund(0))
      .to.changeEtherBalance(alice, ethers.parseEther("4"));

    // non puo' farsi rimborsare due volte
    await expect(crowdfunding.connect(alice).refund(0))
      .to.be.revertedWith("Nessun contributo da rimborsare");
  });

  it("ACCESS CONTROL: solo il creatore puo' prelevare", async function () {
    await crowdfunding.connect(alice).contribute(0, { value: ethers.parseEther("11") });
    await time.increase(DURATION + 1);
    await expect(crowdfunding.connect(alice).withdraw(0))
      .to.be.revertedWith("Solo il creatore");
  });

  it("non si puo' prelevare prima della scadenza", async function () {
    await crowdfunding.connect(alice).contribute(0, { value: ethers.parseEther("11") });
    await expect(crowdfunding.connect(creator).withdraw(0))
      .to.be.revertedWith("Campagna ancora attiva");
  });

  it("non si puo' contribuire dopo la scadenza", async function () {
    await time.increase(DURATION + 1);
    await expect(crowdfunding.connect(alice).contribute(0, { value: ethers.parseEther("1") }))
      .to.be.revertedWith("Campagna scaduta");
  });
});
```
