# donate-crypto--allexantoniollo

- domain: crowdfunding (charity-donation)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/AllexAntoniollo/DonateCrypto @ 536b70b4ab02cdce945e9502dce220fbee2e034d
- license: MIT
- targets: DonateCrypto.sol, DonateCryptoLib.sol, IDonateCrypto.sol
- validation: 15 passing tests, 0 failing; statement coverage DonateCrypto.sol 100.0 %, DonateCryptoLib.sol 100.0 %, IDonateCrypto.sol 100.0 %

## Contract: DonateCrypto.sol (primary target)

```solidity
//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./IDonateCrypto.sol";

import {DonateCryptoLib as Lib} from "./DonateCryptoLib.sol";


contract DonateCrypto is IDonateCrypto{


    address payable public immutable owner;
    uint256 public fee = 100;
    uint256 public nextId = 0;
    uint256 public feesGenerated = 0;
    Lib.Campaign[] public campaigns;


    constructor(){
        owner = payable(msg.sender);
    }

    function getCampaign(uint256 id) external view returns (Lib.Campaign memory) {
        return campaigns[id];
    }
    

    function getLastId() external view returns(uint256){
        return nextId;
    }


    function addCampaign(string calldata title, string calldata description, string[] calldata videosUrl,string[] calldata imagesUrl, uint256 goal) external {
        Lib.Campaign memory newCampaign;

        newCampaign.title = title;
        newCampaign.description = description;
        newCampaign.videosUrl = videosUrl;
        newCampaign.imagesUrl = imagesUrl;
        newCampaign.goal = goal;
        newCampaign.active = true;
        newCampaign.author = tx.origin;
        
        campaigns.push(newCampaign);
        nextId++;

    }


    function getDonors(uint256 id) external view returns(address[] memory){
        return campaigns[id].donors;
    }


    function donate(uint256 id) external payable{
        require(msg.value > 0, "You must send a donation value > 0");
        require(campaigns[id].active == true, "Cannot donate to this campaign");
        
        campaigns[id].donors.push(tx.origin);
        campaigns[id].balance += msg.value;

        if (campaigns[id].balance >= campaigns[id].goal){
            withdraw(id);
        }
    }


    function withdraw(uint256 id) public{
        require(campaigns[id].active == true, "This campaign is closed");
        require(campaigns[id].balance > fee, "This campaign does not have enough balance");

        feesGenerated += fee;
        campaigns[id].active = false;
        payable(campaigns[id].author).transfer(campaigns[id].balance-fee);

    }


    function withdrawOwner() external restricted{
        require(feesGenerated > 0, "No fees to withdraw");
        payable(owner).transfer(feesGenerated);
        feesGenerated = 0;
    }


    function changeFee(uint256 newFee) external restricted{
        fee = newFee;
    }


    modifier restricted(){
        require(owner == tx.origin, "You do not have permission");
        _;
    }

}
```

## Contract: DonateCryptoLib.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {DonateCryptoLib as Lib} from "./DonateCryptoLib.sol";

library DonateCryptoLib {

    struct Campaign{
        address author;
        string title;
        string description;
        string[] videosUrl;
        string[] imagesUrl;
        uint256 balance;
        uint256 goal;
        bool active;
        address[] donors;
    }

}
```

## Contract: IDonateCrypto.sol (dependency)

```solidity
//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {DonateCryptoLib as Lib} from "./DonateCryptoLib.sol";

interface IDonateCrypto {
    
    function addCampaign(string calldata title, string calldata description, string[] calldata videosUrl,string[] calldata imagesUrl, uint256 goal) external;

    function getDonors(uint256 id) external view returns(address[] memory);

    function getLastId() external view returns(uint256);

    function donate(uint256 id) external payable;

    function withdrawOwner() external;

    function changeFee(uint256 newFee) external;

