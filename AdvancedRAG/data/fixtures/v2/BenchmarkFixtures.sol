// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Frozen auxiliary contracts available to every evaluated configuration.
/// They are test infrastructure and are never indexed by the retriever.
contract BenchmarkERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function mint(address to, uint256 amount) external {
        require(to != address(0), "zero address");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 permitted = allowance[from][msg.sender];
        if (permitted != type(uint256).max) {
            require(permitted >= amount, "insufficient allowance");
            allowance[from][msg.sender] = permitted - amount;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    function burnFrom(address from, uint256 amount) external {
        uint256 permitted = allowance[from][msg.sender];
        if (msg.sender != from && permitted != type(uint256).max) {
            require(permitted >= amount, "insufficient allowance");
            allowance[from][msg.sender] = permitted - amount;
        }
        require(balanceOf[from] >= amount, "insufficient balance");
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "zero address");
        require(balanceOf[from] >= amount, "insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract BenchmarkVotingToken is BenchmarkERC20 {
    constructor(string memory name_, string memory symbol_) BenchmarkERC20(name_, symbol_) {}
}

contract BenchmarkERC721 {
    string public name;
    string public symbol;
    mapping(uint256 => address) private _ownerOf;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address owner = _ownerOf[tokenId];
        require(owner != address(0), "nonexistent token");
        return owner;
    }

    function mint(address to, uint256 tokenId) external {
        require(to != address(0) && _ownerOf[tokenId] == address(0), "invalid mint");
        _ownerOf[tokenId] = to;
        emit Transfer(address(0), to, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return _approved[tokenId];
    }

    function approve(address approved, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        require(msg.sender == owner || isApprovedForAll[owner][msg.sender], "not authorized");
        _approved[tokenId] = approved;
        emit Approval(owner, approved, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        address owner = ownerOf(tokenId);
        require(owner == from && to != address(0), "invalid transfer");
        require(msg.sender == owner || _approved[tokenId] == msg.sender || isApprovedForAll[owner][msg.sender], "not authorized");
        delete _approved[tokenId];
        _ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
    }
}

contract BenchmarkTarget {
    uint256 public value;
    event ValueSet(uint256 value);

    function setValue(uint256 value_) external payable {
        value = value_;
        emit ValueSet(value_);
    }

    function fail() external pure {
        revert("target failure");
    }
}
