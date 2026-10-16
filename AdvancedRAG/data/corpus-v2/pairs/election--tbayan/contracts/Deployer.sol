// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VoteOption} from "./ElectionStructs.sol";
import {Election} from "./Election.sol";

/// @title Deployer - factory contract for Election instances.
contract Deployer {
    event ElectionCreated(
        address indexed electionAddress,
        address indexed creator,
        string electionTitle,
        uint256 electionEndtime
    );

    function deployElection(
        VoteOption[] memory options,
        uint256 endtime,
        string memory title,
        string memory pubkeyN,
        string memory pubkeyG
    ) public returns (address) {
        Election newElection = new Election(
            options,
            endtime,
            title,
            pubkeyN,
            pubkeyG,
            msg.sender
        );
        emit ElectionCreated(address(newElection), msg.sender, title, endtime);
        return address(newElection);
    }
}
