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