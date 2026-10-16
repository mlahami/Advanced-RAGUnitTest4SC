// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;

interface IRegistration {
    function logicalRegisterProperty(
        string memory _geoHash,
        uint _area,
        string memory _cadastralClass,
        address[] memory _owners,
        uint[] memory _percentages,
        string[] memory _ipfsHash
    ) external returns (uint);
}