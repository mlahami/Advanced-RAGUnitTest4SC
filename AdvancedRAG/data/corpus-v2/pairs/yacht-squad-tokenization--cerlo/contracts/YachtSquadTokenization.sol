// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155URIStorage.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";


interface IERC2981Royalties {
    function royaltyInfo(uint256 _tokenId, uint256 _value) external view  returns (address _receiver, uint256 _royaltyAmount);
}

/**
* @notice Royalties contract aim is to apply fees for each shares transaction.
*
*/
contract Royalties is IERC2981Royalties, ERC165{
    struct RoyaltyInfo {
        address recipient;
        uint24 amount;
    }
 
    mapping(uint256 => RoyaltyInfo) internal _royalties;
 
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IERC2981Royalties).interfaceId || super.supportsInterface(interfaceId);
    }
 
    function _setTokenRoyalty( uint256 tokenId, address recipient, uint256 value) internal {
        require(value <= 200, 'ERC2981Royalties: Too high');
        _royalties[tokenId] = RoyaltyInfo(recipient, uint24(value));
    }
 
    function royaltyInfo(uint256 tokenId, uint256 value) external view override returns (address receiver, uint256 royaltyAmount)
    {
        RoyaltyInfo memory royalties = _royalties[tokenId];
        receiver = royalties.recipient;
        royaltyAmount = (value * royalties.amount) / 200;
    }
}   


