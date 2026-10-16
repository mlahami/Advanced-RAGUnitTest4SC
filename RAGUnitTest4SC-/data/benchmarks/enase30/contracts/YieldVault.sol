// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

//YieldVault â€” ERC4626-compliant vault with share accounting and strategy hooks
interface IERC20Mintable {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract YieldVault {
    IERC20Mintable public immutable asset;
    string public name;
    string public symbol;

    uint256 public totalAssets;
    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;

    address public strategy;

    event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, uint256 assets, uint256 shares);
    event Harvested(uint256 profit);

    constructor(address _asset, string memory _name, string memory _symbol) {
        asset = IERC20Mintable(_asset);
        name = _name;
        symbol = _symbol;
    }

    function setStrategy(address _strategy) external {
        strategy = _strategy;
    }

    function convertToShares(uint256 _assets) public view returns (uint256) {
        if (totalAssets == 0 || totalShares == 0) return _assets;
        return (_assets * totalShares) / totalAssets;
    }

    function convertToAssets(uint256 _shares) public view returns (uint256) {
        if (totalShares == 0) return _shares;
        return (_shares * totalAssets) / totalShares;
    }

    function deposit(uint256 _assets, address _receiver) external returns (uint256 shares) {
        shares = convertToShares(_assets);
        require(shares > 0, "Zero shares");
        asset.transferFrom(msg.sender, address(this), _assets);
        sharesOf[_receiver] += shares;
        totalShares += shares;
        totalAssets += _assets;
        // Forward to strategy
        if (strategy != address(0)) {
            asset.transfer(strategy, _assets);
        }
        emit Deposit(msg.sender, _receiver, _assets, shares);
    }

    function withdraw(uint256 _shares, address _receiver) external returns (uint256 assets) {
        require(sharesOf[msg.sender] >= _shares, "Insufficient shares");
        assets = convertToAssets(_shares);
        sharesOf[msg.sender] -= _shares;
        totalShares -= _shares;
        totalAssets -= assets;
        asset.transfer(_receiver, assets);
        emit Withdraw(msg.sender, _receiver, assets, _shares);
    }

    /// Called by strategy to report profits
    function reportProfit(uint256 _profit) external {
        require(msg.sender == strategy, "Not strategy");
        totalAssets += _profit;
        emit Harvested(_profit);
    }
}