    function getCampaign(uint256 id) external view returns(Lib.Campaign memory);

    
}
```

## Tests: DonateCrypto.test.js

```javascript
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DonateCrypto", function () {

    async function deployFixture(){
      const [owner, otherAccount] = await ethers.getSigners();

      const DonateCrypto = await ethers.getContractFactory("DonateCrypto");

      const contract = await DonateCrypto.deploy();

      return { contract, owner, otherAccount };
    }

    const campaign = {
      title: "Meal of Love",
      description: "This campaign have an objective to feed more people in the Africa.",
      videosUrl: ["1","2"],
      imagesUrl: ["1","2"],
      goal: "10000"
    }

    it("Should add campaign", async function () {
      const { contract} = await loadFixture(deployFixture);

      await contract.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      expect(await contract.nextId()).to.equal(1);
    });

    it("Should get campaign", async function () {
      const { contract} = await loadFixture(deployFixture);

      await contract.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)
      const result = await contract.getCampaign(0)

      expect(await result.title).to.equal("Meal of Love");
    });

    it("Should get last id", async function () {
      const { contract} = await loadFixture(deployFixture);

      await contract.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)
      const lastId = await contract.getLastId()
      expect(await lastId).to.equal(1);
    });

    it("Should make a donation", async function () {
      const { contract,otherAccount} = await loadFixture(deployFixture);

      await contract.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      const instance = contract.connect(otherAccount)

      await instance.donate("0",{value: 1000})

      expect((await contract.campaigns(0)).balance).to.equal(1000);
    });

    it("Should not donation (Inactive)", async function () {
      const { contract,otherAccount} = await loadFixture(deployFixture);

      await contract.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      const instance = contract.connect(otherAccount)

      await instance.donate("0",{value: 20000})

      await expect((contract.donate("0",{value:100}))).to.be.revertedWith("Cannot donate to this campaign");
    });

    it("Should not donation (smaller or equal than zero)", async function () {
      const { contract,otherAccount} = await loadFixture(deployFixture);

      await contract.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      const instance = contract.connect(otherAccount)

      await expect(instance.donate("0",{value: 0})).to.be.revertedWith("You must send a donation value > 0");
    });

    it("Should get donor", async function () {
      const { contract,otherAccount} = await loadFixture(deployFixture);

      await contract.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      const instance = contract.connect(otherAccount)

      await instance.donate("0",{value: 1000})

      const donors = await contract.getDonors(0);

      expect(donors[0]).to.equal(otherAccount.address)
    });

    it("Should withdraw", async function () {
      const { contract,otherAccount} = await loadFixture(deployFixture);

      const instance = contract.connect(otherAccount)

      await instance.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      await contract.donate("0",{value: 1000})

      await instance.withdraw(0)

      const balance = await ethers.provider.getBalance(contract.getAddress());

      expect(balance).to.equal(100);
    });

    it("Should not withdraw (balance < fee)", async function () {
      const { contract,otherAccount} = await loadFixture(deployFixture);

      const instance = contract.connect(otherAccount)

      await instance.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      await contract.donate("0",{value: 50})

      await expect(instance.withdraw(0)).to.be.revertedWith("This campaign does not have enough balance")
    });

    it("Should not withdraw (campaign is closed)", async function () {
      const { contract,otherAccount} = await loadFixture(deployFixture);

      const instance = contract.connect(otherAccount)

      await instance.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      await contract.donate("0",{value: 1000})

      await instance.withdraw(0)

      await expect(instance.withdraw(0)).to.be.revertedWith("This campaign is closed")
    });

    it("Should withdraw fees by owner", async function () {
      const { contract,owner,otherAccount} = await loadFixture(deployFixture);

      const instance = contract.connect(otherAccount)

      await instance.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      await contract.donate("0",{value: 1000})

      await instance.withdraw(0)

      await contract.withdrawOwner()
      const balance = await ethers.provider.getBalance(contract.getAddress());

      expect(balance).to.equal(0);
    });

    it("Should not fees to withdraw", async function () {
      const { contract,owner,otherAccount} = await loadFixture(deployFixture);

      const instance = contract.connect(otherAccount)

      await instance.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      await contract.donate("0",{value: 1000})

      await expect(contract.withdrawOwner()).to.be.revertedWith("No fees to withdraw");
    });

    it("Should change fees", async function () {
      const { contract } = await loadFixture(deployFixture);

      await contract.changeFee(200)

      expect(await contract.fee()).to.equal(200);
    });

    it("Should not owner permission (fees)", async function () {
      const { contract, otherAccount } = await loadFixture(deployFixture);

      const instance = contract.connect(otherAccount)

      await expect(instance.changeFee(200)).to.be.revertedWith("You do not have permission");
    });

    it("Should not owner permission (withdraw)", async function () {
      const { contract, otherAccount } = await loadFixture(deployFixture);

      const instance = contract.connect(otherAccount)

      await expect(instance.withdrawOwner()).to.be.revertedWith("You do not have permission");
    });

    });
```