/**
* @notice This smart contract aim's is to mint and mange RWA tokenized
*
*/
contract YachtSquadTokenization is Ownable, ERC1155, Royalties  {

    uint private _tokenIds;

    // Optional base URI
    string private _baseURI = "ipfs://";
    // Mapping for token URIs
    mapping(uint256 tokenId => string) private _tokenURIs;
    // Mapping project => address => _tokenBalances
    mapping(uint256 id => mapping(address account => uint256)) private _tokenBalances;

    enum YachtStatus {
        IntialMint,     // The yacht is listed and available for sale
        PreSale,        // Sale for holders of at least one SFT of yacht
        PublicSale,     // Public sale open to new investors
        Chartered,      // The yacht is currently chartered
        Maintenance,    // The yacht is under maintenance
        Sold            // The yacht has been sold
    }


    struct Yachts{
        uint id;
        uint mmsi; //mmsi/AIS => yacht identification
        uint tokenPrice;
        uint maxSupply;
        string name;
        string uri;
        string legal;
        address paymentWallet;
        YachtStatus status;
    }
    Yachts[] yachts;

    // penser à utiliser des données indexed pour une meilleure exploitation côté front
    event NewMint(uint indexed _tokenIds, uint indexed _maxSupply, string _yachtName);
    event RecivedToken(address _from, address _to, uint _tokenIds, uint _amount);
    event RecivedTokens(address _from, address _to, uint[] _ids, uint[] _amounts);
    event StatusChange(uint indexed _tokenId, YachtStatus indexed _prevYachtStatus, YachtStatus indexed _newYachtStatus);

    /** 
    * @dev @ERC1155("") => mettre une URI de base pour le projet
    */
    constructor() Ownable(msg.sender) ERC1155(""){} 


    function supportsInterface(bytes4 _interfaceId) public view virtual override(ERC1155, Royalties) returns (bool){
        return super.supportsInterface(_interfaceId);
    }

    /**
    * @notice Allow Smart contract Owner to mint Yacht
    * 
    * @param _mintWallet Account receiver here it will be YachtSquadTokenHolder.sol
    * @param _mmsi Is the Maritime Mobile Service Identities (the id of the Yacht)
    * @param _tokenPrice The price for a single token
    * @param _maxSupply The number of token available
    * @param _name Yacht Name
    * @param _uri Uri of the JSON data
    * @param _legal The hash of the contract
    * @param _paymentWallet The wallet able to pay rent 
    **/
    function mintyachts(
        address _mintWallet, 
        uint _mmsi, 
        uint _tokenPrice,
        uint _maxSupply,
        string memory _name, 
        string memory _uri,  
        string memory _legal, 
        address _paymentWallet
    ) public onlyOwner {

        uint256 newItemId = _tokenIds;
        _tokenIds += 1 ;
        yachts.push(Yachts(
            newItemId,
            _mmsi,
            _tokenPrice,
            _maxSupply,
            _name,
            _uri,
            _legal,
            _paymentWallet,
            YachtStatus.IntialMint
        ));

        _mint(_mintWallet, newItemId, _maxSupply, "");
        _tokenBalances[newItemId][_mintWallet] += _maxSupply;
        _setURI(newItemId, _uri);
        _setTokenRoyalty(newItemId, msg.sender, 200); //2%
        emit NewMint(newItemId, yachts[newItemId].maxSupply, yachts[newItemId].name);
    }

    /**
    * @notice Status management
    *
    * @param _tokenId Token ID
    * @param _newStatu New status of the given token
    */
    function statusManagement(
        uint256 _tokenId, 
        uint8 _newStatu
    ) public virtual onlyOwner() {
        require(yachts[_tokenId].status != YachtStatus(_newStatu), "It is the same status");
        YachtStatus _prevYachtStatus = yachts[_tokenId].status;
        yachts[_tokenId].status = YachtStatus(_newStatu);
        emit StatusChange(_tokenId, _prevYachtStatus, yachts[_tokenId].status);
    }
    /**
    * @notice Overriding safeTransferFrom function to update _tokenBalances
    * 
    * @param _from token older account
    * @param _to token reciver account
    * @param _id NFT id
    * @param _amount Amount of tokens transfered
    * @param _data needed for function signature herited from ERC1155 contract
    **/
    function safeTransferFrom(
        address _from, 
        address _to, 
        uint256 _id, 
        uint256 _amount, 
        bytes memory _data
    ) public virtual override {
        require(_tokenBalances[_id][_from]  >= _amount, "Insufficient token balance for id");
        _tokenBalances[_id][_from] -= _amount;
        _tokenBalances[_id][_to] += _amount;
        super.safeTransferFrom(_from, _to, _id, _amount, _data);
        emit RecivedToken(_from, _to, _id, _amount);
    }

    // 
    
    /**
    * @notice Overriding the safeBatchTransferFrom function to update _tokenBalances
    * 
    * @param _from token older account
    * @param _to token reciver account
    * @param _ids[] Array of NFT ids
    * @param _amounts[] Array of amount of tokens transfered
    * @param _data needed for function signature herited from ERC1155 contract
    **/
    function safeBatchTransferFrom(
        address _from, 
        address _to, 
        uint256[] memory _ids, 
        uint256[] memory _amounts, 
        bytes memory _data
    ) public virtual override {
        require(_ids.length <= 100, "Array length exceeds limit");
        require(_ids.length == _amounts.length, "IDs and amounts length mismatch");

        for (uint256 i = 0; i < _ids.length; ++i) {
        require(_tokenBalances[_ids[i]][_from]  >= _amounts[i], "Insufficient token balance for id");
            _tokenBalances[_ids[i]][_from] -= _amounts[i];
            _tokenBalances[_ids[i]][_to] += _amounts[i];
        }
        super.safeBatchTransferFrom(_from, _to, _ids, _amounts, _data);
        emit RecivedTokens(_from, _to, _ids, _amounts);
    }

    /**
    * @notice seting up URI
    * 
    * @param _tokenId Token ID
    * @param _tokenURI token URI to setup
    **/
    function _setURI(uint256 _tokenId, string memory _tokenURI) internal virtual {
        _tokenURIs[_tokenId] = _tokenURI;
        emit URI(uri(_tokenId), _tokenId);
    }

    
    /**
    * @notice return URI for the token ID
    * 
    * @param _tokenId Token ID
    * @return return URI for the requested tokenID
    **/
    function uri(uint256 _tokenId) public view virtual override returns (string memory) {
        string memory tokenURI = _tokenURIs[_tokenId];
        // If token URI is set, concatenate base URI and tokenURI (via string.concat).
        return bytes(tokenURI).length > 0 ? string.concat(_baseURI, tokenURI) : super.uri(_tokenId);
    }

    /**
    * @notice returns Yahcts informations
    * 
    * @return Yachts[] Return the array of Yachts
    **/
    function getYachts() external view returns(Yachts[] memory){
        return yachts;
    }

    /**
    * @notice returns yacht ID informations
    * 
    * @param _id The yacht id
    *
    * @return Yacht Return the Yacht
    **/
    function getYacht(uint _id) external view returns(Yachts memory){
        return yachts[_id];
    }
    
    /**
    * @notice Allow Investor to get information on their Yachts
    * 
    * @param _investor Account address
    * @return Yacht[] return the array of yacht the acount has invested on
    **/
    function getInvestments(address _investor) external view returns (Yachts[] memory) {
        uint totalYachts = yachts.length;
        uint count = 0;

        // Première boucle pour compter le nombre de yachts détenus par l'investisseur
        for (uint i = 0; i < totalYachts; i++) {
            if (_tokenBalances[i][_investor] > 0) {
                count++;
            }
        }

        // Créer un tableau de la taille exacte nécessaire 
        Yachts[] memory ownedYachts = new Yachts[](count);
        uint index = 0;

        // Deuxième boucle pour remplir le tableau avec les yachts détenus
        for (uint i = 0; i < totalYachts; i++) {
            if (_tokenBalances[i][_investor] > 0) {
                ownedYachts[index] = yachts[i];
                index++;
            }
        }

        return ownedYachts;
    }

}