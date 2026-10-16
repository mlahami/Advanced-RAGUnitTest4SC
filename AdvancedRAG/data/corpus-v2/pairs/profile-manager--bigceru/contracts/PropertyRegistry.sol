// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./PropertyStorage.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "./IRegistration.sol";

contract PropertyRegistry is PropertyStorage, ERC721 {
    
    // ###############
    // # Constructor #
    // ###############

    // Constructor to initialize the HistoryTracker contract and ERC721 token
    constructor(address _historyTrackerAddress) ERC721("PropertyNFT", "PNFT") {
        historyTracker = HistoryTracker(_historyTrackerAddress); // Initialize the HistoryTracker contract
        contractOwner = msg.sender; // Set the contract owner to the address that deploys the contract
    }

    // Modifier to restrict access to the contract owner
    modifier onlyOwner() {
        require(
            msg.sender == contractOwner,
            "Only the contract owner can perform this action"
        );
        _;
    }

    function registerProperty(
        string memory _geoHash,
        uint _area,
        string memory _cadastralClass,
        address[] memory _owners,
        uint[] memory _percentages,
        string[] memory _ipfsHash
    ) external returns (uint) {
        // Get the address of the Registration facet from the router
        address facet = facets[IRegistration.logicalRegisterProperty.selector];
        require(facet != address(0), "Registration facet not set");

        // Prepare the function call data
        bytes memory data = abi.encodeWithSelector(
            IRegistration.logicalRegisterProperty.selector,
            _geoHash, _area, _cadastralClass, _owners, _percentages, _ipfsHash
        );
        
        // Perform the delegatecall to the logic facet
        (bool success, bytes memory returnData) = facet.delegatecall(data);

        if (success) {
            uint propertyId = abi.decode(returnData, (uint));
            _mint(address(this), propertyId);
            return propertyId;
        } else {
            // Bubble up the revert reason (needed to propagate errors from the delegatecall)
            assembly {
                revert(add(returnData, 32), mload(returnData))
            }
        }
    }

    function addFacet(bytes4[] calldata _selectors, address _facetAddress) external onlyOwner {
        for (uint i = 0; i < _selectors.length; i++) {
            facets[_selectors[i]] = _facetAddress;
        }
    }

    fallback() external payable {
        // Fallback function to accept Ether
        // This function is called when no other function matches the call

        address facet = facets[msg.sig];
        require(facet != address(0), "Function does not exist in any facet");
        
        assembly {
            // Copy msg.data to memory
            let dataSize := calldatasize()
            calldatacopy(0, 0, dataSize)

            // Delegate call to the facet
            let result := delegatecall(gas(), facet, 0, dataSize, 0, 0)

            // Copy the return data back to the caller
            let returnDataSize := returndatasize()
            returndatacopy(0, 0, returnDataSize)

            // Revert if the delegate call failed
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }

    receive() external payable {
        // Receive function to accept Ether
    }
}
