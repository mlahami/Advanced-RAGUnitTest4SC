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