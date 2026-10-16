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
