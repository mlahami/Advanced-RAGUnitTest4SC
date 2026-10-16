// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BondingCurve
 * @notice ERC20-like token whose ETH price follows a linear bonding curve:
 *           price(supply) = slope * supply + basePrice
 *         Buy mints tokens; Sell burns them for ETH (minus a fee).
 * Complexity: Complex
 */
contract BondingCurve {
    string public constant name   = "BondToken";
    string public constant symbol = "BOND";
    uint8  public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    uint256 public immutable slope;      // wei per token^2 / 1e18
    uint256 public immutable basePrice;  // wei per token at zero supply
    uint256 public immutable sellFeeBps; // fee on sells

    address public owner;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Buy(address indexed buyer, uint256 tokensMinted, uint256 ethSpent);
    event Sell(address indexed seller, uint256 tokensBurned, uint256 ethReturned);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }

    constructor(uint256 _slope, uint256 _basePrice, uint256 _sellFeeBps) {
        require(_sellFeeBps <= 1000, "Fee too high");
        slope       = _slope;
        basePrice   = _basePrice;
        sellFeeBps  = _sellFeeBps;
        owner       = msg.sender;
    }

    // â”€â”€â”€ Buy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /**
     * @notice Buy exactly `tokenAmount` tokens. Reverts if msg.value insufficient.
     *         Refunds excess ETH.
     */
    function buy(uint256 tokenAmount) external payable {
        require(tokenAmount > 0, "Zero amount");
        uint256 cost = _integrateCost(totalSupply, tokenAmount);
        require(msg.value >= cost, "Insufficient ETH");

        totalSupply        += tokenAmount;
        balanceOf[msg.sender] += tokenAmount;
        emit Transfer(address(0), msg.sender, tokenAmount);
        emit Buy(msg.sender, tokenAmount, cost);

        // Refund excess
        if (msg.value > cost) {
            (bool ok,) = msg.sender.call{value: msg.value - cost}("");
            require(ok, "Refund failed");
        }
    }

    // â”€â”€â”€ Sell â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function sell(uint256 tokenAmount) external {
        require(tokenAmount > 0, "Zero amount");
        require(balanceOf[msg.sender] >= tokenAmount, "Insufficient balance");

        uint256 gross = _integrateCost(totalSupply - tokenAmount, tokenAmount);
        uint256 fee   = (gross * sellFeeBps) / 10_000;
        uint256 net   = gross - fee;

        totalSupply           -= tokenAmount;
        balanceOf[msg.sender] -= tokenAmount;
        emit Transfer(msg.sender, address(0), tokenAmount);
        emit Sell(msg.sender, tokenAmount, net);

        (bool ok,) = msg.sender.call{value: net}("");
        require(ok, "ETH transfer failed");
    }

    // â”€â”€â”€ Price view â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /**
     * @notice Current spot price per token in wei.
     */
    function spotPrice() external view returns (uint256) {
        return basePrice + (slope * totalSupply) / 1e18;
    }

    /**
     * @notice Cost to buy `amount` tokens at current supply.
     */
    function quoteBuy(uint256 amount) external view returns (uint256) {
        return _integrateCost(totalSupply, amount);
    }

    /**
     * @notice ETH returned (after fee) for selling `amount` tokens.
     */
    function quoteSell(uint256 amount) external view returns (uint256) {
        if (amount > totalSupply) return 0;
        uint256 gross = _integrateCost(totalSupply - amount, amount);
        return gross - (gross * sellFeeBps) / 10_000;
    }

    // â”€â”€â”€ Owner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function collectFees() external onlyOwner {
        // Fees accumulate as difference between ETH balance and theoretical backing
        uint256 backing = _integrateCost(0, totalSupply);
        uint256 fees    = address(this).balance > backing ? address(this).balance - backing : 0;
        require(fees > 0, "No fees");
        (bool ok,) = owner.call{value: fees}("");
        require(ok, "Transfer failed");
    }

    // â”€â”€â”€ Internal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /**
     * @dev Integral of price from s to s+amount:
     *      âˆ«[s, s+a] (basePrice + slope*x/1e18) dx
     *      = basePrice*a + slope*(2*s*a + a^2)/(2*1e18)
     */
    function _integrateCost(uint256 s, uint256 a) internal view returns (uint256) {
        uint256 term1 = basePrice * a;
        uint256 term2 = (slope * (2 * s * a + a * a)) / (2 * 1e18);
        return term1 + term2;
    }
}

