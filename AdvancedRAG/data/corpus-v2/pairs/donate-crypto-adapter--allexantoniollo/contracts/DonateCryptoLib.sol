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