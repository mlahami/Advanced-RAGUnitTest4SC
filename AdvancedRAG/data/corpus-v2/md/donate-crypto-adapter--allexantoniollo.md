# donate-crypto-adapter--allexantoniollo

- domain: crowdfunding (charity-donation)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/AllexAntoniollo/DonateCrypto @ 536b70b4ab02cdce945e9502dce220fbee2e034d
- license: MIT
- targets: DonateCryptoAdapter.sol, DonateCrypto.sol, DonateCryptoLib.sol, IDonateCrypto.sol
- validation: 10 passing tests, 0 failing; statement coverage DonateCryptoAdapter.sol 100.0 %, DonateCrypto.sol 100.0 %, DonateCryptoLib.sol 100.0 %, IDonateCrypto.sol 100.0 %

## Contract: DonateCrypto.sol (dependency)

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

## Contract: DonateCryptoAdapter.sol (primary target)

```solidity
//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./IDonateCrypto.sol";

import {DonateCryptoLib as Lib} from "./DonateCryptoLib.sol";


contract DonateCryptoAdapter {

    IDonateCrypto private implementation;
    address public immutable owner;

    constructor(){
        owner = msg.sender;
    }


    function getImplAddress() external view returns (address) {
        return address(implementation);
    }
    

    function upgrade(address newImplementation) external{
        require(msg.sender == owner,"You do not have permission");
        implementation = IDonateCrypto(newImplementation);
    }


    function getCampaign(uint256 id) external view returns(Lib.Campaign memory){
        return implementation.getCampaign(id);
    }


    function getLastId() external view returns(uint256){
        return implementation.getLastId();
    }


    function addCampaign(string calldata title, string calldata description, string[] calldata videosUrl,string[] calldata imagesUrl, uint256 goal) external{
        return implementation.addCampaign(title,description,videosUrl,imagesUrl,goal);
    }


    function getDonors(uint256 id) external view returns(address[] memory){
       return implementation.getDonors(id);
    }


    function donate(uint256 id) external payable{
        return implementation.donate{value: msg.value}(id);
    }


    function withdrawOwner() external{
        return implementation.withdrawOwner();
    }


    function changeFee(uint256 newFee) external{
        return implementation.changeFee(newFee);
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

## Tests: DonateCryptoAdapter.test.js

```javascript
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

  describe("DonateCryptoAdapter", function () {

      async function deployAdapterFixture(){
        const [owner, otherAccount] = await ethers.getSigners();

        const DonateCryptoAdapter = await ethers.getContractFactory("DonateCryptoAdapter");

        const adapter = await DonateCryptoAdapter.deploy();

        return { adapter, owner, otherAccount };
      }

      async function deployImplementationFixture(){

        const DonateCrypto = await ethers.getContractFactory("DonateCrypto");

        const contract = await DonateCrypto.deploy();

        return { contract };
      }

      const campaign = {
        title: "Meal of Love",
        description: "This campaign have an objective to feed more people in the Africa.",
        videosUrl: ["1","2"],
        imagesUrl: ["1","2"],
        goal: "10000"
      }

      it("Should upgrade", async function () {
        const { adapter} = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        const address2 = await adapter.getImplAddress();

        expect(await contract.getAddress()).to.equal(address2);
      });

      it("Should not upgrade (permission)", async function () {
        const { adapter, otherAccount } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        const instance = adapter.connect(otherAccount)

        await expect(instance.upgrade(contract.getAddress())).to.be.revertedWith("You do not have permission");
      });

      it("Should add campaign", async function () {
        const { adapter } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        await adapter.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal);

        expect(await contract.nextId()).to.equal(1);
      });

      it("Should get campaign", async function () {
        const { adapter } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        await adapter.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal);
        const result = adapter.getCampaign(0)

        expect((await result).title).to.equal("Meal of Love");
      });

      it("Should get last id", async function () {
        const { adapter } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        await adapter.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal);

        expect(await adapter.getLastId()).to.equal(1);
      });

      it("Should make a donation", async function () {
        const { adapter, otherAccount } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        await adapter.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal);

        const instance = await adapter.connect(otherAccount)
        await instance.donate("0",{value: 1000})

        expect((await contract.campaigns(0)).balance).to.equal(1000);
      });

      it("Should get donor", async function () {
        const { adapter,owner,otherAccount } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        await adapter.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal);

        const instance = await adapter.connect(otherAccount)
        await instance.donate("0",{value: 1000})

        const donor = await instance.getDonors(0)

        expect(donor[0]).to.equal(await otherAccount.getAddress());
      });

      it("Should change fee", async function () {
        const { adapter } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        await adapter.changeFee(200)

        expect(await contract.fee()).to.equal(200)
      });

      it("Should not change fee", async function () {
        const { adapter,otherAccount } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        const instance = await adapter.connect(otherAccount)

        await expect(instance.changeFee(200)).to.be.revertedWith("You do not have permission")
      });

      it("Should owner withdraw", async function () {
        const { adapter, otherAccount } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        await adapter.addCampaign(campaign.title, campaign.description, campaign.videosUrl, campaign.imagesUrl, campaign.goal);

        const instance = await adapter.connect(otherAccount)
        await instance.donate("0", { value: 11000 })

        const contractAddress = await contract.getAddress();

        const contractBalanceBefore = await ethers.provider.getBalance(contractAddress);

        await adapter.withdrawOwner()

        const contractBalanceAfter = await ethers.provider.getBalance(contractAddress);

        expect(contractBalanceAfter).to.equal(Number(contractBalanceBefore) - 100);
    });

    });
```
