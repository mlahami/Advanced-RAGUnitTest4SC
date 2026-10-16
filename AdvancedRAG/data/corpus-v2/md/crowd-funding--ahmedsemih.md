# crowd-funding--ahmedsemih

- domain: crowdfunding (crowdfunding)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/ahmedsemih/CrowdFunding-dApp @ f6a5690a60c3c6782982b6d42e5bf125834ed8f5
- license: MIT
- targets: CrowdFunding.sol
- validation: 6 passing tests, 0 failing; statement coverage CrowdFunding.sol 100.0 %

## Contract: CrowdFunding.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

contract CrowdFunding {
    uint256 public totalCollected;
    uint256 public campaignCount;
    mapping(uint256 => Campaign) public campaigns;

    struct Donation {
        address donator;
        uint256 amount;
    }

    struct Campaign {
        address owner;
        string title;
        string description;
        string imageUrl;
        uint256 target;
        uint256 collectedAmount;
        uint256 withdrawedAmount;
        uint256 deadline;
        Donation[] donations;
    }

    event CampaignCreated(
        address indexed owner,
        uint256 indexed campaignId,
        string title
    );
    event CampaignClosed(uint256 indexed campaignId);
    event DonateReceived(
        uint256 indexed campaignId,
        address indexed donator,
        uint256 amount
    );
    event Withdrawal(
        uint256 indexed campaignId,
        address indexed owner,
        uint256 amount
    );

    modifier onlyOwner(uint256 _id) {
        require(
            msg.sender == campaigns[_id].owner,
            "You are not the owner of this campaign."
        );
        _;
    }

    function createCampaign(
        string memory _title,
        string memory _description,
        string memory _imageUrl,
        uint256 _target,
        uint256 _deadline
    ) public returns (uint256) {
        require(_deadline > block.timestamp, "Deadline must be in the future.");
        require(_target > 0, "Target must be bigger than 0.");

        Campaign storage newCampaign = campaigns[campaignCount];
        newCampaign.owner = msg.sender;
        newCampaign.title = _title;
        newCampaign.description = _description;
        newCampaign.imageUrl = _imageUrl;
        newCampaign.deadline = _deadline;
        newCampaign.target = _target;

        campaignCount++;
        emit CampaignCreated(msg.sender, campaignCount - 1, _title);

        return campaignCount - 1;
    }

    function closeCampaign(uint256 _id) public onlyOwner(_id) {
        Campaign storage campaign = campaigns[_id];
        campaign.deadline = block.timestamp;
        emit CampaignClosed(_id);
    }

    function donate(uint256 _id) public payable {
        Campaign storage campaign = campaigns[_id];

        campaign.donations.push(Donation(msg.sender, msg.value));
        campaign.collectedAmount += msg.value;
        totalCollected += msg.value;

        emit DonateReceived(_id, msg.sender, msg.value);
    }

    function withdraw(uint256 _id, uint256 _amount) public onlyOwner(_id) {
        Campaign storage campaign = campaigns[_id];

        require(
            _amount <= campaign.collectedAmount - campaign.withdrawedAmount,
            "The amount withdrawn must be less than or equal to the withdrawnable amount."
        );

        campaign.withdrawedAmount += _amount;
        payable(msg.sender).transfer(_amount);

        emit Withdrawal(_id, msg.sender, _amount);
    }

    function getCampaigns() public view returns (Campaign[] memory) {
        Campaign[] memory allCampaigns = new Campaign[](campaignCount);

        for (uint i = 0; i < campaignCount; i++) {
            allCampaigns[i] = campaigns[i];
        }

        return allCampaigns;
    }

    function getDonations(uint256 _id) public view returns (Donation[] memory) {
        return campaigns[_id].donations;
    }
}
```

## Tests: crowdFunding.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrowdFunding Contract", () => {
  let CrowdFunding;
  let crowdFunding;
  let owner;
  let donor;
  let campaignId;

  const createCampaign = async () => {
    const createCampaignTx = await crowdFunding.createCampaign(
      "Campaign Title",
      "Campaign Description",
      "Campaign Image",
      ethers.parseEther("100"),
      Math.floor(Date.now() / 1000) + 3600
    );

    await createCampaignTx.wait(1);
    return 0;
  }

  beforeEach(async () => {
    [owner, donor] = await ethers.getSigners();
    CrowdFunding = await ethers.getContractFactory("CrowdFunding");
    crowdFunding = await CrowdFunding.deploy();
    await crowdFunding.waitForDeployment();
    campaignId = await createCampaign();
  });

  it("should create a campaign", async () => {
    const campaign = await crowdFunding.campaigns(campaignId);
    expect(campaign.owner).to.equal(owner.address);
    expect(campaign.title).to.equal("Campaign Title");
    expect(campaign.description).to.equal("Campaign Description");
    expect(campaign.imageUrl).to.equal("Campaign Image");
    expect(campaign.target).to.equal(ethers.parseEther("100"));
    expect(campaign.deadline).to.equal(Math.floor(Date.now() / 1000) + 3600);
  });

  it("should donate to a campaign", async () => {
    await crowdFunding.connect(donor).donate(campaignId, { value: ethers.parseEther("100") });
    const campaign = await crowdFunding.campaigns(campaignId);
    expect(campaign.collectedAmount).to.equal(ethers.parseEther("100"));
  });

  it("should close a campaign", async () => {
    await crowdFunding.connect(owner).closeCampaign(campaignId);
    const campaign = await crowdFunding.campaigns(campaignId);
    expect(campaign.deadline).to.be.lte(Math.floor(Date.now()));
  });

  it("should withdraw from a campaign", async () => {
    await crowdFunding.connect(donor).donate(campaignId, { value: ethers.parseEther("50") });
    await crowdFunding.connect(owner).withdraw(campaignId, ethers.parseEther("30"));
    const campaign = await crowdFunding.campaigns(campaignId);
    expect(campaign.withdrawedAmount).to.equal(ethers.parseEther("30"));
  });

  it("should get a list of campaigns", async () => {
    await createCampaign();
    const allCampaigns = await crowdFunding.getCampaigns();
    expect(allCampaigns.length).to.equal(2);
    expect(allCampaigns[0].title).to.equal("Campaign Title");
    expect(allCampaigns[1].title).to.equal("Campaign Title");
  });

  it("should get donations for a campaign", async () => {
    await crowdFunding.connect(donor).donate(campaignId, { value: ethers.parseEther("50") });
    await crowdFunding.connect(donor).donate(campaignId, { value: ethers.parseEther("30") });
    const donations = await crowdFunding.getDonations(campaignId);
    expect(donations.length).to.equal(2);
    expect(donations[0].donator).to.equal(donor.address);
    expect(donations[0].amount).to.equal(ethers.parseEther("50"));
    expect(donations[1].amount).to.equal(ethers.parseEther("30"));
  });
});
```
